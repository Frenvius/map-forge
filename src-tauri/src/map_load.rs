use std::fs;

use tauri::ipc::Response;
use tauri::Emitter;

use crate::map_model::{build_map_model, serialize_meta, store_map, MapModel};
use crate::otb::OtbItems;
use crate::otbm::{read_otbm, OtbmVisitor};
use crate::{MapState, OtbState};

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
	pub(crate) teleports: Vec<u8>,
	pub(crate) teleport_count: u32,
	pub(crate) last_step: i32,
}

impl OtbmCollector<'_> {
	fn finish(self) -> MapModel {
		let model = build_map_model(
			self.width,
			self.height,
			&self.xs,
			&self.ys,
			&self.zs,
			&self.item_start,
			&self.item_count,
			&self.client_ids,
			&self.server_ids,
			self.teleports,
			self.teleport_count,
		);
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

	fn tile(&mut self, x: u16, y: u16, z: u8, items: &[u16]) {
		let start = self.client_ids.len() as u32;
		let mut n: u16 = 0;
		for &sid in items {
			if let Some(cid) = self.otb.client_id(sid) {
				if cid != 0 {
					self.client_ids.push(cid);
					self.server_ids.push(sid);
					n += 1;
				}
			}
		}
		self.xs.push(x);
		self.ys.push(y);
		self.zs.push(z);
		self.item_start.push(start);
		self.item_count.push(n);
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
}

#[tauri::command]
pub async fn open_otbm(
	path: String,
	window: tauri::Window,
	otb_state: tauri::State<'_, OtbState>,
	map_state: tauri::State<'_, MapState>,
) -> Result<Response, String> {
	let otb = otb_state.inner().clone();
	let model = tauri::async_runtime::spawn_blocking(move || -> Result<MapModel, String> {
		let bytes = fs::read(&path).map_err(|e| format!("Failed to read {}: {}", path, e))?;
		let guard = otb.lock().map_err(|e| format!("Lock error: {}", e))?;
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
			teleports: Vec::new(),
			teleport_count: 0,
			last_step: -1,
		};
		read_otbm(&bytes, &mut collector)?;
		Ok(collector.finish())
	})
	.await
	.map_err(|e| format!("otbm task error: {}", e))??;

	let meta = serialize_meta(&model);
	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	Ok(Response::new(store_map(&mut guard, model, meta)))
}
