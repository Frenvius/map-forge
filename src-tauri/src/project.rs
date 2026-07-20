use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::lua_host::LuaState;
use crate::settings;

pub const MANIFEST_VERSION: u32 = 1;
pub const MANIFEST_EXT: &str = "frg";

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapForge {
	#[serde(skip_serializing_if = "Option::is_none")]
	pub data: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub assets: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub itemdb: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub maps: Option<String>,
	#[serde(flatten)]
	pub extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
	pub frg: u32,
	pub id: String,
	pub name: String,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub scripts: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub map_forge: Option<MapForge>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub sprite_forge: Option<serde_json::Value>,
	#[serde(flatten)]
	pub extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Clone)]
pub struct Project {
	pub root: PathBuf,
	pub path: PathBuf,
	pub manifest: Manifest,
}

#[derive(Default)]
pub struct ProjectSlot {
	pub project: Option<Project>,
	pub error: Option<String>,
}

pub type ProjectState = Arc<Mutex<ProjectSlot>>;

impl Project {
	pub fn load(path: &Path) -> Result<Project, String> {
		let text = fs::read_to_string(path).map_err(|e| format!("{}: {}", path.display(), e))?;
		let manifest: Manifest = serde_json::from_str(&text).map_err(|e| format!("{}: {}", path.display(), e))?;
		if manifest.frg > MANIFEST_VERSION {
			return Err(format!(
				"{} needs project format {}, this editor supports {}",
				path.display(),
				manifest.frg,
				MANIFEST_VERSION
			));
		}
		if manifest.id.trim().is_empty() {
			return Err(format!("{}: missing project id", path.display()));
		}
		let root = path.parent().map(Path::to_path_buf).unwrap_or_else(|| PathBuf::from("."));
		Ok(Project { root, path: path.to_path_buf(), manifest })
	}

	fn map_forge(&self) -> Option<&MapForge> {
		self.manifest.map_forge.as_ref()
	}

	fn resolve(&self, rel: Option<&str>) -> Option<PathBuf> {
		rel.map(|r| r.trim()).filter(|r| !r.is_empty()).map(|r| self.root.join(r))
	}

	pub fn declared_scripts_dir(&self) -> Option<PathBuf> {
		self.resolve(self.manifest.scripts.as_deref())
	}

	pub fn scripts_dir(&self) -> Option<PathBuf> {
		self.declared_scripts_dir().filter(|p| p.is_dir())
	}

	pub fn data_root(&self) -> Option<PathBuf> {
		self.resolve(self.map_forge().and_then(|m| m.data.as_deref()))
	}

	pub fn data_dir(&self, version: u32) -> Option<PathBuf> {
		let base = self.data_root()?;
		let versioned = base.join(version.to_string());
		Some(if versioned.is_dir() { versioned } else { base })
	}

	pub fn assets(&self) -> Option<PathBuf> {
		self.resolve(self.map_forge().and_then(|m| m.assets.as_deref()))
	}

	pub fn itemdb(&self) -> Option<PathBuf> {
		self.resolve(self.map_forge().and_then(|m| m.itemdb.as_deref()))
	}

	pub fn maps(&self) -> Option<PathBuf> {
		self.resolve(self.map_forge().and_then(|m| m.maps.as_deref()))
	}
}

fn as_string(p: Option<PathBuf>) -> Option<String> {
	p.map(|p| p.to_string_lossy().into_owned())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
	pub id: String,
	pub name: String,
	pub root: String,
	pub path: String,
	pub data_root: Option<String>,
	pub assets: Option<String>,
	pub itemdb: Option<String>,
	pub maps: Option<String>,
	pub has_scripts: bool,
	pub has_map_forge: bool,
	pub missing: Vec<String>,
}

pub fn describe(project: &Project) -> ProjectInfo {
	let assets = project.assets();
	let itemdb = project.itemdb();
	let missing = [&assets, &itemdb]
		.into_iter()
		.flatten()
		.filter(|p| !p.exists())
		.map(|p| p.to_string_lossy().into_owned())
		.collect();
	ProjectInfo {
		id: project.manifest.id.clone(),
		name: project.manifest.name.clone(),
		root: project.root.to_string_lossy().into_owned(),
		path: project.path.to_string_lossy().into_owned(),
		data_root: as_string(project.data_root()),
		assets: as_string(assets),
		itemdb: as_string(itemdb),
		maps: as_string(project.maps()),
		has_scripts: project.scripts_dir().is_some(),
		has_map_forge: project.manifest.map_forge.is_some(),
		missing,
	}
}

pub fn apply_scripts(project: Option<&Project>, lua_state: &LuaState) {
	let Ok(mut host) = lua_state.lock() else {
		return;
	};
	host.dir = project.and_then(Project::declared_scripts_dir).unwrap_or_default();
	match host.load_all() {
		Ok(0) => {}
		Ok(n) => println!("[lua] loaded {} script(s) from {}", n, host.dir.display()),
		Err(e) => {
			host.last_error = Some(e.clone());
			eprintln!("[lua] load failed: {}", e);
		}
	}
}

pub fn reset_loaded_assets(app: &tauri::AppHandle) {
	use tauri::Manager;

	if let Ok(mut fm) = app.state::<crate::formats::FormatManagerState>().lock() {
		fm.set_sprite(Box::new(crate::formats::tibia::spr_manager::SprManager::new()));
		fm.set_item_db(Box::new(crate::formats::tibia::providers::TibiaItemDatabase::new()));
	}
	if let Ok(mut db) = app.state::<crate::lua_format::ItemDbState>().lock() {
		*db = crate::lua_format::ItemDb::default();
	}
	if let Ok(mut sprites) = app.state::<crate::lua_format::ItemSpriteState>().lock() {
		sprites.clear();
	}
	if let Ok(mut things) = app.state::<crate::lua_format::ThingsState>().lock() {
		things.clear();
	}
	if let Ok(mut ids) = app.state::<crate::lua_format::ClientIdState>().lock() {
		ids.clear();
	}
	if let Ok(mut placement) = app.state::<crate::PlacementState>().lock() {
		placement.clear();
	}
	if let Ok(mut otb) = app.state::<crate::OtbState>().lock() {
		*otb = None;
	}
	if let Ok(mut materials) = app.state::<crate::MaterialsState>().lock() {
		*materials = None;
	}
	if let Ok(mut copy_buffer) = app.state::<crate::CopyBufferState>().lock() {
		*copy_buffer = None;
	}
	if let Ok(mut maps) = app.state::<crate::MapState>().lock() {
		*maps = crate::map_model::MapStore::default();
	}
}

pub fn resolve_active(app: &tauri::AppHandle) -> ProjectSlot {
	let Some(path) = settings::active_project(app) else {
		return ProjectSlot::default();
	};
	match Project::load(Path::new(&path)) {
		Ok(p) => ProjectSlot { project: Some(p), error: None },
		Err(e) => {
			eprintln!("[project] {}", e);
			ProjectSlot { project: None, error: Some(e) }
		}
	}
}

#[tauri::command]
pub fn project_active(project: State<ProjectState>) -> Result<Option<ProjectInfo>, String> {
	let slot = project.lock().map_err(|e| e.to_string())?;
	Ok(slot.project.as_ref().map(describe))
}

#[tauri::command]
pub fn project_error(project: State<ProjectState>) -> Result<Option<String>, String> {
	Ok(project.lock().map_err(|e| e.to_string())?.error.clone())
}

#[tauri::command]
pub fn project_open(
	app: tauri::AppHandle,
	path: String,
	project: State<ProjectState>,
	lua_state: State<LuaState>,
) -> Result<ProjectInfo, String> {
	let loaded = Project::load(Path::new(&path))?;
	settings::set_active_project(&app, &path)?;
	reset_loaded_assets(&app);
	apply_scripts(Some(&loaded), &lua_state);
	let info = describe(&loaded);
	*project.lock().map_err(|e| e.to_string())? = ProjectSlot { project: Some(loaded), error: None };
	Ok(info)
}

#[tauri::command]
pub fn project_close(
	app: tauri::AppHandle,
	project: State<ProjectState>,
	lua_state: State<LuaState>,
) -> Result<(), String> {
	settings::clear_active_project(&app)?;
	reset_loaded_assets(&app);
	apply_scripts(None, &lua_state);
	*project.lock().map_err(|e| e.to_string())? = ProjectSlot::default();
	Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentProject {
	pub path: String,
	pub name: Option<String>,
}

#[tauri::command]
pub fn project_recent(app: tauri::AppHandle) -> Vec<RecentProject> {
	settings::recent_projects(&app)
		.into_iter()
		.map(|path| {
			let name = Project::load(Path::new(&path)).ok().map(|p| p.manifest.name);
			RecentProject { path, name }
		})
		.collect()
}

#[tauri::command]
pub fn project_recent_clear(app: tauri::AppHandle) -> Result<(), String> {
	settings::clear_recent_projects(&app)
}

fn active_id(project: &State<ProjectState>) -> Result<Option<String>, String> {
	let slot = project.lock().map_err(|e| e.to_string())?;
	Ok(slot.project.as_ref().map(|p| p.manifest.id.clone()))
}

#[tauri::command]
pub fn project_state_get(app: tauri::AppHandle, project: State<ProjectState>) -> Result<String, String> {
	match active_id(&project)? {
		Some(id) => settings::read_project_state(&app, &id),
		None => settings::read_app_settings(&app),
	}
}

#[tauri::command]
pub fn project_state_set(app: tauri::AppHandle, contents: String, project: State<ProjectState>) -> Result<(), String> {
	match active_id(&project)? {
		Some(id) => settings::write_project_state(&app, &id, &contents),
		None => settings::merge_app_settings(&app, &contents),
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	fn temp_root(name: &str) -> PathBuf {
		let dir = std::env::temp_dir().join(format!("map-forge-project-{}", name));
		let _ = fs::remove_dir_all(&dir);
		fs::create_dir_all(&dir).unwrap();
		dir
	}

	fn write_manifest(root: &Path, json: &str) -> PathBuf {
		let path = root.join("test.frg");
		fs::write(&path, json).unwrap();
		path
	}

	#[test]
	fn resolves_every_path_relative_to_the_manifest_directory() {
		let root = temp_root("resolve");
		fs::create_dir_all(root.join("scripts")).unwrap();
		fs::create_dir_all(root.join("d")).unwrap();
		let path = write_manifest(
			&root,
			r#"{"frg":1,"id":"sample","name":"Sample","scripts":"scripts",
			    "mapForge":{"data":"d","assets":"a/asset.bin","itemdb":"a/items.bin","maps":"m"}}"#,
		);

		let p = Project::load(&path).unwrap();
		assert_eq!(p.root, root);
		assert_eq!(p.scripts_dir(), Some(root.join("scripts")));
		assert_eq!(p.data_root(), Some(root.join("d")));
		assert_eq!(p.assets(), Some(root.join("a/asset.bin")));
		assert_eq!(p.itemdb(), Some(root.join("a/items.bin")));
		assert_eq!(p.maps(), Some(root.join("m")));
	}

	#[test]
	fn data_dir_prefers_a_version_subfolder_when_one_exists() {
		let root = temp_root("versioned");
		fs::create_dir_all(root.join("d").join("860")).unwrap();
		let path = write_manifest(&root, r#"{"frg":1,"id":"v","name":"V","mapForge":{"data":"d"}}"#);

		let p = Project::load(&path).unwrap();
		assert_eq!(p.data_dir(860), Some(root.join("d").join("860")));
		assert_eq!(p.data_dir(1098), Some(root.join("d")));
	}

	#[test]
	fn a_project_declaring_no_data_folder_claims_none() {
		let root = temp_root("no-data");
		let path = write_manifest(&root, r#"{"frg":1,"id":"x","name":"X","mapForge":{"assets":"a/asset.bin"}}"#);

		let p = Project::load(&path).unwrap();
		assert_eq!(p.data_root(), None);
		assert_eq!(p.data_dir(860), None);
		assert_eq!(describe(&p).data_root, None);
	}

	#[test]
	fn refuses_a_manifest_from_a_newer_editor() {
		let root = temp_root("newer");
		let path = write_manifest(&root, r#"{"frg":2,"id":"x","name":"X"}"#);
		assert!(Project::load(&path).is_err());
	}

	#[test]
	fn missing_scripts_directory_is_not_an_error() {
		let root = temp_root("no-scripts-dir");
		let path = write_manifest(&root, r#"{"frg":1,"id":"x","name":"X","scripts":"scripts"}"#);

		let p = Project::load(&path).unwrap();
		assert_eq!(p.declared_scripts_dir(), Some(root.join("scripts")));
		assert_eq!(p.scripts_dir(), None);
		assert!(!describe(&p).has_scripts);
	}

	#[test]
	fn absent_map_forge_section_is_reported_without_inventing_paths() {
		let root = temp_root("other-editor");
		let path = write_manifest(&root, r#"{"frg":1,"id":"x","name":"X","spriteForge":{"assets":"assets"}}"#);

		let p = Project::load(&path).unwrap();
		let info = describe(&p);
		assert!(!info.has_map_forge);
		assert_eq!(info.assets, None);
		assert_eq!(info.itemdb, None);
		assert_eq!(info.data_root, None);
	}

	#[test]
	fn unknown_keys_and_foreign_sections_survive_a_round_trip() {
		let root = temp_root("round-trip");
		let path = write_manifest(
			&root,
			r#"{"frg":1,"id":"x","name":"X","spriteForge":{"assets":"assets"},
			    "futureEditor":{"nested":[1,2]},"tags":["a"]}"#,
		);

		let p = Project::load(&path).unwrap();
		let out: serde_json::Value = serde_json::from_str(&serde_json::to_string(&p.manifest).unwrap()).unwrap();
		assert_eq!(out["spriteForge"]["assets"], "assets");
		assert_eq!(out["futureEditor"]["nested"][1], 2);
		assert_eq!(out["tags"][0], "a");
	}

	#[test]
	fn absence_is_the_default_state() {
		let slot = ProjectSlot::default();
		assert!(slot.project.is_none());
		assert!(slot.error.is_none());
	}
}
