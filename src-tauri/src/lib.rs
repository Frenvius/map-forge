use std::collections::HashMap;
use std::sync::{Arc, Mutex};

mod spr_manager;
use spr_manager::{SprManager, SprManagerState};

mod dat_writer;
mod dat_reader;

mod nodefile;
mod otb;
mod otbm;
use otb::OtbItems;

mod settings;
use settings::{read_settings, write_settings};

mod materials;
use materials::Materials;

mod commands;
mod map_edit;
mod map_load;
mod map_model;

use commands::{
	close_spr_file, load_materials, load_otb, map_client_ids, open_spr_file, parse_dat_file_bin, read_file, read_file_header,
	read_file_text, read_sprites_batch_rgba, read_sprites_rgba, read_sprites_rgba_lz4, set_window_acrylic,
};
use map_edit::{delete_item, move_item, paint_tiles};
use map_load::open_otbm;
use map_model::{close_map, get_map_chunks, new_otbm, MapStore};

pub(crate) type OtbState = Arc<Mutex<Option<OtbItems>>>;
pub(crate) type MaterialsState = Arc<Mutex<Option<Materials>>>;
pub(crate) type MapState = Arc<Mutex<MapStore>>;

#[derive(Clone, Copy, Default)]
pub(crate) struct PlaceFlags {
	pub(crate) ground: bool,
	pub(crate) top_order: u8,
}

pub(crate) type PlacementState = Arc<Mutex<HashMap<u16, PlaceFlags>>>;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
	let spr_manager: SprManagerState = Arc::new(Mutex::new(SprManager::new()));
	let otb_store: OtbState = Arc::new(Mutex::new(None));
	let map_store: MapState = Arc::new(Mutex::new(MapStore::default()));
	let materials_store: MaterialsState = Arc::new(Mutex::new(None));
	let placement_store: PlacementState = Arc::new(Mutex::new(HashMap::new()));

	tauri::Builder::default()
		.plugin(tauri_plugin_dialog::init())
		.manage(spr_manager)
		.manage(otb_store)
		.manage(map_store)
		.manage(materials_store)
		.manage(placement_store)
		.invoke_handler(tauri::generate_handler![
			read_file,
			read_file_text,
			read_file_header,
			open_spr_file,
			close_spr_file,
			read_sprites_rgba,
			read_sprites_batch_rgba,
			read_sprites_rgba_lz4,
			parse_dat_file_bin,
			load_otb,
			load_materials,
			map_client_ids,
			open_otbm,
			new_otbm,
			close_map,
			paint_tiles,
			move_item,
			delete_item,
			get_map_chunks,
			set_window_acrylic,
			read_settings,
			write_settings
		])
		.setup(move |app| {
			#[cfg(target_os = "macos")]
			{
				use tauri::Manager;
				use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};
				if let Some(window) = app.get_webview_window("main") {
					let _ = apply_vibrancy(&window, NSVisualEffectMaterial::HudWindow, None, Some(12.0));
				}
			}
			#[cfg(target_os = "windows")]
			{
				use tauri::Manager;
				if let Some(window) = app.get_webview_window("main") {
					let _ = window.set_shadow(true);
				}
			}
			Ok(())
		})
		.run(tauri::generate_context!())
		.expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
	use super::otb::parse_otb;
	use super::otbm::{read_otbm, OtbmVisitor};
	use std::fs;

	const DATA: &str = "../data/860";

	#[derive(Default)]
	struct TestCollector {
		width: u16,
		height: u16,
		tiles: usize,
		item_sids: Vec<u16>,
		nonzero_teleports: usize,
		teleports: usize,
	}

	impl OtbmVisitor for TestCollector {
		fn header(&mut self, width: u16, height: u16) {
			self.width = width;
			self.height = height;
		}
		fn progress(&mut self, _pos: usize, _total: usize) {}
		fn tile(&mut self, _x: u16, _y: u16, _z: u8, items: &[u16]) {
			self.tiles += 1;
			self.item_sids.extend_from_slice(items);
		}
		fn teleport(&mut self, _sx: u16, _sy: u16, _sz: u8, dx: u16, dy: u16, dz: u8) {
			self.teleports += 1;
			if dx != 0 || dy != 0 || dz != 0 {
				self.nonzero_teleports += 1;
			}
		}
	}

	#[test]
	fn parses_otb_and_otbm() {
		let otb_bytes = fs::read(format!("{}/items.otb", DATA)).unwrap();
		let otb = parse_otb(&otb_bytes).unwrap();
		println!("OTB server->client entries: {}", otb.server_to_client.len());
		assert!(otb.server_to_client.len() > 1000);

		let map_bytes = fs::read(format!("{}/forgotten.otbm", DATA)).unwrap();
		let mut map = TestCollector::default();
		read_otbm(&map_bytes, &mut map).unwrap();
		println!("OTBM {}x{}, tiles: {}, teleports: {}", map.width, map.height, map.tiles, map.teleports);
		assert!(map.tiles > 100);
		println!("teleports with non-zero dest: {}/{}", map.nonzero_teleports, map.teleports);
		assert!(map.nonzero_teleports > 0);

		let mut mapped = 0usize;
		let mut unmapped = 0usize;
		let mut sample = Vec::new();
		for &sid in &map.item_sids {
			match otb.client_id(sid) {
				Some(c) => {
					mapped += 1;
					if sample.len() < 8 {
						sample.push((sid, c));
					}
				}
				None => unmapped += 1,
			}
		}
		println!("item refs mapped: {}, unmapped: {}, sample(server->client): {:?}", mapped, unmapped, sample);
		assert!(mapped > 100);
	}
}
