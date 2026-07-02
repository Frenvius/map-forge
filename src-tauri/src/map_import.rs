use std::collections::{HashMap, HashSet};
use std::fs;

use serde::{Deserialize, Serialize};
use tauri::ipc::Response;

use crate::formats::tibia::otb::OtbItems;
use crate::formats::tibia::otbm::{attrs_key, read_otbm, ItemAttrs, OtbmVisitor};
use crate::map_model::{push_u16, ImportOverlay, MapStore, Town, Waypoint};
use crate::{MapState, OtbState};

const PREVIEW_CAP: u32 = 1024;

pub(crate) struct ImportStage {
	pub min_x: u16,
	pub min_y: u16,
	pub max_x: u16,
	pub max_y: u16,
	pub floors: Vec<u8>,
	pub xs: Vec<u16>,
	pub ys: Vec<u16>,
	pub zs: Vec<u8>,
	pub item_off: Vec<u32>,
	pub client_ids: Vec<u16>,
	pub server_ids: Vec<u16>,
	pub flags: Vec<u32>,
	pub house_ids: Vec<u32>,
	pub door_ids: Vec<u8>,
	pub teleports: Vec<(u16, u16, u8, u16, u16, u8)>,
	pub towns: Vec<Town>,
	pub waypoints: Vec<Waypoint>,
	pub item_attrs: HashMap<u64, ItemAttrs>,
}

pub(crate) type ImportState = std::sync::Arc<std::sync::Mutex<Option<ImportStage>>>;

pub(crate) fn new_import_state() -> ImportState {
	std::sync::Arc::new(std::sync::Mutex::new(None))
}

struct ImportCollector<'a> {
	otb: &'a OtbItems,
	stage: ImportStage,
	report: &'a mut dyn FnMut(f64),
	last_step: i32,
}

impl OtbmVisitor for ImportCollector<'_> {
	fn header(&mut self, _w: u16, _h: u16) {}
	fn progress(&mut self, pos: usize, total: usize) {
		if total == 0 {
			return;
		}
		let step = ((pos as u64 * 200) / total as u64) as i32;
		if step != self.last_step {
			self.last_step = step;
			(self.report)(pos as f64 / total as f64);
		}
	}
	fn tile(&mut self, x: u16, y: u16, z: u8, items: &[(u16, u8)]) {
		for &(sid, _sub) in items {
			let cid = self.otb.client_id(sid).unwrap_or(sid);
			if cid == 0 {
				continue;
			}
			self.stage.client_ids.push(cid);
			self.stage.server_ids.push(sid);
		}
		self.stage.xs.push(x);
		self.stage.ys.push(y);
		self.stage.zs.push(z);
		self.stage.item_off.push(self.stage.client_ids.len() as u32);
		self.stage.flags.push(0);
		self.stage.house_ids.push(0);
		self.stage.door_ids.push(0);
		self.stage.min_x = self.stage.min_x.min(x);
		self.stage.min_y = self.stage.min_y.min(y);
		self.stage.max_x = self.stage.max_x.max(x);
		self.stage.max_y = self.stage.max_y.max(y);
		if !self.stage.floors.contains(&z) {
			self.stage.floors.push(z);
		}
	}
	fn tile_flags(&mut self, _x: u16, _y: u16, _z: u8, flags: u32) {
		if let Some(last) = self.stage.flags.last_mut() {
			*last = flags;
		}
	}
	fn house_tile(&mut self, _x: u16, _y: u16, _z: u8, house_id: u32) {
		if let Some(last) = self.stage.house_ids.last_mut() {
			*last = house_id;
		}
	}
	fn tile_door(&mut self, _x: u16, _y: u16, _z: u8, door_id: u8) {
		if let Some(last) = self.stage.door_ids.last_mut() {
			*last = door_id;
		}
	}
	fn teleport(&mut self, sx: u16, sy: u16, sz: u8, dx: u16, dy: u16, dz: u8) {
		self.stage.teleports.push((sx, sy, sz, dx, dy, dz));
	}
	fn tile_item_attrs(&mut self, x: u16, y: u16, z: u8, stack_idx: u8, ia: ItemAttrs) {
		self.stage.item_attrs.insert(attrs_key(z, x, y, stack_idx), ia);
	}
	fn town(&mut self, id: u32, name: String, x: u16, y: u16, z: u8) {
		self.stage.towns.push(Town { id, name, x, y, z });
	}
	fn waypoint(&mut self, name: String, x: u16, y: u16, z: u8) {
		self.stage.waypoints.push(Waypoint { name, x, y, z });
	}
}

fn empty_stage() -> ImportStage {
	ImportStage {
		min_x: u16::MAX,
		min_y: u16::MAX,
		max_x: 0,
		max_y: 0,
		floors: Vec::new(),
		xs: Vec::new(),
		ys: Vec::new(),
		zs: Vec::new(),
		item_off: vec![0],
		client_ids: Vec::new(),
		server_ids: Vec::new(),
		flags: Vec::new(),
		house_ids: Vec::new(),
		door_ids: Vec::new(),
		teleports: Vec::new(),
		towns: Vec::new(),
		waypoints: Vec::new(),
		item_attrs: HashMap::new(),
	}
}

fn finalize_stage(mut stage: ImportStage) -> ImportStage {
	stage.floors.sort_unstable();
	if stage.xs.is_empty() {
		stage.min_x = 0;
		stage.min_y = 0;
	}
	stage
}

pub(crate) fn parse_import_source(path: &str, otb: &OtbItems, report: &mut dyn FnMut(f64)) -> Result<ImportStage, String> {
	let bytes = fs::read(path).map_err(|e| format!("Failed to read {}: {}", path, e))?;
	let mut col = ImportCollector { otb, stage: empty_stage(), report, last_step: -1 };
	read_otbm(&bytes, &mut col)?;
	Ok(finalize_stage(col.stage))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportInfo {
	pub min_x: u16,
	pub min_y: u16,
	pub max_x: u16,
	pub max_y: u16,
	pub tile_count: u32,
	pub floors: Vec<u8>,
	pub town_count: u32,
	pub waypoint_count: u32,
}

fn info_from(stage: &ImportStage) -> ImportInfo {
	ImportInfo {
		min_x: stage.min_x,
		min_y: stage.min_y,
		max_x: stage.max_x,
		max_y: stage.max_y,
		tile_count: stage.xs.len() as u32,
		floors: stage.floors.clone(),
		town_count: stage.towns.len() as u32,
		waypoint_count: stage.waypoints.len() as u32,
	}
}

#[tauri::command]
pub async fn import_load(
	path: String,
	window: tauri::Window,
	otb_state: tauri::State<'_, OtbState>,
	import_state: tauri::State<'_, ImportState>,
) -> Result<ImportInfo, String> {
	use tauri::Emitter;
	let otb = otb_state.inner().clone();
	let stage = tauri::async_runtime::spawn_blocking(move || -> Result<ImportStage, String> {
		let guard = otb.lock().map_err(|e| format!("Lock error: {}", e))?;
		let empty = OtbItems::default();
		let otb = guard.as_ref().unwrap_or(&empty);
		let mut report = |f: f64| {
			let _ = window.emit("import_load_progress", f);
		};
		parse_import_source(&path, otb, &mut report)
	})
	.await
	.map_err(|e| format!("import task error: {}", e))??;

	let info = info_from(&stage);
	*import_state.lock().map_err(|e| format!("Lock error: {}", e))? = Some(stage);
	Ok(info)
}

#[tauri::command]
pub fn import_cancel(import_state: tauri::State<ImportState>) -> Result<(), String> {
	*import_state.lock().map_err(|e| format!("Lock error: {}", e))? = None;
	Ok(())
}

#[tauri::command]
pub fn import_preview(z: u8, import_state: tauri::State<ImportState>) -> Result<Response, String> {
	let guard = import_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let stage = guard.as_ref().ok_or("no import staged - call import_load first")?;

	let mut out = Vec::new();
	if stage.xs.is_empty() {
		push_u16(&mut out, 0);
		push_u16(&mut out, 0);
		return Ok(Response::new(out));
	}

	let w0 = (stage.max_x - stage.min_x) as u32 + 1;
	let h0 = (stage.max_y - stage.min_y) as u32 + 1;
	let stride = (w0.max(h0)).div_ceil(PREVIEW_CAP).max(1);
	let w = w0.div_ceil(stride) as usize;
	let h = h0.div_ceil(stride) as usize;

	let mut ground = vec![0u16; w * h];
	let mut top = vec![0u16; w * h];
	let n = stage.xs.len();
	for i in 0..n {
		if stage.zs[i] != z {
			continue;
		}
		let s = stage.item_off[i] as usize;
		let e = stage.item_off[i + 1] as usize;
		if e == s {
			continue;
		}
		let cx = ((stage.xs[i] - stage.min_x) as u32 / stride) as usize;
		let cy = ((stage.ys[i] - stage.min_y) as u32 / stride) as usize;
		let idx = cy * w + cx;
		if ground[idx] == 0 {
			ground[idx] = stage.client_ids[s];
		}
		top[idx] = stage.client_ids[e - 1];
	}

	push_u16(&mut out, w as u16);
	push_u16(&mut out, h as u16);
	for i in 0..w * h {
		push_u16(&mut out, ground[i]);
		push_u16(&mut out, top[i]);
	}
	Ok(Response::new(out))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportCommit {
	pub map_id: u32,
	pub dx: i32,
	pub dy: i32,
	pub dz: i32,
	pub house_id_map: HashMap<u32, u32>,
	pub import_towns: bool,
	pub import_waypoints: bool,
	pub import_houses: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
	pub touched: Vec<(u8, u32)>,
	pub town_id_map: HashMap<u32, u32>,
	pub tiles_imported: u32,
	pub tiles_discarded: u32,
	pub teleports_offset: u32,
	pub towns_merged: u32,
	pub waypoints_merged: u32,
}

fn shift_pos(x: u16, y: u16, z: u8, dx: i32, dy: i32, dz: i32) -> Option<(u16, u16, u8)> {
	let nx = x as i32 + dx;
	let ny = y as i32 + dy;
	let nz = z as i32 + dz;
	if !(0..=u16::MAX as i32).contains(&nx) || !(0..=u16::MAX as i32).contains(&ny) || !(0..=15).contains(&nz) {
		None
	} else {
		Some((nx as u16, ny as u16, nz as u8))
	}
}

pub(crate) fn apply_import(
	store: &mut MapStore,
	otb: &OtbItems,
	stage: &ImportStage,
	req: &ImportCommit,
	progress: &mut dyn FnMut(usize, usize),
) -> Result<ImportResult, String> {
	let m = store.maps.get_mut(&req.map_id).ok_or("map not loaded")?;

	let n = stage.xs.len();
	let mut edit_tiles: HashMap<u8, Vec<(u16, u16)>> = HashMap::new();
	let mut planned: Vec<Option<(u16, u16, u8)>> = Vec::with_capacity(n);
	let mut tiles_discarded = 0u32;
	for i in 0..n {
		match shift_pos(stage.xs[i], stage.ys[i], stage.zs[i], req.dx, req.dy, req.dz) {
			Some(t) => {
				edit_tiles.entry(t.2).or_default().push((t.0, t.1));
				planned.push(Some(t));
			}
			None => {
				planned.push(None);
				tiles_discarded += 1;
			}
		}
	}
	for (&z, tiles) in &edit_tiles {
		m.ensure_tiles(z, tiles, otb)?;
	}

	let ops = ImportOverlay {
		dests: &planned,
		item_off: &stage.item_off,
		client_ids: &stage.client_ids,
		server_ids: &stage.server_ids,
		flags: &stage.flags,
		house_ids: &stage.house_ids,
		door_ids: &stage.door_ids,
		house_id_map: &req.house_id_map,
		import_houses: req.import_houses,
	};
	let (touched, tiles_imported) = m.import_overlay(&ops, progress);
	let touched_set: HashSet<(u8, u32)> = touched.into_iter().collect();

	for (&src_key, a) in &stage.item_attrs {
		let sz = (src_key >> 40) as u8;
		let sx = ((src_key >> 24) & 0xFFFF) as u16;
		let sy = ((src_key >> 8) & 0xFFFF) as u16;
		let idx = (src_key & 0xFF) as u8;
		if let Some((nx, ny, nz)) = shift_pos(sx, sy, sz, req.dx, req.dy, req.dz) {
			m.item_attrs.insert(attrs_key(nz, nx, ny, idx), a.clone());
		}
	}

	let mut teleports_offset = 0u32;
	for &(sx, sy, sz, dx, dy, dz) in &stage.teleports {
		let src = shift_pos(sx, sy, sz, req.dx, req.dy, req.dz);
		let dst = shift_pos(dx, dy, dz, req.dx, req.dy, req.dz);
		let (Some(a), Some(b)) = (src, dst) else { continue };
		m.teleports.extend_from_slice(&a.0.to_le_bytes());
		m.teleports.extend_from_slice(&a.1.to_le_bytes());
		m.teleports.push(a.2);
		m.teleports.extend_from_slice(&b.0.to_le_bytes());
		m.teleports.extend_from_slice(&b.1.to_le_bytes());
		m.teleports.push(b.2);
		m.teleport_count += 1;
		teleports_offset += 1;
	}

	let mut town_id_map: HashMap<u32, u32> = HashMap::new();
	let mut towns_merged = 0u32;
	if req.import_towns {
		let existing: HashSet<u32> = m.towns.iter().map(|t| t.id).collect();
		let mut next_id: u32 = existing.iter().copied().max().unwrap_or(0);
		for t in &stage.towns {
			let Some((nx, ny, nz)) = shift_pos(t.x, t.y, t.z, req.dx, req.dy, req.dz) else {
				continue;
			};
			let new_id = if existing.contains(&t.id) {
				next_id += 1;
				next_id
			} else {
				t.id
			};
			town_id_map.insert(t.id, new_id);
			m.towns.push(Town { id: new_id, name: t.name.clone(), x: nx, y: ny, z: nz });
			towns_merged += 1;
		}
	}

	let mut waypoints_merged = 0u32;
	if req.import_waypoints {
		for w in &stage.waypoints {
			let Some((nx, ny, nz)) = shift_pos(w.x, w.y, w.z, req.dx, req.dy, req.dz) else {
				continue;
			};
			m.waypoints.push(Waypoint { name: w.name.clone(), x: nx, y: ny, z: nz });
			waypoints_merged += 1;
		}
	}

	Ok(ImportResult {
		touched: touched_set.into_iter().collect(),
		town_id_map,
		tiles_imported,
		tiles_discarded,
		teleports_offset,
		towns_merged,
		waypoints_merged,
	})
}

#[tauri::command]
pub async fn import_commit(
	req: ImportCommit,
	window: tauri::Window,
	otb_state: tauri::State<'_, OtbState>,
	map_state: tauri::State<'_, MapState>,
	import_state: tauri::State<'_, ImportState>,
) -> Result<ImportResult, String> {
	use tauri::Emitter;
	let otb = otb_state.inner().clone();
	let map = map_state.inner().clone();
	let import = import_state.inner().clone();
	tauri::async_runtime::spawn_blocking(move || -> Result<ImportResult, String> {
		let mut import_guard = import.lock().map_err(|e| format!("Lock error: {}", e))?;
		let stage = import_guard.as_ref().ok_or("no import staged - call import_load first")?;

		let otb_guard = otb.lock().map_err(|e| format!("Lock error: {}", e))?;
		let empty_otb = OtbItems::default();
		let otb = otb_guard.as_ref().unwrap_or(&empty_otb);

		let mut store = map.lock().map_err(|e| format!("Lock error: {}", e))?;
		let mut last_step = -1i32;
		let mut report = |pos: usize, total: usize| {
			if total == 0 {
				return;
			}
			let step = ((pos as u64 * 100) / total as u64) as i32;
			if step != last_step {
				last_step = step;
				let _ = window.emit("import_progress", pos as f64 / total as f64);
			}
		};
		let result = apply_import(&mut store, otb, stage, &req, &mut report)?;

		drop(store);
		drop(otb_guard);
		*import_guard = None;
		Ok(result)
	})
	.await
	.map_err(|e| format!("import commit task error: {}", e))?
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::formats::tibia::otbm_write::NodeWriter;
	use crate::map_model::{empty_model, flags_at, house_id_at, stack_at, MapStore};

	const OTBM_MAP_DATA: u8 = 2;
	const OTBM_TILE_AREA: u8 = 4;
	const OTBM_TILE: u8 = 5;
	const OTBM_ATTR_ITEM: u8 = 9;

	fn build_tiny_otbm() -> Vec<u8> {
		let mut w = NodeWriter::with_capacity(256);
		w.identifier(&[0, 0, 0, 0]);
		w.node_start(0);
		w.u32(2);
		w.u16(1024);
		w.u16(1024);
		w.u32(3);
		w.u32(860);
		w.node_start(OTBM_MAP_DATA);
		w.node_start(OTBM_TILE_AREA);
		w.u16(100 & 0xFF00);
		w.u16(200 & 0xFF00);
		w.u8(7);
		w.node_start(OTBM_TILE);
		w.u8((100 & 0xFF) as u8);
		w.u8((200 & 0xFF) as u8);
		w.u8(OTBM_ATTR_ITEM);
		w.u16(1234);
		w.node_end();
		w.node_end();
		w.node_end();
		w.node_end();
		w.into_bytes()
	}

	#[test]
	fn parse_stages_a_tile() {
		let bytes = build_tiny_otbm();
		let tmp = std::env::temp_dir().join("mapforge_import_parse_test.otbm");
		std::fs::write(&tmp, &bytes).unwrap();
		let stage = parse_import_source(tmp.to_str().unwrap(), &OtbItems::default(), &mut |_| {}).unwrap();
		assert_eq!(stage.xs.len(), 1);
		assert_eq!(stage.xs[0], 100);
		assert_eq!(stage.ys[0], 200);
		assert_eq!(stage.zs[0], 7);
		assert_eq!(stage.server_ids, vec![1234]);
		assert_eq!(stage.floors, vec![7]);
		let _ = std::fs::remove_file(&tmp);
	}

	fn make_stage() -> ImportStage {
		ImportStage {
			min_x: 50,
			min_y: 60,
			max_x: 50,
			max_y: 60,
			floors: vec![7],
			xs: vec![50],
			ys: vec![60],
			zs: vec![7],
			item_off: vec![0, 2],
			client_ids: vec![10, 20],
			server_ids: vec![100, 200],
			flags: vec![0x02],
			house_ids: vec![5],
			door_ids: vec![3],
			teleports: vec![(50, 60, 7, 55, 60, 7)],
			towns: vec![Town { id: 1, name: "A".into(), x: 50, y: 60, z: 7 }],
			waypoints: vec![Waypoint { name: "wp".into(), x: 50, y: 60, z: 7 }],
			item_attrs: HashMap::new(),
		}
	}

	#[test]
	fn apply_import_injects_tile_at_offset() {
		let mut store = MapStore::default();
		store.maps.insert(1, empty_model(1024, 1024));
		let mut req = ImportCommit {
			map_id: 1,
			dx: 100,
			dy: 200,
			dz: 0,
			house_id_map: HashMap::new(),
			import_towns: true,
			import_waypoints: true,
			import_houses: true,
		};
		req.house_id_map.insert(5, 42);

		let result = apply_import(&mut store, &OtbItems::default(), &make_stage(), &req, &mut |_, _| {}).unwrap();
		assert_eq!(result.tiles_imported, 1);
		assert_eq!(result.tiles_discarded, 0);
		assert_eq!(result.teleports_offset, 1);
		assert_eq!(result.towns_merged, 1);
		assert_eq!(result.waypoints_merged, 1);

		let m = store.maps.get(&1).unwrap();
		let stack = stack_at(m, 7, 150, 260);
		assert_eq!(stack, vec![(10u16, 100u16), (20, 200)]);
		assert_eq!(house_id_at(m, 7, 150, 260), 42);
		assert_eq!(flags_at(m, 7, 150, 260), 0x02);
		assert_eq!(m.teleport_count, 1);
		assert_eq!(m.towns.len(), 1);
		assert_eq!(m.towns[0].x, 150);
		assert_eq!(m.towns[0].y, 260);
		assert_eq!(m.waypoints[0].x, 150);
	}

	#[test]
	fn discard_house_when_flag_off() {
		let mut store = MapStore::default();
		store.maps.insert(1, empty_model(1024, 1024));
		let req = ImportCommit {
			map_id: 1,
			dx: 0,
			dy: 0,
			dz: 0,
			house_id_map: HashMap::new(),
			import_towns: false,
			import_waypoints: false,
			import_houses: false,
		};
		let result = apply_import(&mut store, &OtbItems::default(), &make_stage(), &req, &mut |_, _| {}).unwrap();
		assert_eq!(result.tiles_imported, 0);
		assert_eq!(result.towns_merged, 0);
	}

	#[test]
	fn town_id_collision_gets_new_id() {
		let mut store = MapStore::default();
		let mut m = empty_model(1024, 1024);
		m.towns.push(Town { id: 1, name: "Existing".into(), x: 10, y: 10, z: 7 });
		store.maps.insert(1, m);
		let req = ImportCommit {
			map_id: 1,
			dx: 0,
			dy: 0,
			dz: 0,
			house_id_map: HashMap::new(),
			import_towns: true,
			import_waypoints: false,
			import_houses: true,
		};
		let result = apply_import(&mut store, &OtbItems::default(), &make_stage(), &req, &mut |_, _| {}).unwrap();
		assert_eq!(result.town_id_map.get(&1), Some(&2));
		let m = store.maps.get(&1).unwrap();
		assert_eq!(m.towns.len(), 2);
		assert_eq!(m.towns[1].id, 2);
	}

	#[test]
	fn item_off_maps_each_tile_to_its_own_items() {
		let mut w = NodeWriter::with_capacity(512);
		w.identifier(&[0, 0, 0, 0]);
		w.node_start(0);
		w.u32(2);
		w.u16(1024);
		w.u16(1024);
		w.u32(3);
		w.u32(860);
		w.node_start(OTBM_MAP_DATA);
		w.node_start(OTBM_TILE_AREA);
		w.u16(0);
		w.u16(0);
		w.u8(7);
		for (dx, ground) in [(0u8, 11u16), (1, 22), (2, 33)] {
			w.node_start(OTBM_TILE);
			w.u8(dx);
			w.u8(0);
			w.u8(OTBM_ATTR_ITEM);
			w.u16(ground);
			w.node_end();
		}
		w.node_end();
		w.node_end();
		w.node_end();
		let bytes = w.into_bytes();
		let tmp = std::env::temp_dir().join("mapforge_import_itemoff_test.otbm");
		std::fs::write(&tmp, &bytes).unwrap();
		let stage = parse_import_source(tmp.to_str().unwrap(), &OtbItems::default(), &mut |_| {}).unwrap();
		let _ = std::fs::remove_file(&tmp);

		assert_eq!(stage.xs, vec![0, 1, 2]);
		assert_eq!(stage.item_off, vec![0, 1, 2, 3], "each tile owns exactly one item slot");
		for i in 0..stage.xs.len() {
			let s = stage.item_off[i] as usize;
			let e = stage.item_off[i + 1] as usize;
			assert_eq!(&stage.server_ids[s..e], &[[11u16, 22, 33][i]], "tile {} keeps its own ground", i);
		}
	}

	#[test]
	fn out_of_bounds_offset_discards_tile() {
		let mut store = MapStore::default();
		store.maps.insert(1, empty_model(1024, 1024));
		let req = ImportCommit {
			map_id: 1,
			dx: -100,
			dy: -200,
			dz: 0,
			house_id_map: HashMap::new(),
			import_towns: false,
			import_waypoints: false,
			import_houses: true,
		};
		let result = apply_import(&mut store, &OtbItems::default(), &make_stage(), &req, &mut |_, _| {}).unwrap();
		assert_eq!(result.tiles_discarded, 1);
		assert_eq!(result.tiles_imported, 0);
	}
}
