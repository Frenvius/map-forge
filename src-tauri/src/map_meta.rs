use serde::{Deserialize, Serialize};

use crate::map_model::{Town, Waypoint};
use crate::{MapState, OtbState};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MapProperties {
	width: u16,
	height: u16,
	description: String,
	spawn_file: String,
	house_file: String,
	otbm_version: u32,
	items_major: u32,
	items_minor: u32,
	town_count: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapPropertiesPatch {
	description: String,
	spawn_file: String,
	house_file: String,
	otbm_version: u32,
	items_minor: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FloorStat {
	z: u8,
	tile_count: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MapStatistics {
	width: u16,
	height: u16,
	min_x: u16,
	min_y: u16,
	max_x: u16,
	max_y: u16,
	tile_count: u32,
	item_count: u32,
	teleport_count: u32,
	town_count: u32,
	house_tile_count: u32,
	floors: Vec<FloorStat>,
}

#[tauri::command]
pub fn get_map_properties(map_id: u32, map_state: tauri::State<MapState>) -> Result<MapProperties, String> {
	let guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let m = guard.maps.get(&map_id).ok_or("map not loaded")?;
	Ok(MapProperties {
		width: m.width,
		height: m.height,
		description: m.description.clone(),
		spawn_file: m.spawn_file.clone(),
		house_file: m.house_file.clone(),
		otbm_version: m.otbm_version,
		items_major: m.items_major,
		items_minor: m.items_minor,
		town_count: m.towns.len() as u32,
	})
}

#[tauri::command]
pub fn set_map_properties(map_id: u32, patch: MapPropertiesPatch, map_state: tauri::State<MapState>) -> Result<(), String> {
	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let m = guard.maps.get_mut(&map_id).ok_or("map not loaded")?;
	m.description = patch.description;
	m.spawn_file = patch.spawn_file;
	m.house_file = patch.house_file;
	m.otbm_version = patch.otbm_version;
	m.items_minor = patch.items_minor;
	Ok(())
}

#[tauri::command]
pub fn get_towns(map_id: u32, map_state: tauri::State<MapState>) -> Result<Vec<Town>, String> {
	let guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let m = guard.maps.get(&map_id).ok_or("map not loaded")?;
	Ok(m.towns.clone())
}

#[tauri::command]
pub fn set_towns(map_id: u32, towns: Vec<Town>, map_state: tauri::State<MapState>) -> Result<(), String> {
	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let m = guard.maps.get_mut(&map_id).ok_or("map not loaded")?;
	m.towns = towns;
	Ok(())
}

#[tauri::command]
pub fn get_waypoints(map_id: u32, map_state: tauri::State<MapState>) -> Result<Vec<Waypoint>, String> {
	let guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let m = guard.maps.get(&map_id).ok_or("map not loaded")?;
	Ok(m.waypoints.clone())
}

#[tauri::command]
pub fn map_statistics(
	map_id: u32,
	otb_state: tauri::State<OtbState>,
	map_state: tauri::State<MapState>,
) -> Result<MapStatistics, String> {
	let otb_guard = otb_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let otb = otb_guard.as_ref().ok_or("items.otb not loaded")?;
	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let m = guard.maps.get_mut(&map_id).ok_or("map not loaded")?;

	for z in m.available_floors.clone() {
		m.ensure_floor(z, otb)?;
	}

	let mut floors: Vec<FloorStat> = Vec::new();
	for &z in &m.available_floors {
		let count = m
			.floors
			.get(&z)
			.map(|cm| cm.values().map(|&(s, e)| e - s).sum())
			.unwrap_or(0);
		floors.push(FloorStat { z, tile_count: count });
	}

	Ok(MapStatistics {
		width: m.width,
		height: m.height,
		min_x: m.min_x,
		min_y: m.min_y,
		max_x: m.max_x,
		max_y: m.max_y,
		tile_count: m.tile_x.len() as u32,
		item_count: m.client_ids.len() as u32,
		teleport_count: m.teleport_count,
		town_count: m.towns.len() as u32,
		house_tile_count: m.house_tile_count,
		floors,
	})
}
