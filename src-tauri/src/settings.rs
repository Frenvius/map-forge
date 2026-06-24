use std::fs;
use std::path::PathBuf;

use tauri::{Manager, State};

use crate::lua_format::lua_app_config;
use crate::lua_host::LuaState;

fn settings_dir(app: &tauri::AppHandle, lua_state: &LuaState) -> Result<PathBuf, String> {
	let dir = match lua_app_config(lua_state).data_dir {
		Some(d) => {
			let p = PathBuf::from(&d);
			if p.is_absolute() {
				p
			} else {
				let base = app.path().app_config_dir().map_err(|e| e.to_string())?;
				base.parent().map(|root| root.join(&d)).unwrap_or_else(|| base.join(&d))
			}
		}
		None => app.path().app_config_dir().map_err(|e| e.to_string())?,
	};
	fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
	Ok(dir)
}

fn settings_path(app: &tauri::AppHandle, lua_state: &LuaState) -> Result<PathBuf, String> {
	Ok(settings_dir(app, lua_state)?.join("settings.json"))
}

#[tauri::command]
pub fn read_settings(app: tauri::AppHandle, lua_state: State<LuaState>) -> Result<String, String> {
	let path = settings_path(&app, &lua_state)?;
	match fs::read_to_string(&path) {
		Ok(contents) => Ok(contents),
		Err(_) => Ok("{}".to_string()),
	}
}

#[tauri::command]
pub fn write_settings(app: tauri::AppHandle, lua_state: State<LuaState>, contents: String) -> Result<(), String> {
	let path = settings_path(&app, &lua_state)?;
	fs::write(&path, contents).map_err(|e| e.to_string())
}
