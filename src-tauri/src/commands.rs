use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::ipc::Response;

use crate::materials::Materials;
use crate::formats::{FormatManagerState, SpriteHeader};
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
pub fn write_file_text(path: String, contents: String) -> Result<(), String> {
	fs::write(&path, contents).map_err(|e| format!("Failed to write file {}: {}", path, e))
}

#[tauri::command]
pub fn default_data_dir(version: u32) -> String {
	let v = version.to_string();
	let exe = std::env::current_exe().ok();
	let exe_dir = exe.as_deref().and_then(|e| e.parent());
	exe_dir
		.map(|b| b.join("data").join(&v).to_string_lossy().into_owned())
		.unwrap_or_else(|| format!("data{}{}", std::path::MAIN_SEPARATOR, v))
}

#[tauri::command]
pub fn open_data_dir(path: String) -> Result<(), String> {
	let normalized = if cfg!(target_os = "windows") {
		path.replace('/', "\\")
	} else {
		path.clone()
	};
	let p = std::path::Path::new(&normalized);
	fs::create_dir_all(p).map_err(|e| format!("Failed to create {}: {}", normalized, e))?;
	#[cfg(target_os = "windows")]
	let program = "explorer";
	#[cfg(target_os = "macos")]
	let program = "open";
	#[cfg(all(unix, not(target_os = "macos")))]
	let program = "xdg-open";
	std::process::Command::new(program)
		.arg(p)
		.spawn()
		.map_err(|e| format!("Failed to open {}: {}", normalized, e))?;
	Ok(())
}

#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
	#[cfg(target_os = "windows")]
	let result = std::process::Command::new("cmd").args(["/C", "start", "", &url]).spawn();
	#[cfg(target_os = "macos")]
	let result = std::process::Command::new("open").arg(&url).spawn();
	#[cfg(all(unix, not(target_os = "macos")))]
	let result = std::process::Command::new("xdg-open").arg(&url).spawn();
	result.map(|_| ()).map_err(|e| format!("Failed to open {}: {}", url, e))
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
pub fn open_spr_file(path: String, extended: bool, fm: tauri::State<FormatManagerState>) -> Result<SpriteHeader, String> {
	let mut mgr = fm.lock().map_err(|e| format!("Lock error: {}", e))?;
	mgr.sprite().open(&path, extended)
}

#[tauri::command]
pub fn close_spr_file(path: String, fm: tauri::State<FormatManagerState>) -> Result<(), String> {
	let mut mgr = fm.lock().map_err(|e| format!("Lock error: {}", e))?;
	mgr.sprite().close(&path)
}

#[tauri::command]
pub fn read_sprites_rgba(path: String, ids: Vec<u32>, transparent: bool, fm: tauri::State<FormatManagerState>) -> Result<Response, String> {
	let mut mgr = fm.lock().map_err(|e| format!("Lock error: {}", e))?;
	let bytes = mgr.sprite().read_sprites_rgba(&path, &ids, transparent)?;
	Ok(Response::new(bytes))
}

#[tauri::command]
pub fn read_sprites_batch_rgba(
	path: String,
	start_id: u32,
	count: u32,
	transparent: bool,
	fm: tauri::State<FormatManagerState>,
) -> Result<Response, String> {
	let mut mgr = fm.lock().map_err(|e| format!("Lock error: {}", e))?;
	let bytes = mgr.sprite().read_sprites_batch_rgba(&path, start_id, count, transparent)?;
	Ok(Response::new(bytes))
}

#[tauri::command]
pub fn read_sprites_rgba_lz4(path: String, ids: Vec<u32>, transparent: bool, fm: tauri::State<FormatManagerState>) -> Result<Response, String> {
	let mut mgr = fm.lock().map_err(|e| format!("Lock error: {}", e))?;
	let bytes = mgr.sprite().read_sprites_rgba_lz4(&path, &ids, transparent)?;
	Ok(Response::new(bytes))
}

#[tauri::command]
pub fn parse_dat_file_bin(path: String, version: u32, fm: tauri::State<FormatManagerState>, placement_state: tauri::State<PlacementState>) -> Result<Response, String> {
	let mut mgr = fm.lock().map_err(|e| format!("Lock error: {}", e))?;
	let result = mgr.metadata().read_metadata(&path, version)?;

	let mut placement: HashMap<u16, PlaceFlags> = HashMap::with_capacity(result.placement.len());
	for (id, ground, top_order) in &result.placement {
		placement.insert(*id, PlaceFlags { ground: *ground, top_order: *top_order });
	}
	*placement_state.lock().map_err(|e| format!("Lock error: {}", e))? = placement;

	Ok(Response::new(result.encoded))
}

#[tauri::command]
pub fn load_materials(data_dir: String, materials_state: tauri::State<MaterialsState>) -> Result<usize, String> {
	let materials = Materials::load(&PathBuf::from(&data_dir))?;
	let count = materials.grounds.len();
	*materials_state.lock().map_err(|e| format!("Lock error: {}", e))? = Some(materials);
	Ok(count)
}

#[tauri::command]
pub fn load_otb(path: String, fm: tauri::State<FormatManagerState>, otb_state: tauri::State<OtbState>) -> Result<usize, String> {
	let bytes = fs::read(&path).map_err(|e| format!("Failed to read {}: {}", path, e))?;
	let count = fm.lock().map_err(|e| format!("Lock error: {}", e))?.item_db_mut().load(&bytes)?;

	let items = crate::formats::tibia::otb::parse_otb(&bytes)?;
	*otb_state.lock().map_err(|e| format!("Lock error: {}", e))? = Some(items);
	Ok(count)
}

#[tauri::command]
pub fn map_client_ids(server_ids: Vec<u16>, fm: tauri::State<FormatManagerState>) -> Result<Vec<u32>, String> {
	let mgr = fm.lock().map_err(|e| format!("Lock error: {}", e))?;
	Ok(server_ids
		.into_iter()
		.map(|sid| mgr.item_db().client_id(sid).map(u32::from).unwrap_or(0))
		.collect())
}

#[tauri::command]
pub fn all_server_ids(fm: tauri::State<FormatManagerState>) -> Result<Vec<u16>, String> {
	let mgr = fm.lock().map_err(|e| format!("Lock error: {}", e))?;
	let ids = mgr.item_db().all_server_ids();
	if ids.is_empty() {
		return Err("OTB not loaded".to_string());
	}
	Ok(ids)
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
