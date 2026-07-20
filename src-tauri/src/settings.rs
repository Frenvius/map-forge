use std::fs;
use std::path::PathBuf;

use tauri::Manager;

const ACTIVE_PROJECT: &str = "activeProject";
const RECENT_PROJECTS: &str = "recentProjects";
const LEGACY_DATA_DIR: &str = "dataDir";
const MAX_RECENT_PROJECTS: usize = 10;

fn settings_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
	let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
	fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
	Ok(dir)
}

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
	Ok(settings_dir(app)?.join("settings.json"))
}

fn read_json(app: &tauri::AppHandle) -> serde_json::Map<String, serde_json::Value> {
	settings_path(app)
		.ok()
		.and_then(|p| fs::read_to_string(p).ok())
		.and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
		.and_then(|v| v.as_object().cloned())
		.unwrap_or_default()
}

fn write_json(app: &tauri::AppHandle, value: &serde_json::Map<String, serde_json::Value>) -> Result<(), String> {
	let path = settings_path(app)?;
	let text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
	fs::write(path, text).map_err(|e| e.to_string())
}

fn string_key(app: &tauri::AppHandle, key: &str) -> Option<String> {
	let value = read_json(app);
	let text = value.get(key)?.as_str()?.trim().to_string();
	(!text.is_empty()).then_some(text)
}

pub fn active_project(app: &tauri::AppHandle) -> Option<String> {
	string_key(app, ACTIVE_PROJECT)
}

pub fn legacy_data_dir(app: &tauri::AppHandle) -> Option<String> {
	string_key(app, LEGACY_DATA_DIR)
}

pub fn recent_projects(app: &tauri::AppHandle) -> Vec<String> {
	read_json(app)
		.get(RECENT_PROJECTS)
		.and_then(|v| v.as_array().cloned())
		.unwrap_or_default()
		.into_iter()
		.filter_map(|v| v.as_str().map(str::to_string))
		.collect()
}

pub fn set_active_project(app: &tauri::AppHandle, path: &str) -> Result<(), String> {
	let mut value = read_json(app);
	value.insert(ACTIVE_PROJECT.to_string(), serde_json::Value::String(path.to_string()));

	let mut recents: Vec<String> = value
		.get(RECENT_PROJECTS)
		.and_then(|v| v.as_array().cloned())
		.unwrap_or_default()
		.into_iter()
		.filter_map(|v| v.as_str().map(str::to_string))
		.filter(|p| p != path)
		.collect();
	recents.insert(0, path.to_string());
	recents.truncate(MAX_RECENT_PROJECTS);
	value.insert(
		RECENT_PROJECTS.to_string(),
		serde_json::Value::Array(recents.into_iter().map(serde_json::Value::String).collect()),
	);

	write_json(app, &value)
}

pub fn clear_active_project(app: &tauri::AppHandle) -> Result<(), String> {
	let mut value = read_json(app);
	value.remove(ACTIVE_PROJECT);
	write_json(app, &value)
}

pub fn clear_recent_projects(app: &tauri::AppHandle) -> Result<(), String> {
	let mut value = read_json(app);
	value.insert(RECENT_PROJECTS.to_string(), serde_json::Value::Array(Vec::new()));
	write_json(app, &value)
}

pub fn read_app_settings(app: &tauri::AppHandle) -> Result<String, String> {
	let path = settings_path(app)?;
	Ok(fs::read_to_string(path).unwrap_or_else(|_| "{}".to_string()))
}

pub fn merge_app_settings(app: &tauri::AppHandle, contents: &str) -> Result<(), String> {
	let incoming: serde_json::Map<String, serde_json::Value> =
		serde_json::from_str(contents).map_err(|e| e.to_string())?;
	let mut value = read_json(app);
	for (key, entry) in incoming {
		value.insert(key, entry);
	}
	write_json(app, &value)
}

fn project_state_path(app: &tauri::AppHandle, id: &str) -> Result<PathBuf, String> {
	if id.is_empty() || id.contains('/') || id.contains('\\') || id.contains("..") {
		return Err(format!("invalid project id: {}", id));
	}
	let dir = settings_dir(app)?.join("projects").join(id);
	fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
	Ok(dir.join("state.json"))
}

pub fn read_project_state(app: &tauri::AppHandle, id: &str) -> Result<String, String> {
	let path = project_state_path(app, id)?;
	Ok(fs::read_to_string(path).unwrap_or_else(|_| "{}".to_string()))
}

pub fn write_project_state(app: &tauri::AppHandle, id: &str, contents: &str) -> Result<(), String> {
	let path = project_state_path(app, id)?;
	fs::write(path, contents).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_settings(app: tauri::AppHandle) -> Result<String, String> {
	read_app_settings(&app)
}

#[tauri::command]
pub fn write_settings(app: tauri::AppHandle, contents: String) -> Result<(), String> {
	let path = settings_path(&app)?;
	fs::write(path, contents).map_err(|e| e.to_string())
}
