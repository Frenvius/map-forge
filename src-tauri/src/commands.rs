use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::ipc::Response;

use crate::materials::Materials;
use crate::formats::{DatOverrides, FormatManagerState, SpriteHeader};
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
pub async fn backup_map(path: String, keep: u32) -> Result<(), String> {
	if keep == 0 {
		return Ok(());
	}
	let src = PathBuf::from(&path);
	let dir = src.parent().ok_or("no parent dir")?.to_path_buf();
	let stem = src.file_stem().and_then(|s| s.to_str()).ok_or("no file stem")?.to_string();
	let backups_root = dir.join("backups").join(&stem);
	let ts = std::time::SystemTime::now()
		.duration_since(std::time::UNIX_EPOCH)
		.map_err(|e| e.to_string())?
		.as_secs();
	let snap = backups_root.join(ts.to_string());
	fs::create_dir_all(&snap).map_err(|e| e.to_string())?;
	let prefix_dot = format!("{}.", stem);
	let prefix_dash = format!("{}-", stem);
	for entry in fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
		let p = entry.path();
		if !p.is_file() {
			continue;
		}
		let name = match entry.file_name().to_str() {
			Some(n) => n.to_string(),
			None => continue,
		};
		if name.starts_with(&prefix_dot) || name.starts_with(&prefix_dash) {
			let _ = fs::copy(&p, snap.join(&name));
		}
	}
	let mut snaps: Vec<PathBuf> = fs::read_dir(&backups_root)
		.map_err(|e| e.to_string())?
		.flatten()
		.map(|e| e.path())
		.filter(|p| p.is_dir())
		.collect();
	snaps.sort();
	while snaps.len() > keep as usize {
		let old = snaps.remove(0);
		let _ = fs::remove_dir_all(old);
	}
	Ok(())
}

pub fn legacy_data_dir(version: u32, custom_root: Option<String>) -> String {
	let exe = std::env::current_exe().ok();
	let exe_dir = exe.as_deref().and_then(|e| e.parent());
	let root = custom_root.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
	if let Some(root) = root {
		return PathBuf::from(root).join(version.to_string()).to_string_lossy().into_owned();
	}
	let sub = format!("data{}{}", std::path::MAIN_SEPARATOR, version);
	exe_dir.map(|b| b.join(&sub).to_string_lossy().into_owned()).unwrap_or(sub)
}

#[tauri::command]
pub fn project_data_dir(
	app: tauri::AppHandle,
	version: u32,
	project: tauri::State<crate::project::ProjectState>,
) -> Result<String, String> {
	let from_project = project
		.lock()
		.map_err(|e| e.to_string())?
		.project
		.as_ref()
		.and_then(|p| p.data_dir(version));
	Ok(match from_project {
		Some(dir) => dir.to_string_lossy().into_owned(),
		None => legacy_data_dir(version, crate::settings::legacy_data_dir(&app)),
	})
}

#[tauri::command]
pub fn default_data_root() -> String {
	let exe = std::env::current_exe().ok();
	let exe_dir = exe.as_deref().and_then(|e| e.parent());
	exe_dir
		.map(|b| b.join("data").to_string_lossy().into_owned())
		.unwrap_or_else(|| "data".to_string())
}

#[tauri::command]
pub fn copy_data_dir(from: String, to: String) -> Result<(), String> {
	let src = PathBuf::from(&from);
	let dst = PathBuf::from(&to);
	if src == dst {
		return Ok(());
	}
	if !src.is_dir() {
		return Err(format!("source {} is not a folder", from));
	}
	copy_path(&src, &dst)
}

fn copy_path(src: &std::path::Path, dst: &std::path::Path) -> Result<(), String> {
	if src.is_dir() {
		fs::create_dir_all(dst).map_err(|e| e.to_string())?;
		for entry in fs::read_dir(src).map_err(|e| e.to_string())?.flatten() {
			copy_path(&entry.path(), &dst.join(entry.file_name()))?;
		}
	} else {
		if let Some(parent) = dst.parent() {
			fs::create_dir_all(parent).map_err(|e| e.to_string())?;
		}
		fs::copy(src, dst).map_err(|e| e.to_string())?;
	}
	Ok(())
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
pub fn parse_dat_file_bin(path: String, version: u32, dat_flags: Option<DatOverrides>, fm: tauri::State<FormatManagerState>, placement_state: tauri::State<PlacementState>) -> Result<Response, String> {
	let mut mgr = fm.lock().map_err(|e| format!("Lock error: {}", e))?;
	let result = mgr.metadata().read_metadata(&path, version, dat_flags.unwrap_or_default())?;

	let mut placement: HashMap<u16, PlaceFlags> = HashMap::with_capacity(result.placement.len());
	for (id, ground, top_order, blocking) in &result.placement {
		placement.insert(*id, PlaceFlags { ground: *ground, top_order: *top_order, blocking: *blocking });
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
pub fn map_client_ids(
	server_ids: Vec<u16>,
	fm: tauri::State<FormatManagerState>,
	client_ids: tauri::State<crate::lua_format::ClientIdState>,
	itemdb: tauri::State<crate::lua_format::ItemDbState>,
) -> Result<Vec<u32>, String> {
	let scripted = !itemdb.lock().map_err(|e| format!("Lock error: {}", e))?.items.is_empty();
	let map = client_ids.lock().map_err(|e| format!("Lock error: {}", e))?;
	if scripted || !map.is_empty() {
		return Ok(server_ids
			.into_iter()
			.map(|sid| u32::from(map.get(&sid).copied().unwrap_or(sid)))
			.collect());
	}
	drop(map);
	let mgr = fm.lock().map_err(|e| format!("Lock error: {}", e))?;
	Ok(server_ids
		.into_iter()
		.map(|sid| mgr.item_db().client_id(sid).map(u32::from).unwrap_or(0))
		.collect())
}

#[tauri::command]
pub fn all_server_ids(
	fm: tauri::State<FormatManagerState>,
	itemdb: tauri::State<crate::lua_format::ItemDbState>,
) -> Result<Vec<u16>, String> {
	let db = itemdb.lock().map_err(|e| format!("Lock error: {}", e))?;
	let mut v: Vec<u16> = db.items.keys().filter_map(|&k| u16::try_from(k).ok()).collect();
	drop(db);
	if !v.is_empty() {
		v.sort_unstable();
		return Ok(v);
	}
	let mgr = fm.lock().map_err(|e| format!("Lock error: {}", e))?;
	let ids = mgr.item_db().all_server_ids();
	if ids.is_empty() {
		return Err("No items loaded".to_string());
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
