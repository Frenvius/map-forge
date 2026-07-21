use std::collections::HashMap;
use std::fs;
use std::io::Read;

use tauri::ipc::Response;
use tauri::Emitter;

use crate::map_model::{build_map_model, lazy_model, serialize_meta, store_map, MapModel, Town, Waypoint};
use crate::formats::tibia::otb::OtbItems;
use crate::formats::tibia::otbm::{attrs_key, read_otbm, read_otbm_header, ContainedItem, ItemAttrs, OtbmVisitor};
use crate::formats::tibia::otbm_footer::MapIndex;
use crate::{MapState, OtbState};

fn read_head(path: &std::path::Path, max: usize) -> Result<Vec<u8>, String> {
	let mut f = std::fs::File::open(path).map_err(|e| format!("Failed to open {}: {}", path.display(), e))?;
	let len = f.metadata().map(|m| m.len() as usize).unwrap_or(max).min(max);
	let mut buf = vec![0u8; len];
	f.read_exact(&mut buf).map_err(|e| format!("read error: {}", e))?;
	Ok(buf)
}

fn read_footer_index(path: &std::path::Path) -> Option<MapIndex> {
	let sidecar = path.with_extension("otmi");
	let bytes = std::fs::read(&sidecar).ok()?;
	let idx = MapIndex::decode(&bytes)?;
	let size = std::fs::metadata(path).ok()?.len();
	if idx.source_size != size {
		return None;
	}
	Some(idx)
}

pub(crate) struct OtbmCollector<'a> {
	pub(crate) otb: &'a OtbItems,
	pub(crate) window: tauri::Window,
	pub(crate) width: u16,
	pub(crate) height: u16,
	pub(crate) xs: Vec<u16>,
	pub(crate) ys: Vec<u16>,
	pub(crate) zs: Vec<u8>,
	pub(crate) item_start: Vec<u32>,
	pub(crate) item_count: Vec<u16>,
	pub(crate) client_ids: Vec<u16>,
	pub(crate) server_ids: Vec<u16>,
	pub(crate) subtypes: Vec<u8>,
	pub(crate) flags: Vec<u32>,
	pub(crate) house_ids: Vec<u32>,
	pub(crate) door_ids: Vec<u8>,
	pub(crate) teleports: Vec<u8>,
	pub(crate) teleport_count: u32,
	pub(crate) last_step: i32,
	pub(crate) description: String,
	pub(crate) spawn_file: String,
	pub(crate) house_file: String,
	pub(crate) otbm_version: u32,
	pub(crate) items_major: u32,
	pub(crate) items_minor: u32,
	pub(crate) towns: Vec<Town>,
	pub(crate) waypoints: Vec<Waypoint>,
	pub(crate) house_tile_count: u32,
	pub(crate) item_attrs: HashMap<u64, ItemAttrs>,
	pub(crate) container_contents: HashMap<u64, Vec<ContainedItem>>,
}

impl OtbmCollector<'_> {
	fn finish(self) -> MapModel {
		let mut model = build_map_model(
			self.width,
			self.height,
			&self.xs,
			&self.ys,
			&self.zs,
			&self.item_start,
			&self.item_count,
			&self.client_ids,
			&self.server_ids,
			&self.subtypes,
			&self.flags,
			&self.house_ids,
			&self.door_ids,
			self.teleports,
			self.teleport_count,
		);
		model.description = self.description;
		model.spawn_file = self.spawn_file;
		model.house_file = self.house_file;
		model.otbm_version = self.otbm_version;
		model.items_major = self.items_major;
		model.items_minor = self.items_minor;
		model.towns = self.towns;
		model.waypoints = self.waypoints;
		model.house_tile_count = self.house_tile_count;
		model.item_attrs = self.item_attrs;
		model.container_contents = self.container_contents;
		let _ = self.window.emit("otbm_progress", 1.0_f64);
		model
	}
}

impl OtbmVisitor for OtbmCollector<'_> {
	fn header(&mut self, width: u16, height: u16) {
		self.width = width;
		self.height = height;
	}

	fn progress(&mut self, pos: usize, total: usize) {
		if total == 0 {
			return;
		}
		let step = ((pos as u64 * 200) / total as u64) as i32;
		if step != self.last_step {
			self.last_step = step;
			let _ = self.window.emit("otbm_progress", pos as f64 / total as f64);
		}
	}

	fn tile(&mut self, x: u16, y: u16, z: u8, items: &[(u16, u8)]) {
		let start = self.client_ids.len() as u32;
		let mut n: u16 = 0;
		for &(sid, sub) in items {
			if let Some(cid) = self.otb.client_id(sid) {
				if cid != 0 {
					self.client_ids.push(cid);
					self.server_ids.push(sid);
					self.subtypes.push(sub);
					n += 1;
				}
			}
		}
		self.xs.push(x);
		self.ys.push(y);
		self.zs.push(z);
		self.item_start.push(start);
		self.item_count.push(n);
		self.flags.push(0);
		self.house_ids.push(0);
		self.door_ids.push(0);
	}

	fn tile_flags(&mut self, _x: u16, _y: u16, _z: u8, flags: u32) {
		if let Some(last) = self.flags.last_mut() {
			*last = flags;
		}
	}

	fn teleport(&mut self, sx: u16, sy: u16, sz: u8, dx: u16, dy: u16, dz: u8) {
		self.teleports.extend_from_slice(&sx.to_le_bytes());
		self.teleports.extend_from_slice(&sy.to_le_bytes());
		self.teleports.push(sz);
		self.teleports.extend_from_slice(&dx.to_le_bytes());
		self.teleports.extend_from_slice(&dy.to_le_bytes());
		self.teleports.push(dz);
		self.teleport_count += 1;
	}

	fn map_version(&mut self, otbm: u32, items_major: u32, items_minor: u32) {
		self.otbm_version = otbm;
		self.items_major = items_major;
		self.items_minor = items_minor;
	}

	fn map_description(&mut self, text: String) {
		self.description = text;
	}

	fn spawn_file(&mut self, name: String) {
		self.spawn_file = name;
	}

	fn house_file(&mut self, name: String) {
		self.house_file = name;
	}

	fn house_tile(&mut self, _x: u16, _y: u16, _z: u8, house_id: u32) {
		if let Some(last) = self.house_ids.last_mut() {
			*last = house_id;
		}
		self.house_tile_count += 1;
	}

	fn tile_door(&mut self, _x: u16, _y: u16, _z: u8, door_id: u8) {
		if let Some(last) = self.door_ids.last_mut() {
			*last = door_id;
		}
	}

	fn tile_item_attrs(&mut self, x: u16, y: u16, z: u8, stack_idx: u8, ia: ItemAttrs) {
		self.item_attrs.insert(attrs_key(z, x, y, stack_idx), ia);
	}

	fn tile_item_contents(&mut self, x: u16, y: u16, z: u8, stack_idx: u8, contents: Vec<ContainedItem>) {
		self.container_contents.insert(attrs_key(z, x, y, stack_idx), contents);
	}

	fn town(&mut self, id: u32, name: String, x: u16, y: u16, z: u8) {
		self.towns.push(Town { id, name, x, y, z });
	}

	fn waypoint(&mut self, name: String, x: u16, y: u16, z: u8) {
		self.waypoints.push(Waypoint { name, x, y, z });
	}
}

#[tauri::command]
pub async fn open_otbm(
	path: String,
	window: tauri::Window,
	otb_state: tauri::State<'_, OtbState>,
	map_state: tauri::State<'_, MapState>,
) -> Result<Response, String> {
	let otb = otb_state.inner().clone();
	let source_path = std::path::PathBuf::from(&path);
	let model = tauri::async_runtime::spawn_blocking(move || -> Result<MapModel, String> {
		if let Some(idx) = read_footer_index(&source_path) {
			let head = read_head(&source_path, 4096)?;
			let (width, height) = read_otbm_header(&head)?;
			let _ = window.emit("otbm_progress", 1.0_f64);
			return Ok(lazy_model(width, height, &idx, source_path));
		}

		let bytes = fs::read(&path).map_err(|e| format!("Failed to read {}: {}", path, e))?;
		let guard = otb.read().map_err(|e| format!("Lock error: {}", e))?;
		let otb = guard.as_ref().ok_or("items.otb not loaded - call load_otb first")?;

		let mut collector = OtbmCollector {
			otb,
			window,
			width: 0,
			height: 0,
			xs: Vec::new(),
			ys: Vec::new(),
			zs: Vec::new(),
			item_start: Vec::new(),
			item_count: Vec::new(),
			client_ids: Vec::new(),
			server_ids: Vec::new(),
			subtypes: Vec::new(),
			flags: Vec::new(),
			house_ids: Vec::new(),
			door_ids: Vec::new(),
			teleports: Vec::new(),
			teleport_count: 0,
			last_step: -1,
			description: String::new(),
			spawn_file: String::new(),
			house_file: String::new(),
			otbm_version: 0,
			items_major: 0,
			items_minor: 0,
			towns: Vec::new(),
			waypoints: Vec::new(),
			house_tile_count: 0,
			item_attrs: HashMap::new(),
			container_contents: HashMap::new(),
		};
		read_otbm(&bytes, &mut collector)?;
		let mut model = collector.finish();
		model.source_path = Some(source_path);
		Ok(model)
	})
	.await
	.map_err(|e| format!("otbm task error: {}", e))??;

	let meta = serialize_meta(&model);
	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	Ok(Response::new(store_map(&mut guard, model, meta)))
}
