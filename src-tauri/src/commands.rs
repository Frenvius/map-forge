use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::ipc::Response;

use crate::dat_reader::{encode_dat_to_binary, DatReader};
use crate::materials::Materials;
use crate::otb::parse_otb;
use crate::spr_manager::{SprHeader, SprManagerState};
use crate::{MaterialsState, OtbState, PlaceFlags, PlacementState};

#[derive(Serialize, Deserialize)]
pub struct FileBytes(#[serde(with = "serde_bytes")] Vec<u8>);

#[tauri::command]
pub fn read_file(path: String) -> Result<FileBytes, String> {
	fs::read(&path).map(FileBytes).map_err(|e| format!("Failed to read file {}: {}", path, e))
}

#[tauri::command]
pub fn read_file_text(path: String) -> Result<String, String> {
	fs::read_to_string(&path).map_err(|e| format!("Failed to read file {}: {}", path, e))
}

#[tauri::command]
pub fn read_file_header(path: String, bytes: usize) -> Result<FileBytes, String> {
	use std::io::Read;
	let mut file = fs::File::open(&path).map_err(|e| format!("Failed to open file {}: {}", path, e))?;
	let mut buffer = vec![0u8; bytes];
	file.read_exact(&mut buffer)
		.map_err(|e| format!("Failed to read {} bytes from {}: {}", bytes, path, e))?;
	Ok(FileBytes(buffer))
}

#[tauri::command]
pub fn open_spr_file(path: String, extended: bool, spr_state: tauri::State<SprManagerState>) -> Result<SprHeader, String> {
	let mut manager = spr_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	manager.open_file(path, extended)
}

#[tauri::command]
pub fn close_spr_file(path: String, spr_state: tauri::State<SprManagerState>) -> Result<(), String> {
	let mut manager = spr_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	manager.close_file(&path)
}

#[tauri::command]
pub fn read_sprites_rgba(path: String, ids: Vec<u32>, transparent: bool, spr_state: tauri::State<SprManagerState>) -> Result<Response, String> {
	let mut manager = spr_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let bytes = manager.read_sprites_rgba(&path, ids, transparent)?;
	Ok(Response::new(bytes))
}

#[tauri::command]
pub fn read_sprites_batch_rgba(
	path: String,
	start_id: u32,
	count: u32,
	transparent: bool,
	spr_state: tauri::State<SprManagerState>,
) -> Result<Response, String> {
	let mut manager = spr_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let bytes = manager.read_sprites_batch_rgba(&path, start_id, count, transparent)?;
	Ok(Response::new(bytes))
}

#[tauri::command]
pub fn read_sprites_rgba_lz4(path: String, ids: Vec<u32>, transparent: bool, spr_state: tauri::State<SprManagerState>) -> Result<Response, String> {
	let mut manager = spr_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let bytes = manager.read_sprites_rgba_lz4(&path, ids, transparent)?;
	Ok(Response::new(bytes))
}

#[tauri::command]
pub fn parse_dat_file_bin(path: String, version: u32, placement_state: tauri::State<PlacementState>) -> Result<Response, String> {
	let mut reader = DatReader::open(&path)?;
	reader.set_version(version);
	let (signature, items, outfits, effects, missiles) =
		reader.read_dat().map_err(|e| format!("DAT parse error (version {}): {}", version, e))?;

	let mut placement: HashMap<u16, PlaceFlags> = HashMap::with_capacity(items.len());
	for it in &items {
		let top_order = if it.is_ground_border {
			1
		} else if it.is_on_bottom {
			2
		} else if it.is_on_top {
			3
		} else {
			0
		};
		if it.is_ground || top_order != 0 {
			placement.insert(it.id as u16, PlaceFlags { ground: it.is_ground, top_order });
		}
	}
	*placement_state.lock().map_err(|e| format!("Lock error: {}", e))? = placement;

	let buffer = encode_dat_to_binary(signature, &items, &outfits, &effects, &missiles);
	Ok(Response::new(buffer))
}

#[tauri::command]
pub fn load_materials(data_dir: String, materials_state: tauri::State<MaterialsState>) -> Result<usize, String> {
	let materials = Materials::load(&PathBuf::from(&data_dir))?;
	let count = materials.grounds.len();
	*materials_state.lock().map_err(|e| format!("Lock error: {}", e))? = Some(materials);
	Ok(count)
}

#[tauri::command]
pub fn load_otb(path: String, otb_state: tauri::State<OtbState>) -> Result<usize, String> {
	let bytes = fs::read(&path).map_err(|e| format!("Failed to read {}: {}", path, e))?;
	let items = parse_otb(&bytes)?;
	let count = items.server_to_client.len();
	*otb_state.lock().map_err(|e| format!("Lock error: {}", e))? = Some(items);
	Ok(count)
}

#[tauri::command]
pub fn map_client_ids(server_ids: Vec<u16>, otb_state: tauri::State<OtbState>) -> Result<Vec<u32>, String> {
	let guard = otb_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let otb = guard.as_ref().ok_or("OTB not loaded")?;
	Ok(server_ids
		.into_iter()
		.map(|sid| otb.client_id(sid).map(u32::from).unwrap_or(0))
		.collect())
}

#[tauri::command]
#[allow(unused_variables)]
pub fn set_window_acrylic(window: tauri::Window, enabled: bool, color: Option<(u8, u8, u8, u8)>) -> Result<(), String> {
	#[cfg(target_os = "windows")]
	{
		use window_vibrancy::{apply_acrylic, clear_acrylic};
		if enabled {
			let tint = color.unwrap_or((26, 26, 26, 180));
			apply_acrylic(&window, Some(tint)).map_err(|e| e.to_string())?;
		} else {
			clear_acrylic(&window).map_err(|e| e.to_string())?;
		}
		Ok(())
	}
	#[cfg(not(target_os = "windows"))]
	{
		Err("Acrylic is only supported on Windows".to_string())
	}
}
