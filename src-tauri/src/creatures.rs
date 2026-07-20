use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use rayon::prelude::*;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

pub(crate) type CreatureWatcherState = Mutex<Option<RecommendedWatcher>>;

const MONSTER_DIR_NAMES: [&str; 2] = ["monster", "monsters"];
const NPC_DIR_NAMES: [&str; 2] = ["npc", "npcs"];
const SKIP_DIR_NAMES: [&str; 3] = ["lib", "scripts", "raids"];

#[derive(Serialize, Clone)]
pub struct CreatureDirs {
	pub data_dir: String,
	pub monster_dir: Option<String>,
	pub npc_dir: Option<String>,
}

#[derive(Serialize)]
pub struct CreatureEntry {
	pub name: String,
	pub is_npc: bool,
	pub look_type: u16,
	pub look_item: u16,
	pub head: u16,
	pub body: u16,
	pub legs: u16,
	pub feet: u16,
	pub addons: u16,
	pub mount: u16,
}

fn find_subdir(base: &Path, names: &[&str]) -> Option<PathBuf> {
	names
		.iter()
		.map(|n| base.join(n))
		.find(|p| p.is_dir())
}

fn dirs_at(base: &Path) -> Option<CreatureDirs> {
	let monster_dir = find_subdir(base, &MONSTER_DIR_NAMES);
	let npc_dir = find_subdir(base, &NPC_DIR_NAMES);
	if monster_dir.is_none() && npc_dir.is_none() {
		return None;
	}
	Some(CreatureDirs {
		data_dir: base.to_string_lossy().into_owned(),
		monster_dir: monster_dir.map(|p| p.to_string_lossy().into_owned()),
		npc_dir: npc_dir.map(|p| p.to_string_lossy().into_owned()),
	})
}

#[tauri::command]
pub fn creature_dirs(base: String) -> Option<CreatureDirs> {
	dirs_at(Path::new(&base))
}

const MAX_RESOLVE_DEPTH: usize = 8;

fn walk_ancestors<T>(map_path: &str, probe: impl Fn(&Path) -> Option<T>) -> Option<T> {
	let map = PathBuf::from(map_path);
	let mut dir = map.parent();
	let mut depth = 0;
	while let Some(base) = dir {
		if let Some(found) = probe(base).or_else(|| probe(&base.join("data"))) {
			return Some(found);
		}
		if depth >= MAX_RESOLVE_DEPTH {
			break;
		}
		depth += 1;
		dir = base.parent();
	}
	None
}

#[tauri::command]
pub fn resolve_creature_dirs(map_path: String) -> Option<CreatureDirs> {
	walk_ancestors(&map_path, dirs_at)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemsPaths {
	pub path: String,
	pub names: Option<String>,
	pub format: Option<String>,
}

const SERVER_DIR_MARKERS: [&str; 3] = ["world", "monster", "npc"];

fn is_server_data_dir(base: &Path) -> bool {
	SERVER_DIR_MARKERS.iter().any(|d| base.join(d).is_dir())
}

fn otb_at(base: &Path) -> Option<ItemsPaths> {
	let otb = base.join("items").join("items.otb");
	if !otb.is_file() || !is_server_data_dir(base) {
		return None;
	}
	let xml = otb.with_file_name("items.xml");
	Some(ItemsPaths {
		path: otb.to_string_lossy().into_owned(),
		names: xml.is_file().then(|| xml.to_string_lossy().into_owned()),
		format: None,
	})
}

fn scripted_itemdb_at(base: &Path, extensions: &[String]) -> Option<ItemsPaths> {
	if extensions.is_empty() {
		return None;
	}
	let mut found: Vec<ItemsPaths> = fs::read_dir(base.join("items"))
		.ok()?
		.flatten()
		.filter(|e| e.path().is_file())
		.filter_map(|e| {
			let path = e.path();
			let ext = path.extension()?.to_string_lossy().to_ascii_lowercase();
			extensions.contains(&ext).then(|| ItemsPaths {
				path: path.to_string_lossy().into_owned(),
				names: None,
				format: Some(ext),
			})
		})
		.collect();
	found.sort_by(|a, b| a.path.cmp(&b.path));
	found.into_iter().next()
}

#[tauri::command]
pub fn resolve_items_dir(map_path: String, lua_state: tauri::State<crate::lua_host::LuaState>) -> Option<ItemsPaths> {
	let extensions = lua_state
		.lock()
		.ok()
		.map(|guard| crate::lua_format::itemdb_extensions(&guard.lua))
		.unwrap_or_default();
	walk_ancestors(&map_path, |base| {
		scripted_itemdb_at(base, &extensions).or_else(|| otb_at(base))
	})
}

fn attr_u16(node: &roxmltree::Node, name: &str) -> u16 {
	node.attribute(name).and_then(|v| v.parse::<u16>().ok()).unwrap_or(0)
}

fn entry_from_file(path: &Path, is_npc: bool, index_name: Option<&str>) -> Option<CreatureEntry> {
	let text = fs::read_to_string(path).ok()?;
	let doc = roxmltree::Document::parse(&text).ok()?;
	let root = doc.root_element();
	let look = root.descendants().find(|n| n.has_tag_name("look"))?;

	let name = index_name
		.map(str::to_string)
		.or_else(|| root.attribute("name").map(str::to_string))
		.or_else(|| path.file_stem().map(|s| s.to_string_lossy().into_owned()))?;

	let look_type = attr_u16(&look, "type");
	let look_item = look
		.attribute("typeex")
		.or_else(|| look.attribute("item"))
		.or_else(|| look.attribute("lookex"))
		.and_then(|v| v.parse::<u16>().ok())
		.unwrap_or(0);
	let addons = look.attribute("addons").or_else(|| look.attribute("addon"));

	Some(CreatureEntry {
		name,
		is_npc,
		look_type,
		look_item,
		head: attr_u16(&look, "head"),
		body: attr_u16(&look, "body"),
		legs: attr_u16(&look, "legs"),
		feet: attr_u16(&look, "feet"),
		addons: addons.and_then(|v| v.parse::<u16>().ok()).unwrap_or(0),
		mount: attr_u16(&look, "mount"),
	})
}

fn collect_xml(dir: &Path, out: &mut Vec<PathBuf>) {
	let Ok(entries) = fs::read_dir(dir) else { return };
	for entry in entries.flatten() {
		let path = entry.path();
		if path.is_dir() {
			let name = path.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
			if !SKIP_DIR_NAMES.contains(&name.as_str()) {
				collect_xml(&path, out);
			}
		} else if path.extension().is_some_and(|e| e.eq_ignore_ascii_case("xml")) {
			out.push(path);
		}
	}
}

fn scan_monsters(monster_dir: &Path) -> Vec<CreatureEntry> {
	let index = monster_dir.join("monsters.xml");
	let indexed: Option<Vec<(String, PathBuf)>> = fs::read_to_string(&index).ok().and_then(|text| {
		let doc = roxmltree::Document::parse(&text).ok()?;
		let list: Vec<(String, PathBuf)> = doc
			.descendants()
			.filter(|n| n.has_tag_name("monster"))
			.filter_map(|n| {
				let name = n.attribute("name")?.to_string();
				let file = n.attribute("file")?;
				Some((name, monster_dir.join(file)))
			})
			.collect();
		(!list.is_empty()).then_some(list)
	});

	match indexed {
		Some(list) => list
			.par_iter()
			.filter_map(|(name, path)| entry_from_file(path, false, Some(name)))
			.collect(),
		None => {
			let mut files = Vec::new();
			collect_xml(monster_dir, &mut files);
			files.par_iter().filter_map(|p| entry_from_file(p, false, None)).collect()
		}
	}
}

fn scan_npcs(npc_dir: &Path) -> Vec<CreatureEntry> {
	let mut files = Vec::new();
	collect_xml(npc_dir, &mut files);
	files.par_iter().filter_map(|p| entry_from_file(p, true, None)).collect()
}

#[tauri::command]
pub fn scan_creatures(monster_dir: Option<String>, npc_dir: Option<String>) -> Vec<CreatureEntry> {
	let monsters = monster_dir
		.as_deref()
		.map(|d| scan_monsters(Path::new(d)))
		.unwrap_or_default();
	let npcs = npc_dir.as_deref().map(|d| scan_npcs(Path::new(d))).unwrap_or_default();
	let mut all = monsters;
	all.extend(npcs);
	all
}

#[tauri::command]
pub fn watch_creatures(
	monster_dir: Option<String>,
	npc_dir: Option<String>,
	app: AppHandle,
	state: tauri::State<CreatureWatcherState>,
) -> Result<(), String> {
	let mut guard = state.lock().map_err(|e| format!("Lock error: {}", e))?;
	*guard = None;

	let emitter = app.clone();
	let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
		if let Ok(event) = res {
			if matches!(event.kind, notify::EventKind::Create(_) | notify::EventKind::Modify(_) | notify::EventKind::Remove(_)) {
				let _ = emitter.emit("creatures-changed", ());
			}
		}
	})
	.map_err(|e| format!("Failed to create watcher: {}", e))?;

	for dir in [monster_dir, npc_dir].into_iter().flatten() {
		let path = PathBuf::from(&dir);
		if path.is_dir() {
			watcher
				.watch(&path, RecursiveMode::Recursive)
				.map_err(|e| format!("Failed to watch {}: {}", dir, e))?;
		}
	}

	*guard = Some(watcher);
	Ok(())
}

#[tauri::command]
pub fn unwatch_creatures(state: tauri::State<CreatureWatcherState>) -> Result<(), String> {
	let mut guard = state.lock().map_err(|e| format!("Lock error: {}", e))?;
	*guard = None;
	Ok(())
}

#[cfg(test)]
mod tests {
	use super::*;

	fn temp_root(name: &str) -> PathBuf {
		let dir = std::env::temp_dir().join(format!("map-forge-items-{}", name));
		let _ = fs::remove_dir_all(&dir);
		fs::create_dir_all(dir.join("items")).unwrap();
		dir
	}

	#[test]
	fn an_otb_needs_a_server_data_sibling_to_count() {
		let root = temp_root("otb-guard");
		fs::write(root.join("items").join("items.otb"), b"x").unwrap();
		assert!(otb_at(&root).is_none());

		fs::create_dir_all(root.join("world")).unwrap();
		let found = otb_at(&root).unwrap();
		assert!(found.path.ends_with("items.otb"));
		assert_eq!(found.format, None);
	}

	#[test]
	fn a_registered_extension_is_found_without_any_server_marker() {
		let root = temp_root("scripted");
		fs::write(root.join("items").join("things.t"), b"x").unwrap();
		let extensions = vec!["t".to_string()];

		let found = scripted_itemdb_at(&root, &extensions).unwrap();
		assert!(found.path.ends_with("things.t"));
		assert_eq!(found.format.as_deref(), Some("t"));
	}

	#[test]
	fn no_registered_extensions_means_no_scripted_match() {
		let root = temp_root("no-formats");
		fs::write(root.join("items").join("things.t"), b"x").unwrap();
		assert!(scripted_itemdb_at(&root, &[]).is_none());
	}
}
