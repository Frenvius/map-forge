use std::collections::HashMap;
use std::sync::{Arc, Mutex};

mod formats;
use formats::{FormatManager, FormatManagerState};
use formats::tibia::otb::OtbItems;

mod settings;
use settings::{read_settings, write_settings};

mod materials;
use materials::Materials;

mod commands;
mod creatures;
mod lua_format;
mod lua_host;
mod map_edit;
mod map_load;
mod map_meta;
mod map_model;
mod map_save;
mod scripting;

use formats::tibia::client_version::peek_otbm_version;
use commands::{
	all_server_ids, close_spr_file, default_data_dir, load_materials, load_otb, map_client_ids, open_data_dir, open_spr_file,
	open_url, parse_dat_file_bin, read_file, read_file_header, read_file_text, read_sprites_batch_rgba, read_sprites_rgba,
	read_sprites_rgba_lz4, set_window_acrylic, write_file_text,
};
use creatures::{
	creature_dirs, resolve_creature_dirs, resolve_items_dir, scan_creatures, unwatch_creatures, watch_creatures,
	CreatureWatcherState,
};
use map_edit::{
	copy_selection, delete_item, delete_selection, erase_area, erase_brush, house_sizes, move_item, move_selection, paint_tiles,
	paint_zone, paste_selection,
	preview_paint, set_house, CopyBuffer,
};
use lua_format::{
	item_name, item_names, item_sprite, load_scripted_assets, load_scripted_itemdb, open_scripted_map, registered_formats,
	app_config, lua_app_config, scripted_things, ui_config, ClientIdState, ItemDb, ItemDbState, ItemSpriteState, ThingDef,
	ThingsState,
};
use lua_host::{list_scripts, read_script, reload_scripts, scripts_dir, write_script, LuaHost, LuaState};
use map_load::open_otbm;
use map_meta::{get_map_properties, get_towns, get_waypoints, map_statistics, set_map_properties, set_towns};
use map_model::{
	close_map, get_chunk_tooltips, get_map_chunks, get_minimap, get_tile_items, new_otbm, redo_edit, set_minimap_palette,
	undo_edit, MapStore,
};
use map_save::save_otbm;

pub(crate) type OtbState = Arc<Mutex<Option<OtbItems>>>;
pub(crate) type MaterialsState = Arc<Mutex<Option<Materials>>>;
pub(crate) type MapState = Arc<Mutex<MapStore>>;
pub(crate) type MinimapPaletteState = Arc<Mutex<Vec<u8>>>;

#[derive(Clone, Copy, Default)]
pub(crate) struct PlaceFlags {
	pub(crate) ground: bool,
	pub(crate) top_order: u8,
}

pub(crate) type PlacementState = Arc<Mutex<HashMap<u16, PlaceFlags>>>;
pub(crate) type CopyBufferState = Arc<Mutex<Option<CopyBuffer>>>;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
	let format_manager: FormatManagerState = Arc::new(Mutex::new(FormatManager::new(
		Box::new(formats::tibia::spr_manager::SprManager::new()),
		Box::new(formats::tibia::providers::TibiaMetadataProvider),
		Box::new(formats::tibia::providers::TibiaItemDatabase::new()),
	)));
	let otb_store: OtbState = Arc::new(Mutex::new(None));
	let map_store: MapState = Arc::new(Mutex::new(MapStore::default()));
	let materials_store: MaterialsState = Arc::new(Mutex::new(None));
	let placement_store: PlacementState = Arc::new(Mutex::new(HashMap::new()));
	let copy_buffer: CopyBufferState = Arc::new(Mutex::new(None));
	let minimap_palette: MinimapPaletteState = Arc::new(Mutex::new(Vec::new()));
	let creature_watcher: CreatureWatcherState = Mutex::new(None);
	let lua_host: LuaState = Arc::new(Mutex::new(LuaHost::new(scripts_dir())));
	let item_db: ItemDbState = Arc::new(Mutex::new(ItemDb::default()));
	let item_sprites: ItemSpriteState = Arc::new(Mutex::new(HashMap::new()));
	let scripted_things_state: ThingsState = Arc::new(Mutex::new(Vec::<ThingDef>::new()));
	let client_id_state: ClientIdState = Arc::new(Mutex::new(HashMap::new()));

	let mut builder = tauri::Builder::default()
		.plugin(tauri_plugin_dialog::init());

	#[cfg(debug_assertions)]
	{
		builder = builder.plugin(tauri_plugin_mcp_bridge::init());
	}

	builder
		.manage(format_manager)
		.manage(otb_store)
		.manage(map_store)
		.manage(materials_store)
		.manage(placement_store)
		.manage(copy_buffer)
		.manage(minimap_palette)
		.manage(creature_watcher)
		.manage(lua_host)
		.manage(item_db)
		.manage(item_sprites)
		.manage(scripted_things_state)
		.manage(client_id_state)
		.invoke_handler(tauri::generate_handler![
			reload_scripts,
			list_scripts,
			read_script,
			write_script,
			open_scripted_map,
			load_scripted_itemdb,
			load_scripted_assets,
			scripted_things,
			registered_formats,
			item_name,
			item_names,
			item_sprite,
			ui_config,
			app_config,
			read_file,
			read_file_text,
			write_file_text,
			read_file_header,
			default_data_dir,
			open_data_dir,
			open_url,
			open_spr_file,
			close_spr_file,
			read_sprites_rgba,
			read_sprites_batch_rgba,
			read_sprites_rgba_lz4,
			parse_dat_file_bin,
			load_otb,
			load_materials,
			map_client_ids,
			all_server_ids,
			open_otbm,
			save_otbm,
			new_otbm,
			close_map,
			get_towns,
			set_towns,
			get_waypoints,
			get_map_properties,
			set_map_properties,
			map_statistics,
			paint_tiles,
			paint_zone,
			set_house,
			house_sizes,
			preview_paint,
			move_item,
			move_selection,
			delete_item,
			erase_area,
			erase_brush,
			delete_selection,
			copy_selection,
			paste_selection,
			undo_edit,
			redo_edit,
			get_tile_items,
			get_map_chunks,
			get_chunk_tooltips,
			get_minimap,
			set_minimap_palette,
			set_window_acrylic,
			read_settings,
			write_settings,
			resolve_creature_dirs,
			creature_dirs,
			resolve_items_dir,
			scan_creatures,
			watch_creatures,
			unwatch_creatures,
			peek_otbm_version
		])
		.setup(move |app| {
			{
				use tauri::Manager;
				let state = app.state::<LuaState>().inner().clone();
				let locked = state.lock();
				if let Ok(mut h) = locked {
					match h.load_all() {
						Ok(n) => println!("[lua] loaded {} script(s) from {}", n, h.dir.display()),
						Err(e) => {
							h.last_error = Some(e.clone());
							eprintln!("[lua] load failed: {}", e);
						}
					}
				}
				if let Some(name) = lua_app_config(&state).name {
					if let Some(window) = app.get_webview_window("main") {
						let _ = window.set_title(&name);
					}
				}
			}
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
	use super::formats::tibia::otb::parse_otb;
	use super::formats::tibia::otbm::{read_otbm, OtbmVisitor};
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
		fn tile(&mut self, _x: u16, _y: u16, _z: u8, items: &[(u16, u8)]) {
			self.tiles += 1;
			self.item_sids.extend(items.iter().map(|&(id, _)| id));
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
