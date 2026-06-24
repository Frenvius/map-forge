use std::collections::{HashMap, HashSet};

use tauri::ipc::Response;

use crate::map_model::{
	chunk_key_of, door_id_at, empty_model, flags_at, house_id_at, push_u16, push_u32, stack_at, tile_stack_mut, MapModel,
	ACTION_DELETE, ACTION_ERASE, ACTION_FLAG, ACTION_HOUSE, ACTION_MOVE, ACTION_PAINT, CHUNK,
};

fn empty_door_id(m: &MapModel, house_id: u32) -> u8 {
	let mut used = [false; 256];
	let mark = |used: &mut [bool; 256], z: u8, x: u16, y: u16| {
		if house_id_at(m, z, x, y) == house_id {
			let d = door_id_at(m, z, x, y);
			if d != 0 {
				used[d as usize] = true;
			}
		}
	};
	for (&z, floor) in &m.floors {
		for &(start, end) in floor.values() {
			for t in start as usize..end as usize {
				mark(&mut used, z, m.tile_x[t], m.tile_y[t]);
			}
		}
	}
	for (&z, chunks) in &m.house_edits {
		for posmap in chunks.values() {
			for &pos in posmap.keys() {
				mark(&mut used, z, (pos >> 16) as u16, (pos & 0xFFFF) as u16);
			}
		}
	}
	(1..=255u16).find(|&i| !used[i as usize]).map(|i| i as u8).unwrap_or(0)
}
use crate::materials::{self, Materials};
use crate::formats::tibia::otb::OtbItems;
use crate::lua_host::LuaState;
use crate::scripting::ScopedLua;
use crate::{CopyBufferState, MapState, MaterialsState, OtbState, PlaceFlags, PlacementState};

pub struct CopyTile {
	pub dx: u16,
	pub dy: u16,
	pub dz: i8,
	pub items: Vec<(u16, u16)>,
}

pub struct CopyBuffer {
	pub tiles: Vec<CopyTile>,
}

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
	let is_ground = is_ground_item(place, mats, client, server);
	let is_border = !is_ground && mats.is_some_and(|m| m.is_border_item(server));
	let top_order = place.get(&client).map_or(0, |p| p.top_order);
	crate::scripting::stack_class(is_ground, is_border, top_order)
}

fn same_brush(mats: Option<&Materials>, brush_server: u16, item_server: u16) -> bool {
	if brush_server == item_server {
		return true;
	}
	let Some(m) = mats else {
		return false;
	};
	let pair = |map: &HashMap<u16, u32>| matches!((map.get(&brush_server), map.get(&item_server)), (Some(a), Some(b)) if a == b);
	pair(&m.server_to_ground)
		|| pair(&m.server_to_wall)
		|| pair(&m.server_to_table)
		|| pair(&m.server_to_carpet)
		|| pair(&m.server_to_doodad)
}

fn insert_ordered(stack: &mut Vec<(u16, u16)>, place: &HashMap<u16, PlaceFlags>, mats: Option<&Materials>, client: u16, server: u16) {
	let ground = crate::scripting::ground_class();
	let class = order_class(place, mats, client, server);
	if class == ground {
		let head_ground = stack.first().is_some_and(|&(c, s)| order_class(place, mats, c, s) == ground);
		if head_ground {
			stack[0] = (client, server);
		} else {
			stack.insert(0, (client, server));
		}
		return;
	}
	let mut idx = 0;
	if stack.first().is_some_and(|&(c, s)| order_class(place, mats, c, s) == ground) {
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

fn auto_all(m: &mut MapModel, mats: &Materials, place: &HashMap<u16, PlaceFlags>, otb: &OtbItems, z: u8, tiles: &HashSet<(u16, u16)>) -> HashSet<u32> {
	let mut touched: HashSet<u32> = HashSet::new();
	touched.extend(borderize(m, mats, place, otb, z, tiles, true));
	touched.extend(wallize(m, mats, otb, z, tiles));
	touched.extend(realign8(m, mats, otb, z, tiles, Materials::table_brush_for, Materials::table_id_for));
	touched.extend(realign8(m, mats, otb, z, tiles, Materials::carpet_brush_for, Materials::carpet_id_for));
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

#[allow(clippy::too_many_arguments)]
fn run_paint(
	m: &mut MapModel,
	mats: Option<&Materials>,
	place: &HashMap<u16, PlaceFlags>,
	otb: &OtbItems,
	z: u8,
	xs: &[u16],
	ys: &[u16],
	server_id: u16,
	client_id: u16,
	is_ground: bool,
	is_doodad: bool,
	automagic: bool,
) -> HashSet<u32> {
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
				let has_ground = stack_at(m, z, tx, ty).first().is_some_and(|&(c, s)| is_ground_item(place, Some(mats), c, s));
				if !crate::scripting::allow_place(item, has_ground) {
					continue;
				}
				let client = otb.client_id(item).unwrap_or(0);
				insert_ordered(tile_stack_mut(m, z, tx, ty), place, Some(mats), client, item);
				touched.insert(chunk_key_of(tx, ty));
				painted.insert((tx, ty));
			}
			continue;
		}
		let has_ground = stack_at(m, z, x, y).first().is_some_and(|&(c, s)| is_ground_item(place, mats, c, s));
		if !crate::scripting::allow_place(server_id, has_ground) {
			continue;
		}
		insert_ordered(tile_stack_mut(m, z, x, y), place, mats, client_id, server_id);
		painted_ground |= is_ground;
		touched.insert(chunk_key_of(x, y));
		painted.insert((x, y));
	}

	if automagic {
		if let Some(mats) = mats {
			touched.extend(auto_after_change(m, mats, place, otb, z, &painted, client_id, server_id, painted_ground));
		}
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
	lua_state: tauri::State<LuaState>,
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

	let lua_guard = lua_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let _lua = ScopedLua::enter(&lua_guard);

	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let m = guard.maps.get_mut(&map_id).ok_or("map not loaded")?;
	let edit_tiles: Vec<(u16, u16)> = xs.iter().zip(ys.iter()).map(|(&a, &b)| (a, b)).collect();
	m.ensure_tiles(z, &edit_tiles, otb)?;
	m.record_begin();
	let touched = run_paint(m, mats, &place, otb, z, &xs, &ys, server_id, client_id, is_ground, is_doodad, automagic);
	m.record_commit(ACTION_PAINT);
	Ok(touched.into_iter().collect())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn paint_zone(
	map_id: u32,
	z: u8,
	xs: Vec<u16>,
	ys: Vec<u16>,
	flag: u32,
	set: bool,
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
	let materials_guard = materials_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let mats = materials_guard.as_ref();
	let place = placement_state.lock().map_err(|e| format!("Lock error: {}", e))?;

	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let m = guard.maps.get_mut(&map_id).ok_or("map not loaded")?;
	let edit_tiles: Vec<(u16, u16)> = xs.iter().zip(ys.iter()).map(|(&a, &b)| (a, b)).collect();
	m.ensure_tiles(z, &edit_tiles, otb)?;
	m.record_begin();

	let mut touched: HashSet<u32> = HashSet::new();
	for i in 0..xs.len() {
		let (x, y) = (xs[i], ys[i]);
		if set {
			let stack = stack_at(m, z, x, y);
			let has_ground = stack.first().is_some_and(|&(c, s)| is_ground_item(&place, mats, c, s));
			if !has_ground {
				continue;
			}
		}
		let cur = flags_at(m, z, x, y);
		let next = if set { cur | flag } else { cur & !flag };
		if next != cur {
			m.set_tile_flags(z, x, y, next);
			touched.insert(chunk_key_of(x, y));
		}
	}
	m.record_commit(ACTION_FLAG);
	Ok(touched.into_iter().collect())
}

const HOUSE_PZ_FLAG: u32 = 0x01;

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn set_house(
	map_id: u32,
	z: u8,
	xs: Vec<u16>,
	ys: Vec<u16>,
	house_id: u32,
	set: bool,
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
	let materials_guard = materials_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let mats = materials_guard.as_ref();
	let place = placement_state.lock().map_err(|e| format!("Lock error: {}", e))?;

	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let m = guard.maps.get_mut(&map_id).ok_or("map not loaded")?;
	let edit_tiles: Vec<(u16, u16)> = xs.iter().zip(ys.iter()).map(|(&a, &b)| (a, b)).collect();
	m.ensure_tiles(z, &edit_tiles, otb)?;
	m.record_begin();

	let mut touched: HashSet<u32> = HashSet::new();
	for i in 0..xs.len() {
		let (x, y) = (xs[i], ys[i]);
		if set {
			let stack = stack_at(m, z, x, y);
			let has_ground = stack.first().is_some_and(|&(c, s)| is_ground_item(&place, mats, c, s));
			if !has_ground {
				continue;
			}
			let mut changed = false;
			if house_id_at(m, z, x, y) != house_id {
				m.set_tile_house_id(z, x, y, house_id);
				changed = true;
			}
			let flags = flags_at(m, z, x, y);
			if flags & HOUSE_PZ_FLAG == 0 {
				m.set_tile_flags(z, x, y, flags | HOUSE_PZ_FLAG);
				changed = true;
			}
			if let Some(mats) = mats {
				let has_door = stack_at(m, z, x, y).iter().any(|&(_, s)| mats.is_door(s));
				if has_door && door_id_at(m, z, x, y) == 0 {
					let door = empty_door_id(m, house_id);
					if door != 0 {
						m.set_tile_door_id(z, x, y, door);
						changed = true;
					}
				}
			}
			if changed {
				touched.insert(chunk_key_of(x, y));
			}
		} else {
			let was_house = house_id_at(m, z, x, y) != 0;
			if !was_house {
				continue;
			}
			m.set_tile_house_id(z, x, y, 0);
			let flags = flags_at(m, z, x, y);
			if flags & HOUSE_PZ_FLAG != 0 {
				m.set_tile_flags(z, x, y, flags & !HOUSE_PZ_FLAG);
			}
			touched.insert(chunk_key_of(x, y));
		}
	}
	m.record_commit(ACTION_HOUSE);
	Ok(touched.into_iter().collect())
}

#[tauri::command]
pub fn house_sizes(
	map_id: u32,
	otb_state: tauri::State<OtbState>,
	map_state: tauri::State<MapState>,
) -> Result<HashMap<u32, u32>, String> {
	let otb_guard = otb_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let otb = otb_guard.as_ref().ok_or("items.otb not loaded")?;
	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let m = guard.maps.get_mut(&map_id).ok_or("map not loaded")?;

	for z in m.available_floors.clone() {
		m.ensure_floor(z, otb)?;
	}

	let mut sizes: HashMap<u32, u32> = HashMap::new();
	for z in m.available_floors.clone() {
		let Some(floor) = m.floors.get(&z) else { continue };
		let keys: Vec<u32> = floor.keys().copied().collect();
		for k in keys {
			let Some(&(start, end)) = m.floors.get(&z).and_then(|f| f.get(&k)) else { continue };
			for t in start as usize..end as usize {
				let (x, y) = (m.tile_x[t], m.tile_y[t]);
				let id = house_id_at(m, z, x, y);
				if id != 0 {
					*sizes.entry(id).or_insert(0) += 1;
				}
			}
		}
	}
	for (&z, chunks) in &m.house_edits {
		for posmap in chunks.values() {
			for (&pos, &id) in posmap {
				let (x, y) = ((pos >> 16) as u16, (pos & 0xFFFF) as u16);
				let on_base = m
					.floors
					.get(&z)
					.and_then(|f| f.get(&chunk_key_of(x, y)))
					.map(|&(s, e)| (s as usize..e as usize).any(|t| m.tile_x[t] == x && m.tile_y[t] == y))
					.unwrap_or(false);
				if !on_base && id != 0 {
					*sizes.entry(id).or_insert(0) += 1;
				}
			}
		}
	}
	Ok(sizes)
}

const PREVIEW_AREA_CAP: u32 = 4096;

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn preview_paint(
	map_id: u32,
	z: u8,
	xs: Vec<u16>,
	ys: Vec<u16>,
	server_id: u16,
	is_ground: bool,
	is_doodad: bool,
	otb_state: tauri::State<OtbState>,
	map_state: tauri::State<MapState>,
	materials_state: tauri::State<MaterialsState>,
	placement_state: tauri::State<PlacementState>,
) -> Result<Response, String> {
	let empty = || Response::new(vec![0u8; 4]);
	if xs.len() != ys.len() || xs.is_empty() {
		return Ok(empty());
	}

	let otb_guard = otb_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let otb = otb_guard.as_ref().ok_or("items.otb not loaded")?;
	let client_id = otb.client_id(server_id).unwrap_or(0);
	let materials_guard = materials_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let Some(mats) = materials_guard.as_ref() else {
		return Ok(empty());
	};
	let place = placement_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let real = guard.maps.get_mut(&map_id).ok_or("map not loaded")?;
	let edit_tiles: Vec<(u16, u16)> = xs.iter().zip(ys.iter()).map(|(&a, &b)| (a, b)).collect();
	real.ensure_tiles(z, &edit_tiles, otb)?;

	let min_x = *xs.iter().min().unwrap();
	let max_x = *xs.iter().max().unwrap();
	let min_y = *ys.iter().min().unwrap();
	let max_y = *ys.iter().max().unwrap();
	let area = (max_x as u32 - min_x as u32 + 1) * (max_y as u32 - min_y as u32 + 1);
	if area > PREVIEW_AREA_CAP {
		return Ok(empty());
	}

	let clamp = |v: i32| v.clamp(0, u16::MAX as i32) as u16;
	let mut scratch = empty_model(real.width, real.height);
	for y in clamp(min_y as i32 - 2)..=clamp(max_y as i32 + 2) {
		for x in clamp(min_x as i32 - 2)..=clamp(max_x as i32 + 2) {
			let s = stack_at(real, z, x, y);
			if !s.is_empty() {
				*tile_stack_mut(&mut scratch, z, x, y) = s;
			}
		}
	}

	run_paint(&mut scratch, Some(mats), &place, otb, z, &xs, &ys, server_id, client_id, is_ground, is_doodad, true);

	let mut out: Vec<u8> = Vec::new();
	push_u32(&mut out, 0);
	let mut count = 0u32;
	for y in clamp(min_y as i32 - 1)..=clamp(max_y as i32 + 1) {
		for x in clamp(min_x as i32 - 1)..=clamp(max_x as i32 + 1) {
			let new = stack_at(&scratch, z, x, y);
			if new == stack_at(real, z, x, y) {
				continue;
			}
			push_u16(&mut out, x);
			push_u16(&mut out, y);
			push_u16(&mut out, new.len() as u16);
			for (client, _) in &new {
				push_u16(&mut out, *client);
			}
			count += 1;
		}
	}
	out[0..4].copy_from_slice(&count.to_le_bytes());
	Ok(Response::new(out))
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
	m.ensure_tiles(z, &[(from_x, from_y), (to_x, to_y)], otb)?;
	if stack_at(m, z, from_x, from_y).is_empty() {
		return Ok(Vec::new());
	}
	m.record_begin();
	let (client, server) = tile_stack_mut(m, z, from_x, from_y).pop().expect("source tile is non-empty");
	insert_ordered(tile_stack_mut(m, z, to_x, to_y), &place, mats, client, server);

	let mut touched: HashSet<u32> = [chunk_key_of(from_x, from_y), chunk_key_of(to_x, to_y)].into_iter().collect();
	if automagic {
		if let Some(mats) = mats {
			let tiles: HashSet<(u16, u16)> = [(from_x, from_y), (to_x, to_y)].into_iter().collect();
			touched.extend(auto_after_change(m, mats, &place, otb, z, &tiles, client, server, false));
		}
	}
	m.record_commit(ACTION_MOVE);
	Ok(touched.into_iter().collect())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn move_selection(
	map_id: u32,
	zs: Vec<u8>,
	xs: Vec<u16>,
	ys: Vec<u16>,
	all: Vec<bool>,
	dx: i32,
	dy: i32,
	automagic: bool,
	otb_state: tauri::State<OtbState>,
	map_state: tauri::State<MapState>,
	materials_state: tauri::State<MaterialsState>,
	placement_state: tauri::State<PlacementState>,
) -> Result<Vec<(u8, u32)>, String> {
	if xs.len() != ys.len() || xs.len() != all.len() || xs.len() != zs.len() {
		return Err("selection arrays length mismatch".into());
	}
	if dx == 0 && dy == 0 {
		return Ok(Vec::new());
	}

	let otb_guard = otb_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let otb = otb_guard.as_ref().ok_or("items.otb not loaded")?;
	let materials_guard = materials_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let mats = materials_guard.as_ref();
	let place = placement_state.lock().map_err(|e| format!("Lock error: {}", e))?;

	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let m = guard.maps.get_mut(&map_id).ok_or("map not loaded")?;

	let dest = |x: u16, y: u16| -> Option<(u16, u16)> {
		let nx = x as i32 + dx;
		let ny = y as i32 + dy;
		if (0..=u16::MAX as i32).contains(&nx) && (0..=u16::MAX as i32).contains(&ny) {
			Some((nx as u16, ny as u16))
		} else {
			None
		}
	};

	let mut by_floor: HashMap<u8, Vec<(u16, u16)>> = HashMap::new();
	for i in 0..xs.len() {
		if let Some((nx, ny)) = dest(xs[i], ys[i]) {
			let f = by_floor.entry(zs[i]).or_default();
			f.push((xs[i], ys[i]));
			f.push((nx, ny));
		}
	}
	for (&z, tiles) in &by_floor {
		m.ensure_tiles(z, tiles, otb)?;
	}
	m.record_begin();

	let mut touched: HashSet<(u8, u32)> = HashSet::new();
	let mut affected: HashMap<u8, HashSet<(u16, u16)>> = HashMap::new();
	let mut moved: Vec<(u8, u16, u16, Vec<(u16, u16)>)> = Vec::new();
	for i in 0..xs.len() {
		let (z, x, y) = (zs[i], xs[i], ys[i]);
		let Some((nx, ny)) = dest(x, y) else {
			continue;
		};
		let stack = tile_stack_mut(m, z, x, y);
		let items = if all[i] {
			std::mem::take(stack)
		} else {
			match stack.pop() {
				Some(item) => vec![item],
				None => Vec::new(),
			}
		};
		if items.is_empty() {
			continue;
		}
		touched.insert((z, chunk_key_of(x, y)));
		affected.entry(z).or_default().insert((x, y));
		moved.push((z, nx, ny, items));
	}

	for (z, nx, ny, items) in moved {
		for (client, server) in items {
			insert_ordered(tile_stack_mut(m, z, nx, ny), &place, mats, client, server);
		}
		touched.insert((z, chunk_key_of(nx, ny)));
		affected.entry(z).or_default().insert((nx, ny));
	}

	if automagic {
		if let Some(mats) = mats {
			for (&z, tiles) in &affected {
				touched.extend(auto_all(m, mats, &place, otb, z, tiles).into_iter().map(|k| (z, k)));
			}
		}
	}
	m.record_commit(ACTION_MOVE);
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
	m.ensure_tiles(z, &[(x, y)], otb)?;
	m.record_begin();

	let stack = tile_stack_mut(m, z, x, y);
	let before = stack.len();
	let (g, b) = (crate::scripting::ground_class(), crate::scripting::border_class());
	stack.retain(|&(c, s)| {
		let cl = order_class(&place, mats, c, s);
		cl == g || cl == b
	});
	let removed_any = stack.len() != before;

	let mut touched: HashSet<u32> = [chunk_key_of(x, y)].into_iter().collect();
	if automagic && removed_any {
		if let Some(mats) = mats {
			let tiles: HashSet<(u16, u16)> = [(x, y)].into_iter().collect();
			touched.extend(auto_all(m, mats, &place, otb, z, &tiles));
		}
	}
	m.record_commit(ACTION_ERASE);
	Ok(touched.into_iter().collect())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn erase_brush(
	map_id: u32,
	z: u8,
	x: u16,
	y: u16,
	server_id: u16,
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
	m.ensure_tiles(z, &[(x, y)], otb)?;
	m.record_begin();

	let stack = tile_stack_mut(m, z, x, y);
	let before = stack.len();
	stack.retain(|&(_, s)| !same_brush(mats, server_id, s));
	let removed_any = stack.len() != before;

	let mut touched: HashSet<u32> = [chunk_key_of(x, y)].into_iter().collect();
	if automagic && removed_any {
		if let Some(mats) = mats {
			let tiles: HashSet<(u16, u16)> = [(x, y)].into_iter().collect();
			touched.extend(auto_all(m, mats, &place, otb, z, &tiles));
		}
	}
	m.record_commit(ACTION_ERASE);
	Ok(touched.into_iter().collect())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn erase_area(
	map_id: u32,
	z: u8,
	x0: u16,
	y0: u16,
	x1: u16,
	y1: u16,
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
	let (min_x, max_x) = (x0.min(x1), x0.max(x1));
	let (min_y, max_y) = (y0.min(y1), y0.max(y1));
	m.ensure_span(z, min_x, min_y, max_x, max_y, otb)?;
	let (g, b) = (crate::scripting::ground_class(), crate::scripting::border_class());
	let kept = |c: u16, s: u16| {
		let cl = order_class(&place, mats, c, s);
		cl == g || cl == b
	};
	let in_rect = |x: u16, y: u16| x >= min_x && x <= max_x && y >= min_y && y <= max_y;

	let mut to_erase: Vec<(u16, u16)> = Vec::new();
	for cy in (min_y as u32 / CHUNK)..=(max_y as u32 / CHUNK) {
		for cx in (min_x as u32 / CHUNK)..=(max_x as u32 / CHUNK) {
			let chunk = (cx << 16) | cy;
			let edited = m.edits.get(&z).and_then(|c| c.get(&chunk));
			if let Some(&(start, end)) = m.floors.get(&z).and_then(|f| f.get(&chunk)) {
				for t in start as usize..end as usize {
					let (x, y) = (m.tile_x[t], m.tile_y[t]);
					if !in_rect(x, y) {
						continue;
					}
					let pos = (x as u32) << 16 | y as u32;
					if edited.is_some_and(|e| e.contains_key(&pos)) {
						continue;
					}
					if (m.item_off[t] as usize..m.item_off[t + 1] as usize).any(|j| !kept(m.client_ids[j], m.server_ids[j])) {
						to_erase.push((x, y));
					}
				}
			}
			if let Some(e) = edited {
				for (&pos, stack) in e {
					let (x, y) = ((pos >> 16) as u16, (pos & 0xFFFF) as u16);
					if in_rect(x, y) && stack.iter().any(|&(c, s)| !kept(c, s)) {
						to_erase.push((x, y));
					}
				}
			}
		}
	}

	m.record_begin();
	let mut touched: HashSet<u32> = HashSet::new();
	let mut affected: HashSet<(u16, u16)> = HashSet::new();
	for (x, y) in to_erase {
		let stack = tile_stack_mut(m, z, x, y);
		let before = stack.len();
		stack.retain(|&(c, s)| kept(c, s));
		if stack.len() != before {
			touched.insert(chunk_key_of(x, y));
			affected.insert((x, y));
		}
	}

	if automagic && !affected.is_empty() {
		if let Some(mats) = mats {
			touched.extend(auto_all(m, mats, &place, otb, z, &affected));
		}
	}
	m.record_commit(ACTION_ERASE);
	Ok(touched.into_iter().collect())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn delete_selection(
	map_id: u32,
	zs: Vec<u8>,
	xs: Vec<u16>,
	ys: Vec<u16>,
	all: Vec<bool>,
	automagic: bool,
	otb_state: tauri::State<OtbState>,
	map_state: tauri::State<MapState>,
	materials_state: tauri::State<MaterialsState>,
	placement_state: tauri::State<PlacementState>,
) -> Result<Vec<(u8, u32)>, String> {
	if xs.len() != ys.len() || xs.len() != all.len() || xs.len() != zs.len() {
		return Err("selection arrays length mismatch".into());
	}

	let otb_guard = otb_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let otb = otb_guard.as_ref().ok_or("items.otb not loaded")?;
	let materials_guard = materials_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let mats = materials_guard.as_ref();
	let place = placement_state.lock().map_err(|e| format!("Lock error: {}", e))?;

	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let m = guard.maps.get_mut(&map_id).ok_or("map not loaded")?;

	let mut by_floor: HashMap<u8, Vec<(u16, u16)>> = HashMap::new();
	for i in 0..xs.len() {
		by_floor.entry(zs[i]).or_default().push((xs[i], ys[i]));
	}
	for (&z, tiles) in &by_floor {
		m.ensure_tiles(z, tiles, otb)?;
	}
	m.record_begin();

	let mut touched: HashSet<(u8, u32)> = HashSet::new();
	let mut affected: HashMap<u8, HashSet<(u16, u16)>> = HashMap::new();
	for i in 0..xs.len() {
		let (z, x, y) = (zs[i], xs[i], ys[i]);
		let stack = tile_stack_mut(m, z, x, y);
		let changed = if all[i] {
			let had = !stack.is_empty();
			stack.clear();
			had
		} else {
			stack.pop().is_some()
		};
		if changed {
			touched.insert((z, chunk_key_of(x, y)));
			affected.entry(z).or_default().insert((x, y));
		}
	}

	if automagic {
		if let Some(mats) = mats {
			for (&z, tiles) in &affected {
				touched.extend(auto_all(m, mats, &place, otb, z, tiles).into_iter().map(|k| (z, k)));
			}
		}
	}
	m.record_commit(ACTION_DELETE);
	Ok(touched.into_iter().collect())
}

#[tauri::command]
pub fn copy_selection(
	map_id: u32,
	zs: Vec<u8>,
	xs: Vec<u16>,
	ys: Vec<u16>,
	all: Vec<bool>,
	otb_state: tauri::State<OtbState>,
	map_state: tauri::State<MapState>,
	clip_state: tauri::State<CopyBufferState>,
) -> Result<u32, String> {
	if xs.len() != ys.len() || xs.len() != all.len() || xs.len() != zs.len() {
		return Err("selection arrays length mismatch".into());
	}

	let otb_guard = otb_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let otb = otb_guard.as_ref().ok_or("items.otb not loaded")?;
	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let m = guard.maps.get_mut(&map_id).ok_or("map not loaded")?;

	let mut by_floor: HashMap<u8, Vec<(u16, u16)>> = HashMap::new();
	for i in 0..xs.len() {
		by_floor.entry(zs[i]).or_default().push((xs[i], ys[i]));
	}
	for (&z, tiles) in &by_floor {
		m.ensure_tiles(z, tiles, otb)?;
	}

	let min_x = xs.iter().copied().min().unwrap_or(0);
	let min_y = ys.iter().copied().min().unwrap_or(0);
	let min_z = zs.iter().copied().min().unwrap_or(0);

	let mut tiles: Vec<CopyTile> = Vec::new();
	for i in 0..xs.len() {
		let (z, x, y) = (zs[i], xs[i], ys[i]);
		let stack = stack_at(m, z, x, y);
		if stack.is_empty() {
			continue;
		}
		let items = if all[i] { stack } else { vec![*stack.last().unwrap()] };
		tiles.push(CopyTile { dx: x - min_x, dy: y - min_y, dz: (z as i16 - min_z as i16) as i8, items });
	}

	let count = tiles.len() as u32;
	*clip_state.lock().map_err(|e| format!("Lock error: {}", e))? = if tiles.is_empty() { None } else { Some(CopyBuffer { tiles }) };
	Ok(count)
}

#[tauri::command]
pub fn paste_selection(
	map_id: u32,
	x: u16,
	y: u16,
	z: u8,
	otb_state: tauri::State<OtbState>,
	map_state: tauri::State<MapState>,
	materials_state: tauri::State<MaterialsState>,
	placement_state: tauri::State<PlacementState>,
	clip_state: tauri::State<CopyBufferState>,
) -> Result<Vec<(u8, u32)>, String> {
	let clip = clip_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let Some(buffer) = clip.as_ref() else {
		return Ok(Vec::new());
	};

	let otb_guard = otb_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let otb = otb_guard.as_ref().ok_or("items.otb not loaded")?;
	let materials_guard = materials_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let mats = materials_guard.as_ref();
	let place = placement_state.lock().map_err(|e| format!("Lock error: {}", e))?;

	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let m = guard.maps.get_mut(&map_id).ok_or("map not loaded")?;

	let target = |tile: &CopyTile| -> Option<(u8, u16, u16)> {
		let tx = x as u32 + tile.dx as u32;
		let ty = y as u32 + tile.dy as u32;
		let tz = z as i32 + tile.dz as i32;
		if tx > u16::MAX as u32 || ty > u16::MAX as u32 || !(0..=15).contains(&tz) {
			None
		} else {
			Some((tz as u8, tx as u16, ty as u16))
		}
	};

	let mut by_floor: HashMap<u8, Vec<(u16, u16)>> = HashMap::new();
	for tile in &buffer.tiles {
		if let Some((tz, tx, ty)) = target(tile) {
			by_floor.entry(tz).or_default().push((tx, ty));
		}
	}
	for (&tz, tiles) in &by_floor {
		m.ensure_tiles(tz, tiles, otb)?;
	}
	m.record_begin();

	let mut touched: HashSet<(u8, u32)> = HashSet::new();
	for tile in &buffer.tiles {
		let Some((tz, tx, ty)) = target(tile) else {
			continue;
		};
		for &(client, server) in &tile.items {
			insert_ordered(tile_stack_mut(m, tz, tx, ty), &place, mats, client, server);
		}
		touched.insert((tz, chunk_key_of(tx, ty)));
	}
	m.record_commit(ACTION_PAINT);
	Ok(touched.into_iter().collect())
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::map_model::{build_map_model, stack_at};
	use crate::formats::tibia::otb::parse_otb;
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
	fn lua_veto_blocks_placement() {
		use crate::lua_host::LuaHost;
		use std::path::PathBuf;
		let otb = parse_otb(&fs::read(format!("{}/items.otb", DATA)).unwrap()).unwrap();
		let mats = load_materials();
		let grass = otb.client_id(4526).unwrap_or(0);
		let mut place = HashMap::new();
		place.insert(grass, PlaceFlags { ground: true, top_order: 0 });
		let mut m = build_map_model(100, 100, &[], &[], &[], &[], &[], &[], &[], &[], &[], &[], &[], Vec::new(), 0);

		let host = LuaHost::new(PathBuf::from("."));
		host.lua
			.load("nosbor = {}\nfunction nosbor.allow_place(s, hg) return s ~= 4526 end")
			.exec()
			.unwrap();
		let _s = ScopedLua::enter(&host);

		run_paint(&mut m, Some(&mats), &place, &otb, 7, &[50], &[50], 4526, grass, true, false, false);
		assert!(stack_at(&m, 7, 50, 50).is_empty(), "lua veto blocks grass (4526)");

		run_paint(&mut m, Some(&mats), &place, &otb, 7, &[51], &[51], 4527, otb.client_id(4527).unwrap_or(0), false, false, false);
		assert!(!stack_at(&m, 7, 51, 51).is_empty(), "non-vetoed id still places");
	}

	#[test]
	fn borderize_adds_grass_borders_next_to_empty() {
		let otb = parse_otb(&fs::read(format!("{}/items.otb", DATA)).unwrap()).unwrap();
		let mats = load_materials();

		let grass_client = otb.client_id(4526).unwrap_or(0);
		let mut place = HashMap::new();
		place.insert(grass_client, PlaceFlags { ground: true, top_order: 0 });

		let mut m = build_map_model(100, 100, &[50], &[50], &[7], &[0], &[1], &[grass_client], &[4526], &[1], &[], &[], &[], Vec::new(), 0);

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

		let mut m = build_map_model(100, 100, &[50, 51], &[50, 50], &[7, 7], &[0, 1], &[1, 1], &[grass, grass], &[4526, 4526], &[1, 1], &[], &[], &[], Vec::new(), 0);

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
	fn undo_restores_and_redo_reapplies_a_paint() {
		let otb = parse_otb(&fs::read(format!("{}/items.otb", DATA)).unwrap()).unwrap();
		let mats = load_materials();
		let grass = otb.client_id(4526).unwrap_or(0);
		let mut place = HashMap::new();
		place.insert(grass, PlaceFlags { ground: true, top_order: 0 });

		let mut m = build_map_model(100, 100, &[], &[], &[], &[], &[], &[], &[], &[], &[], &[], &[], Vec::new(), 0);

		m.record_begin();
		insert_ordered(tile_stack_mut(&mut m, 7, 50, 50), &place, Some(&mats), grass, 4526);
		borderize(&mut m, &mats, &place, &otb, 7, &[(50, 50)].into_iter().collect(), false);
		m.record_commit(ACTION_PAINT);

		let painted = stack_at(&m, 7, 50, 50);
		assert!(painted.len() > 1, "paint placed grass plus its to-none borders");

		m.undo();
		assert!(stack_at(&m, 7, 50, 50).is_empty(), "undo clears a tile that was empty before");

		m.redo();
		assert_eq!(stack_at(&m, 7, 50, 50), painted, "redo restores the exact stack");
	}

	#[test]
	fn eraser_keeps_ground_and_borders_drops_items() {
		let otb = parse_otb(&fs::read(format!("{}/items.otb", DATA)).unwrap()).unwrap();
		let mats = load_materials();
		let grass = otb.client_id(4526).unwrap_or(0);
		let mut place = HashMap::new();
		place.insert(grass, PlaceFlags { ground: true, top_order: 0 });

		let border_server = *mats.border_item_ids.iter().next().expect("a border item exists");
		let border_client = otb.client_id(border_server).unwrap_or(0);
		let item = (0u16, 1u16);

		assert_eq!(order_class(&place, Some(&mats), grass, 4526), GROUND_CLASS, "grass is ground");
		assert_eq!(order_class(&place, Some(&mats), border_client, border_server), BORDER_CLASS, "border item");
		assert_eq!(order_class(&place, Some(&mats), item.0, item.1), NORMAL_CLASS, "synthetic item is normal");

		let mut m = build_map_model(100, 100, &[], &[], &[], &[], &[], &[], &[], &[], &[], &[], &[], Vec::new(), 0);
		let stack = tile_stack_mut(&mut m, 7, 10, 10);
		*stack = vec![(grass, 4526), (border_client, border_server), item];
		stack.retain(|&(c, s)| matches!(order_class(&place, Some(&mats), c, s), GROUND_CLASS | BORDER_CLASS));

		let result = stack_at(&m, 7, 10, 10);
		assert!(result.iter().any(|&(_, s)| s == 4526), "ground stays");
		assert!(result.iter().any(|&(_, s)| s == border_server), "border stays");
		assert!(!result.contains(&item), "placed item removed");
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
