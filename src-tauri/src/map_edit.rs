use std::collections::{HashMap, HashSet};

use crate::map_model::{chunk_key_of, stack_at, tile_stack_mut, MapModel};
use crate::materials::{self, Materials};
use crate::otb::OtbItems;
use crate::{MapState, MaterialsState, OtbState, PlaceFlags, PlacementState};

const GROUND_CLASS: i32 = -1;
const BORDER_CLASS: i32 = 0;
const NORMAL_CLASS: i32 = 1000;

const NEIGHBOUR_OFFSETS: [(i32, i32); 8] = [(-1, -1), (0, -1), (1, -1), (-1, 0), (1, 0), (-1, 1), (0, 1), (1, 1)];
const WALL_NEIGHBOUR_OFFSETS: [(i32, i32); 4] = [(0, -1), (-1, 0), (1, 0), (0, 1)];

fn tile_seed(x: u16, y: u16) -> u32 {
	(x as u32).wrapping_mul(73856093) ^ (y as u32).wrapping_mul(19349663)
}

fn is_ground_item(place: &HashMap<u16, PlaceFlags>, mats: Option<&Materials>, client: u16, server: u16) -> bool {
	if place.get(&client).is_some_and(|p| p.ground) {
		return true;
	}
	mats.is_some_and(|m| m.server_to_ground.contains_key(&server))
}

fn order_class(place: &HashMap<u16, PlaceFlags>, mats: Option<&Materials>, client: u16, server: u16) -> i32 {
	if is_ground_item(place, mats, client, server) {
		return GROUND_CLASS;
	}
	if mats.is_some_and(|m| m.is_border_item(server)) {
		return BORDER_CLASS;
	}
	match place.get(&client).map_or(0, |p| p.top_order) {
		1 => 1,
		2 => 2,
		3 => 3,
		_ => NORMAL_CLASS,
	}
}

fn insert_ordered(stack: &mut Vec<(u16, u16)>, place: &HashMap<u16, PlaceFlags>, mats: Option<&Materials>, client: u16, server: u16) {
	let class = order_class(place, mats, client, server);
	if class == GROUND_CLASS {
		let head_ground = stack.first().is_some_and(|&(c, s)| order_class(place, mats, c, s) == GROUND_CLASS);
		if head_ground {
			stack[0] = (client, server);
		} else {
			stack.insert(0, (client, server));
		}
		return;
	}
	let mut idx = 0;
	if stack.first().is_some_and(|&(c, s)| order_class(place, mats, c, s) == GROUND_CLASS) {
		idx = 1;
	}
	while idx < stack.len() {
		let (c, s) = stack[idx];
		if order_class(place, mats, c, s) > class {
			break;
		}
		idx += 1;
	}
	stack.insert(idx, (client, server));
}

fn ground_brush_at(m: &MapModel, mats: &Materials, place: &HashMap<u16, PlaceFlags>, z: u8, x: u16, y: u16) -> u32 {
	let stack = stack_at(m, z, x, y);
	if let Some(&(c, s)) = stack.first() {
		if is_ground_item(place, Some(mats), c, s) {
			return mats.server_to_ground.get(&s).copied().unwrap_or(0);
		}
	}
	0
}

fn borderize(
	m: &mut MapModel,
	mats: &Materials,
	place: &HashMap<u16, PlaceFlags>,
	otb: &OtbItems,
	z: u8,
	tiles: &HashSet<(u16, u16)>,
	optional: bool,
) -> HashSet<u32> {
	let mut affected: HashSet<(u16, u16)> = HashSet::new();
	for &(x, y) in tiles {
		affected.insert((x, y));
		for (dx, dy) in NEIGHBOUR_OFFSETS {
			let nx = x as i32 + dx;
			let ny = y as i32 + dy;
			if nx >= 0 && ny >= 0 && nx <= u16::MAX as i32 && ny <= u16::MAX as i32 {
				affected.insert((nx as u16, ny as u16));
			}
		}
	}

	let mut computed: Vec<((u16, u16), materials::BorderResult)> = Vec::with_capacity(affected.len());
	for &(x, y) in &affected {
		let own = ground_brush_at(m, mats, place, z, x, y);
		let mut neigh = [0u32; 8];
		for (i, (dx, dy)) in NEIGHBOUR_OFFSETS.iter().enumerate() {
			let nx = x as i32 + dx;
			let ny = y as i32 + dy;
			if nx >= 0 && ny >= 0 && nx <= u16::MAX as i32 && ny <= u16::MAX as i32 {
				neigh[i] = ground_brush_at(m, mats, place, z, nx as u16, ny as u16);
			}
		}
		computed.push(((x, y), mats.calculate_borders(own, &neigh, optional)));
	}

	let mut touched: HashSet<u32> = HashSet::new();
	for ((x, y), result) in computed {
		let stack = tile_stack_mut(m, z, x, y);
		let before = stack.clone();
		stack.retain(|&(_, s)| !mats.is_border_item(s));
		let mut idx = 0;
		if stack.first().is_some_and(|&(c, s)| is_ground_item(place, Some(mats), c, s)) {
			idx = 1;
		}
		for s in result.items {
			let c = otb.client_id(s).unwrap_or(0);
			stack.insert(idx, (c, s));
			idx += 1;
		}
		for sc in &result.specifics {
			apply_specific_case(stack, otb, sc);
		}
		if *stack != before {
			touched.insert(chunk_key_of(x, y));
		}
	}
	touched
}

fn apply_specific_case(stack: &mut Vec<(u16, u16)>, otb: &OtbItems, sc: &materials::SpecificCase) {
	let present = |id: u16| stack.iter().any(|&(_, s)| s == id);
	if !sc.matches.iter().all(|&id| present(id)) {
		return;
	}
	let mut replaced = sc.delete_all;
	let mut i = 0;
	while i < stack.len() {
		let server = stack[i].1;
		if sc.matches.contains(&server) {
			if !replaced && server == sc.to_replace {
				stack[i] = (otb.client_id(sc.with).unwrap_or(0), sc.with);
				replaced = true;
				i += 1;
			} else if sc.delete_all || !sc.keep_border {
				stack.remove(i);
			} else {
				i += 1;
			}
		} else {
			i += 1;
		}
	}
}

fn tile_has_wall(m: &MapModel, mats: &Materials, own_wall: u32, z: u8, x: u16, y: u16) -> bool {
	stack_at(m, z, x, y)
		.iter()
		.any(|&(_, s)| mats.wall_brush_for(s).is_some_and(|other| mats.walls_connect(own_wall, other)))
}

fn wallize(m: &mut MapModel, mats: &Materials, otb: &OtbItems, z: u8, tiles: &HashSet<(u16, u16)>) -> HashSet<u32> {
	let mut affected: HashSet<(u16, u16)> = HashSet::new();
	for &(x, y) in tiles {
		affected.insert((x, y));
		for (dx, dy) in WALL_NEIGHBOUR_OFFSETS {
			let nx = x as i32 + dx;
			let ny = y as i32 + dy;
			if nx >= 0 && ny >= 0 && nx <= u16::MAX as i32 && ny <= u16::MAX as i32 {
				affected.insert((nx as u16, ny as u16));
			}
		}
	}

	let mut computed: Vec<((u16, u16), Vec<(usize, u16)>)> = Vec::new();
	for &(x, y) in &affected {
		let stack = stack_at(m, z, x, y);
		let mut changes: Vec<(usize, u16)> = Vec::new();
		for (i, &(_, server)) in stack.iter().enumerate() {
			let Some(own_wall) = mats.wall_brush_for(server) else {
				continue;
			};
			let mut tiledata = 0u32;
			for (bit, (dx, dy)) in WALL_NEIGHBOUR_OFFSETS.iter().enumerate() {
				let nx = x as i32 + dx;
				let ny = y as i32 + dy;
				if nx >= 0 && ny >= 0 && nx <= u16::MAX as i32 && ny <= u16::MAX as i32 && tile_has_wall(m, mats, own_wall, z, nx as u16, ny as u16) {
					tiledata |= 1 << bit;
				}
			}
			if let Some(new_server) = mats.wall_id_for(own_wall, tiledata, tile_seed(x, y)) {
				if new_server != server {
					changes.push((i, new_server));
				}
			}
		}
		if !changes.is_empty() {
			computed.push(((x, y), changes));
		}
	}

	let mut touched: HashSet<u32> = HashSet::new();
	for ((x, y), changes) in computed {
		let stack = tile_stack_mut(m, z, x, y);
		for (idx, new_server) in changes {
			if let Some(slot) = stack.get_mut(idx) {
				*slot = (otb.client_id(new_server).unwrap_or(0), new_server);
			}
		}
		touched.insert(chunk_key_of(x, y));
	}
	touched
}

fn realign8<B, I>(m: &mut MapModel, mats: &Materials, otb: &OtbItems, z: u8, tiles: &HashSet<(u16, u16)>, brush_for: B, id_for: I) -> HashSet<u32>
where
	B: Fn(&Materials, u16) -> Option<u32>,
	I: Fn(&Materials, u32, u32, u32) -> Option<u16>,
{
	let mut affected: HashSet<(u16, u16)> = HashSet::new();
	for &(x, y) in tiles {
		affected.insert((x, y));
		for (dx, dy) in NEIGHBOUR_OFFSETS {
			let nx = x as i32 + dx;
			let ny = y as i32 + dy;
			if nx >= 0 && ny >= 0 && nx <= u16::MAX as i32 && ny <= u16::MAX as i32 {
				affected.insert((nx as u16, ny as u16));
			}
		}
	}

	let tile_has = |m: &MapModel, own: u32, x: u16, y: u16| -> bool {
		stack_at(m, z, x, y).iter().any(|&(_, s)| brush_for(mats, s) == Some(own))
	};

	let mut computed: Vec<((u16, u16), Vec<(usize, u16)>)> = Vec::new();
	for &(x, y) in &affected {
		let stack = stack_at(m, z, x, y);
		let mut changes: Vec<(usize, u16)> = Vec::new();
		for (idx, &(_, server)) in stack.iter().enumerate() {
			let Some(own) = brush_for(mats, server) else {
				continue;
			};
			let mut tiledata = 0u32;
			for (bit, (dx, dy)) in NEIGHBOUR_OFFSETS.iter().enumerate() {
				let nx = x as i32 + dx;
				let ny = y as i32 + dy;
				if nx >= 0 && ny >= 0 && nx <= u16::MAX as i32 && ny <= u16::MAX as i32 && tile_has(m, own, nx as u16, ny as u16) {
					tiledata |= 1 << bit;
				}
			}
			if let Some(new_server) = id_for(mats, own, tiledata, tile_seed(x, y)) {
				if new_server != server {
					changes.push((idx, new_server));
				}
			}
		}
		if !changes.is_empty() {
			computed.push(((x, y), changes));
		}
	}

	let mut touched: HashSet<u32> = HashSet::new();
	for ((x, y), changes) in computed {
		let stack = tile_stack_mut(m, z, x, y);
		for (idx, new_server) in changes {
			if let Some(slot) = stack.get_mut(idx) {
				*slot = (otb.client_id(new_server).unwrap_or(0), new_server);
			}
		}
		touched.insert(chunk_key_of(x, y));
	}
	touched
}

#[allow(clippy::too_many_arguments)]
fn auto_after_change(
	m: &mut MapModel,
	mats: &Materials,
	place: &HashMap<u16, PlaceFlags>,
	otb: &OtbItems,
	z: u8,
	tiles: &HashSet<(u16, u16)>,
	client: u16,
	server: u16,
	force_ground: bool,
) -> HashSet<u32> {
	let mut touched: HashSet<u32> = HashSet::new();
	if force_ground || is_ground_item(place, Some(mats), client, server) {
		touched.extend(borderize(m, mats, place, otb, z, tiles, true));
	}
	if mats.wall_brush_for(server).is_some() {
		touched.extend(wallize(m, mats, otb, z, tiles));
	}
	if mats.table_brush_for(server).is_some() {
		touched.extend(realign8(m, mats, otb, z, tiles, Materials::table_brush_for, Materials::table_id_for));
	}
	if mats.carpet_brush_for(server).is_some() {
		touched.extend(realign8(m, mats, otb, z, tiles, Materials::carpet_brush_for, Materials::carpet_id_for));
	}
	touched
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn paint_tiles(
	map_id: u32,
	z: u8,
	xs: Vec<u16>,
	ys: Vec<u16>,
	server_id: u16,
	is_ground: bool,
	is_doodad: bool,
	automagic: bool,
	otb_state: tauri::State<OtbState>,
	map_state: tauri::State<MapState>,
	materials_state: tauri::State<MaterialsState>,
	placement_state: tauri::State<PlacementState>,
) -> Result<Vec<u32>, String> {
	if xs.len() != ys.len() {
		return Err("xs and ys length mismatch".into());
	}

	let otb_guard = otb_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let otb = otb_guard.as_ref().ok_or("items.otb not loaded")?;
	let client_id = otb.client_id(server_id).unwrap_or(0);

	let materials_guard = materials_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let mats = materials_guard.as_ref();
	let place = placement_state.lock().map_err(|e| format!("Lock error: {}", e))?;

	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let m = guard.maps.get_mut(&map_id).ok_or("map not loaded")?;

	let mut touched: HashSet<u32> = HashSet::new();
	let mut painted: HashSet<(u16, u16)> = HashSet::new();
	let mut painted_ground = false;

	let doodad_brush = if is_doodad { mats.and_then(|mt| mt.doodad_brush_for(server_id)) } else { None };

	for i in 0..xs.len() {
		let (x, y) = (xs[i], ys[i]);
		if let (Some(mats), Some(brush)) = (mats, doodad_brush) {
			for (dx, dy, item) in mats.doodad_placement(brush, tile_seed(x, y)) {
				let (tx, ty) = (x as i32 + dx, y as i32 + dy);
				if tx < 0 || ty < 0 || tx > u16::MAX as i32 || ty > u16::MAX as i32 {
					continue;
				}
				let (tx, ty) = (tx as u16, ty as u16);
				let client = otb.client_id(item).unwrap_or(0);
				insert_ordered(tile_stack_mut(m, z, tx, ty), &place, Some(mats), client, item);
				touched.insert(chunk_key_of(tx, ty));
				painted.insert((tx, ty));
			}
			continue;
		}
		let stack = tile_stack_mut(m, z, x, y);
		insert_ordered(stack, &place, mats, client_id, server_id);
		painted_ground |= is_ground;
		touched.insert(chunk_key_of(x, y));
		painted.insert((x, y));
	}

	if automagic {
		if let Some(mats) = mats {
			touched.extend(auto_after_change(m, mats, &place, otb, z, &painted, client_id, server_id, painted_ground));
		}
	}

	Ok(touched.into_iter().collect())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn move_item(
	map_id: u32,
	z: u8,
	from_x: u16,
	from_y: u16,
	to_x: u16,
	to_y: u16,
	automagic: bool,
	otb_state: tauri::State<OtbState>,
	map_state: tauri::State<MapState>,
	materials_state: tauri::State<MaterialsState>,
	placement_state: tauri::State<PlacementState>,
) -> Result<Vec<u32>, String> {
	if from_x == to_x && from_y == to_y {
		return Ok(Vec::new());
	}
	let otb_guard = otb_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let otb = otb_guard.as_ref().ok_or("items.otb not loaded")?;
	let materials_guard = materials_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let mats = materials_guard.as_ref();
	let place = placement_state.lock().map_err(|e| format!("Lock error: {}", e))?;

	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let m = guard.maps.get_mut(&map_id).ok_or("map not loaded")?;
	let (client, server) = match tile_stack_mut(m, z, from_x, from_y).pop() {
		Some(it) => it,
		None => return Ok(Vec::new()),
	};
	insert_ordered(tile_stack_mut(m, z, to_x, to_y), &place, mats, client, server);

	let mut touched: HashSet<u32> = [chunk_key_of(from_x, from_y), chunk_key_of(to_x, to_y)].into_iter().collect();
	if automagic {
		if let Some(mats) = mats {
			let tiles: HashSet<(u16, u16)> = [(from_x, from_y), (to_x, to_y)].into_iter().collect();
			touched.extend(auto_after_change(m, mats, &place, otb, z, &tiles, client, server, false));
		}
	}
	Ok(touched.into_iter().collect())
}

#[tauri::command]
pub fn delete_item(
	map_id: u32,
	z: u8,
	x: u16,
	y: u16,
	automagic: bool,
	otb_state: tauri::State<OtbState>,
	map_state: tauri::State<MapState>,
	materials_state: tauri::State<MaterialsState>,
	placement_state: tauri::State<PlacementState>,
) -> Result<Vec<u32>, String> {
	let otb_guard = otb_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let otb = otb_guard.as_ref().ok_or("items.otb not loaded")?;
	let materials_guard = materials_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let mats = materials_guard.as_ref();
	let place = placement_state.lock().map_err(|e| format!("Lock error: {}", e))?;

	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let m = guard.maps.get_mut(&map_id).ok_or("map not loaded")?;
	let removed = tile_stack_mut(m, z, x, y).pop();

	let mut touched: HashSet<u32> = [chunk_key_of(x, y)].into_iter().collect();
	if automagic {
		if let (Some(mats), Some((client, server))) = (mats, removed) {
			let tiles: HashSet<(u16, u16)> = [(x, y)].into_iter().collect();
			touched.extend(auto_after_change(m, mats, &place, otb, z, &tiles, client, server, false));
		}
	}
	Ok(touched.into_iter().collect())
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::map_model::{build_map_model, stack_at};
	use crate::otb::parse_otb;
	use std::fs;
	use std::path::PathBuf;

	const DATA: &str = "../data/860";

	fn load_materials() -> Materials {
		Materials::load(&PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../data/860")).unwrap()
	}

	#[test]
	fn insert_ordered_places_ground_borders_and_normal() {
		let mut place = HashMap::new();
		place.insert(10u16, PlaceFlags { ground: true, top_order: 0 });
		place.insert(20u16, PlaceFlags { ground: false, top_order: 2 });

		let mut stack: Vec<(u16, u16)> = Vec::new();
		insert_ordered(&mut stack, &place, None, 30, 300);
		insert_ordered(&mut stack, &place, None, 20, 200);
		insert_ordered(&mut stack, &place, None, 10, 100);
		assert_eq!(stack, vec![(10, 100), (20, 200), (30, 300)]);

		insert_ordered(&mut stack, &place, None, 10, 101);
		assert_eq!(stack, vec![(10, 101), (20, 200), (30, 300)]);
	}

	#[test]
	fn borderize_adds_grass_borders_next_to_empty() {
		let otb = parse_otb(&fs::read(format!("{}/items.otb", DATA)).unwrap()).unwrap();
		let mats = load_materials();

		let grass_client = otb.client_id(4526).unwrap_or(0);
		let mut place = HashMap::new();
		place.insert(grass_client, PlaceFlags { ground: true, top_order: 0 });

		let mut m = build_map_model(100, 100, &[50], &[50], &[7], &[0], &[1], &[grass_client], &[4526], Vec::new(), 0);

		let tiles: HashSet<(u16, u16)> = [(50u16, 50u16)].into_iter().collect();
		borderize(&mut m, &mats, &place, &otb, 7, &tiles, false);

		let stack = stack_at(&m, 7, 50, 50);
		assert_eq!(stack.first(), Some(&(grass_client, 4526)), "ground stays at slot 0");
		let borders: Vec<u16> = stack.iter().skip(1).filter(|&&(_, s)| mats.is_border_item(s)).map(|&(_, s)| s).collect();
		assert!(!borders.is_empty(), "grass surrounded by empty gets its to-none borders");
	}

	#[test]
	fn erasing_a_ground_reborders_the_neighbour() {
		let otb = parse_otb(&fs::read(format!("{}/items.otb", DATA)).unwrap()).unwrap();
		let mats = load_materials();
		let grass = otb.client_id(4526).unwrap_or(0);
		let mut place = HashMap::new();
		place.insert(grass, PlaceFlags { ground: true, top_order: 0 });

		let mut m = build_map_model(100, 100, &[50, 51], &[50, 50], &[7, 7], &[0, 1], &[1, 1], &[grass, grass], &[4526, 4526], Vec::new(), 0);

		let both: HashSet<(u16, u16)> = [(50, 50), (51, 50)].into_iter().collect();
		borderize(&mut m, &mats, &place, &otb, 7, &both, false);
		let border_count = |m: &MapModel, x, y| stack_at(m, 7, x, y).iter().filter(|&&(_, s)| mats.is_border_item(s)).count();
		let before = border_count(&m, 50, 50);

		tile_stack_mut(&mut m, 7, 51, 50).clear();
		borderize(&mut m, &mats, &place, &otb, 7, &[(50, 50)].into_iter().collect(), false);
		let after = border_count(&m, 50, 50);

		assert!(after > before, "exposing an empty east neighbour adds borders ({before} -> {after})");
	}

	#[test]
	fn specific_case_replaces_target_and_drops_other_matches() {
		let otb = parse_otb(&fs::read(format!("{}/items.otb", DATA)).unwrap()).unwrap();
		let sc = materials::SpecificCase {
			matches: vec![10, 20],
			to_replace: 20,
			with: 4526,
			delete_all: false,
			keep_border: false,
		};
		let mut stack = vec![(0u16, 5u16), (0, 10), (0, 20), (0, 99)];
		apply_specific_case(&mut stack, &otb, &sc);
		assert!(stack.iter().any(|&(_, s)| s == 4526), "target border replaced with `with`");
		assert!(!stack.iter().any(|&(_, s)| s == 10), "other matched border dropped");
		assert!(!stack.iter().any(|&(_, s)| s == 20), "old target id gone");
		assert!(stack.iter().any(|&(_, s)| s == 99), "unrelated item untouched");
		assert!(stack.iter().any(|&(_, s)| s == 5), "ground untouched");
	}
}
