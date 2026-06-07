use std::fs;
use std::path::PathBuf;

use tauri::Manager;

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
	let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
	fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
	Ok(dir.join("settings.json"))
}

#[tauri::command]
pub fn read_settings(app: tauri::AppHandle) -> Result<String, String> {
	let path = settings_path(&app)?;
	match fs::read_to_string(&path) {
		Ok(contents) => Ok(contents),
		Err(_) => Ok("{}".to_string()),
	}
}

#[tauri::command]
pub fn write_settings(app: tauri::AppHandle, contents: String) -> Result<(), String> {
	let path = settings_path(&app)?;
	fs::write(&path, contents).map_err(|e| e.to_string())
}
