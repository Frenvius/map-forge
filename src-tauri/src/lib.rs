use std::collections::HashMap;
use std::fs;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::ipc::Response;
use tauri::Emitter;

mod spr_manager;
use spr_manager::{SprHeader, SprManager, SprManagerState};

mod dat_writer;
mod dat_reader;
use dat_reader::{encode_dat_to_binary, DatReader};

mod nodefile;
mod otb;
mod otbm;
use otb::{parse_otb, OtbItems};
use otbm::{read_otbm, OtbmVisitor};

mod settings;
use settings::{read_settings, write_settings};

type OtbState = Arc<Mutex<Option<OtbItems>>>;

#[derive(Serialize, Deserialize)]
struct FileBytes(#[serde(with = "serde_bytes")] Vec<u8>);

#[tauri::command]
fn read_file(path: String) -> Result<FileBytes, String> {
	fs::read(&path).map(FileBytes).map_err(|e| format!("Failed to read file {}: {}", path, e))
}

#[tauri::command]
fn read_file_text(path: String) -> Result<String, String> {
	fs::read_to_string(&path).map_err(|e| format!("Failed to read file {}: {}", path, e))
}

#[tauri::command]
fn read_file_header(path: String, bytes: usize) -> Result<FileBytes, String> {
	use std::io::Read;
	let mut file = fs::File::open(&path).map_err(|e| format!("Failed to open file {}: {}", path, e))?;
	let mut buffer = vec![0u8; bytes];
	file.read_exact(&mut buffer)
		.map_err(|e| format!("Failed to read {} bytes from {}: {}", bytes, path, e))?;
	Ok(FileBytes(buffer))
}

#[tauri::command]
fn open_spr_file(path: String, extended: bool, spr_state: tauri::State<SprManagerState>) -> Result<SprHeader, String> {
	let mut manager = spr_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	manager.open_file(path, extended)
}

#[tauri::command]
fn close_spr_file(path: String, spr_state: tauri::State<SprManagerState>) -> Result<(), String> {
	let mut manager = spr_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	manager.close_file(&path)
}

#[tauri::command]
fn read_sprites_rgba(path: String, ids: Vec<u32>, transparent: bool, spr_state: tauri::State<SprManagerState>) -> Result<Response, String> {
	let mut manager = spr_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let bytes = manager.read_sprites_rgba(&path, ids, transparent)?;
	Ok(Response::new(bytes))
}

#[tauri::command]
fn read_sprites_batch_rgba(
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
fn read_sprites_rgba_lz4(path: String, ids: Vec<u32>, transparent: bool, spr_state: tauri::State<SprManagerState>) -> Result<Response, String> {
	let mut manager = spr_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let bytes = manager.read_sprites_rgba_lz4(&path, ids, transparent)?;
	Ok(Response::new(bytes))
}

#[tauri::command]
fn parse_dat_file_bin(path: String, version: u32) -> Result<Response, String> {
	let mut reader = DatReader::open(&path)?;
	reader.set_version(version);
	let (signature, items, outfits, effects, missiles) =
		reader.read_dat().map_err(|e| format!("DAT parse error (version {}): {}", version, e))?;
	let buffer = encode_dat_to_binary(signature, &items, &outfits, &effects, &missiles);
	Ok(Response::new(buffer))
}

#[tauri::command]
fn load_otb(path: String, otb_state: tauri::State<OtbState>) -> Result<usize, String> {
	let bytes = fs::read(&path).map_err(|e| format!("Failed to read {}: {}", path, e))?;
	let items = parse_otb(&bytes)?;
	let count = items.server_to_client.len();
	*otb_state.lock().map_err(|e| format!("Lock error: {}", e))? = Some(items);
	Ok(count)
}

#[tauri::command]
fn map_client_ids(server_ids: Vec<u16>, otb_state: tauri::State<OtbState>) -> Result<Vec<u32>, String> {
	let guard = otb_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let otb = guard.as_ref().ok_or("OTB not loaded")?;
	Ok(server_ids
		.into_iter()
		.map(|sid| otb.client_id(sid).map(u32::from).unwrap_or(0))
		.collect())
}

const CHUNK: u32 = 32;

pub struct MapModel {
	width: u16,
	height: u16,
	min_x: u16,
	min_y: u16,
	max_x: u16,
	max_y: u16,
	tile_x: Vec<u16>,
	tile_y: Vec<u16>,
	item_off: Vec<u32>,
	client_ids: Vec<u16>,
	server_ids: Vec<u16>,
	floors: HashMap<u8, HashMap<u32, (u32, u32)>>,
	teleports: Vec<u8>,
	teleport_count: u32,
	edits: HashMap<u8, HashMap<u32, HashMap<u32, Vec<(u16, u16)>>>>,
}

#[derive(Default)]
struct MapStore {
	maps: HashMap<u32, MapModel>,
	next_id: u32,
}

type MapState = Arc<Mutex<MapStore>>;

struct OtbmCollector<'a> {
	otb: &'a OtbItems,
	window: tauri::Window,
	width: u16,
	height: u16,
	xs: Vec<u16>,
	ys: Vec<u16>,
	zs: Vec<u8>,
	item_start: Vec<u32>,
	item_count: Vec<u16>,
	client_ids: Vec<u16>,
	server_ids: Vec<u16>,
	teleports: Vec<u8>,
	teleport_count: u32,
	last_step: i32,
}

fn push_u16(out: &mut Vec<u8>, v: u16) {
	out.extend_from_slice(&v.to_le_bytes());
}
fn push_u32(out: &mut Vec<u8>, v: u32) {
	out.extend_from_slice(&v.to_le_bytes());
}

impl<'a> OtbmCollector<'a> {
	fn finish(self) -> MapModel {
		let model = build_map_model(
			self.width,
			self.height,
			&self.xs,
			&self.ys,
			&self.zs,
			&self.item_start,
			&self.item_count,
			&self.client_ids,
			&self.server_ids,
			self.teleports,
			self.teleport_count,
		);
		let _ = self.window.emit("otbm_progress", 1.0_f64);
		model
	}
}

#[allow(clippy::too_many_arguments)]
fn build_map_model(
	width: u16,
	height: u16,
	xs: &[u16],
	ys: &[u16],
	zs: &[u8],
	item_start: &[u32],
	item_count: &[u16],
	client_ids: &[u16],
	server_ids: &[u16],
	teleports: Vec<u8>,
	teleport_count: u32,
) -> MapModel {
	let n = xs.len();
	let mut order: Vec<u32> = (0..n as u32).collect();
	let key = |i: usize| -> u64 {
		let x = xs[i] as u64;
		let y = ys[i] as u64;
		let z = zs[i] as u64;
		let cx = x / CHUNK as u64;
		let cy = y / CHUNK as u64;
		(z << 54) | (cy << 43) | (cx << 32) | (y << 16) | x
	};
	order.sort_unstable_by_key(|&i| key(i as usize));

	let mut min_x = if n == 0 { 0 } else { u16::MAX };
	let mut min_y = if n == 0 { 0 } else { u16::MAX };
	let mut max_x = 0u16;
	let mut max_y = 0u16;
	for i in 0..n {
		min_x = min_x.min(xs[i]);
		min_y = min_y.min(ys[i]);
		max_x = max_x.max(xs[i]);
		max_y = max_y.max(ys[i]);
	}

	let mut tile_x: Vec<u16> = Vec::with_capacity(n);
	let mut tile_y: Vec<u16> = Vec::with_capacity(n);
	let mut item_off: Vec<u32> = Vec::with_capacity(n + 1);
	item_off.push(0);
	let mut client_col: Vec<u16> = Vec::with_capacity(client_ids.len());
	let mut server_col: Vec<u16> = Vec::with_capacity(server_ids.len());
	let mut acc: u32 = 0;
	for &oi in &order {
		let i = oi as usize;
		let s = item_start[i] as usize;
		let c = item_count[i] as usize;
		tile_x.push(xs[i]);
		tile_y.push(ys[i]);
		client_col.extend_from_slice(&client_ids[s..s + c]);
		server_col.extend_from_slice(&server_ids[s..s + c]);
		acc += c as u32;
		item_off.push(acc);
	}

	let mut floors: HashMap<u8, HashMap<u32, (u32, u32)>> = HashMap::new();
	let mut i = 0usize;
	while i < n {
		let z = zs[order[i] as usize];
		let cx = tile_x[i] as u32 / CHUNK;
		let cy = tile_y[i] as u32 / CHUNK;
		let start = i as u32;
		i += 1;
		while i < n && zs[order[i] as usize] == z && tile_x[i] as u32 / CHUNK == cx && tile_y[i] as u32 / CHUNK == cy {
			i += 1;
		}
		floors.entry(z).or_default().insert((cx << 16) | cy, (start, i as u32));
	}

	MapModel {
		width,
		height,
		min_x,
		min_y,
		max_x,
		max_y,
		tile_x,
		tile_y,
		item_off,
		client_ids: client_col,
		server_ids: server_col,
		floors,
		teleports,
		teleport_count,
		edits: HashMap::new(),
	}
}

fn serialize_meta(m: &MapModel) -> Vec<u8> {
	let mut out = Vec::with_capacity(32 + m.teleports.len());
	push_u16(&mut out, m.width);
	push_u16(&mut out, m.height);
	push_u16(&mut out, m.min_x);
	push_u16(&mut out, m.min_y);
	push_u16(&mut out, m.max_x);
	push_u16(&mut out, m.max_y);
	push_u32(&mut out, m.tile_x.len() as u32);
	let mut floors: Vec<u8> = m.floors.keys().copied().collect();
	floors.sort_unstable();
	out.push(floors.len() as u8);
	out.extend_from_slice(&floors);
	push_u32(&mut out, m.teleport_count);
	out.extend_from_slice(&m.teleports);
	out
}

fn serialize_chunks(m: &MapModel, z: u8, keys: &[u32]) -> Vec<u8> {
	let mut out = Vec::new();
	push_u32(&mut out, 0);
	let mut chunk_count = 0u32;
	let floor = m.floors.get(&z);
	let efloor = m.edits.get(&z);
	for &k in keys {
		let base_range = floor.and_then(|f| f.get(&k).copied());
		let edits_chunk = efloor.and_then(|c| c.get(&k));

		let mut tiles: Vec<(u16, u16, Vec<(u16, u16)>)> = Vec::new();
		if let Some((start, end)) = base_range {
			for t in start as usize..end as usize {
				let pos = (m.tile_x[t] as u32) << 16 | m.tile_y[t] as u32;
				if edits_chunk.is_some_and(|c| c.contains_key(&pos)) {
					continue;
				}
				let s = m.item_off[t] as usize;
				let e = m.item_off[t + 1] as usize;
				let items = (s..e).map(|j| (m.client_ids[j], m.server_ids[j])).collect();
				tiles.push((m.tile_x[t], m.tile_y[t], items));
			}
		}
		if let Some(c) = edits_chunk {
			for (&pos, stack) in c {
				if stack.is_empty() {
					continue;
				}
				tiles.push(((pos >> 16) as u16, (pos & 0xFFFF) as u16, stack.clone()));
			}
		}
		if tiles.is_empty() {
			continue;
		}
		tiles.sort_unstable_by_key(|(x, y, _)| (*y, *x));

		push_u16(&mut out, (k >> 16) as u16);
		push_u16(&mut out, (k & 0xFFFF) as u16);
		push_u32(&mut out, tiles.len() as u32);
		for (x, y, items) in &tiles {
			push_u16(&mut out, *x);
			push_u16(&mut out, *y);
			push_u16(&mut out, items.len() as u16);
			for (c, s) in items {
				push_u16(&mut out, *c);
				push_u16(&mut out, *s);
			}
		}
		chunk_count += 1;
	}
	out[0..4].copy_from_slice(&chunk_count.to_le_bytes());
	out
}

fn base_tile_items(m: &MapModel, z: u8, chunk_key: u32, x: u16, y: u16) -> Vec<(u16, u16)> {
	if let Some(&(start, end)) = m.floors.get(&z).and_then(|f| f.get(&chunk_key)) {
		for t in start as usize..end as usize {
			if m.tile_x[t] == x && m.tile_y[t] == y {
				let s = m.item_off[t] as usize;
				let e = m.item_off[t + 1] as usize;
				return (s..e).map(|j| (m.client_ids[j], m.server_ids[j])).collect();
			}
		}
	}
	Vec::new()
}

fn tile_stack_mut<'a>(m: &'a mut MapModel, z: u8, x: u16, y: u16) -> &'a mut Vec<(u16, u16)> {
	let chunk_key = ((x as u32 / CHUNK) << 16) | (y as u32 / CHUNK);
	let pos = (x as u32) << 16 | y as u32;
	let known = m.edits.get(&z).and_then(|c| c.get(&chunk_key)).is_some_and(|t| t.contains_key(&pos));
	let base = if known { Vec::new() } else { base_tile_items(m, z, chunk_key, x, y) };
	m.edits.entry(z).or_default().entry(chunk_key).or_default().entry(pos).or_insert(base)
}

#[tauri::command]
fn move_item(
	map_id: u32,
	z: u8,
	from_x: u16,
	from_y: u16,
	to_x: u16,
	to_y: u16,
	map_state: tauri::State<MapState>,
) -> Result<(), String> {
	if from_x == to_x && from_y == to_y {
		return Ok(());
	}
	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let m = guard.maps.get_mut(&map_id).ok_or("map not loaded")?;
	let item = match tile_stack_mut(m, z, from_x, from_y).pop() {
		Some(it) => it,
		None => return Ok(()),
	};
	tile_stack_mut(m, z, to_x, to_y).push(item);
	Ok(())
}

#[tauri::command]
fn delete_item(map_id: u32, z: u8, x: u16, y: u16, map_state: tauri::State<MapState>) -> Result<(), String> {
	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let m = guard.maps.get_mut(&map_id).ok_or("map not loaded")?;
	tile_stack_mut(m, z, x, y).pop();
	Ok(())
}

#[tauri::command]
fn paint_tiles(
	map_id: u32,
	z: u8,
	xs: Vec<u16>,
	ys: Vec<u16>,
	server_id: u16,
	is_ground: bool,
	otb_state: tauri::State<OtbState>,
	map_state: tauri::State<MapState>,
) -> Result<(), String> {
	if xs.len() != ys.len() {
		return Err("xs and ys length mismatch".into());
	}
	let client_id = {
		let guard = otb_state.lock().map_err(|e| format!("Lock error: {}", e))?;
		let otb = guard.as_ref().ok_or("items.otb not loaded")?;
		otb.client_id(server_id).unwrap_or(0)
	};

	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let m = guard.maps.get_mut(&map_id).ok_or("map not loaded")?;
	for i in 0..xs.len() {
		let (x, y) = (xs[i], ys[i]);
		let chunk_key = ((x as u32 / CHUNK) << 16) | (y as u32 / CHUNK);
		let pos = (x as u32) << 16 | y as u32;
		let known = m.edits.get(&z).and_then(|c| c.get(&chunk_key)).is_some_and(|t| t.contains_key(&pos));
		let base = if known { Vec::new() } else { base_tile_items(m, z, chunk_key, x, y) };
		let stack = m.edits.entry(z).or_default().entry(chunk_key).or_default().entry(pos).or_insert(base);
		if is_ground {
			if stack.is_empty() {
				stack.push((client_id, server_id));
			} else {
				stack[0] = (client_id, server_id);
			}
		} else {
			stack.push((client_id, server_id));
		}
	}
	Ok(())
}

impl<'a> OtbmVisitor for OtbmCollector<'a> {
	fn header(&mut self, width: u16, height: u16) {
		self.width = width;
		self.height = height;
	}

	fn progress(&mut self, pos: usize, total: usize) {
		if total == 0 {
			return;
		}
		let step = ((pos as u64 * 200) / total as u64) as i32;
		if step != self.last_step {
			self.last_step = step;
			let _ = self.window.emit("otbm_progress", pos as f64 / total as f64);
		}
	}

	fn tile(&mut self, x: u16, y: u16, z: u8, items: &[u16]) {
		let start = self.client_ids.len() as u32;
		let mut n: u16 = 0;
		for &sid in items {
			if let Some(cid) = self.otb.client_id(sid) {
				if cid != 0 {
					self.client_ids.push(cid);
					self.server_ids.push(sid);
					n += 1;
				}
			}
		}
		self.xs.push(x);
		self.ys.push(y);
		self.zs.push(z);
		self.item_start.push(start);
		self.item_count.push(n);
	}

	fn teleport(&mut self, sx: u16, sy: u16, sz: u8, dx: u16, dy: u16, dz: u8) {
		self.teleports.extend_from_slice(&sx.to_le_bytes());
		self.teleports.extend_from_slice(&sy.to_le_bytes());
		self.teleports.push(sz);
		self.teleports.extend_from_slice(&dx.to_le_bytes());
		self.teleports.extend_from_slice(&dy.to_le_bytes());
		self.teleports.push(dz);
		self.teleport_count += 1;
	}
}

#[tauri::command]
async fn open_otbm(
	path: String,
	window: tauri::Window,
	otb_state: tauri::State<'_, OtbState>,
	map_state: tauri::State<'_, MapState>,
) -> Result<Response, String> {
	let otb = otb_state.inner().clone();
	let model = tauri::async_runtime::spawn_blocking(move || -> Result<MapModel, String> {
		let bytes = fs::read(&path).map_err(|e| format!("Failed to read {}: {}", path, e))?;
		let guard = otb.lock().map_err(|e| format!("Lock error: {}", e))?;
		let otb = guard.as_ref().ok_or("items.otb not loaded - call load_otb first")?;

		let mut collector = OtbmCollector {
			otb,
			window,
			width: 0,
			height: 0,
			xs: Vec::new(),
			ys: Vec::new(),
			zs: Vec::new(),
			item_start: Vec::new(),
			item_count: Vec::new(),
			client_ids: Vec::new(),
			server_ids: Vec::new(),
			teleports: Vec::new(),
			teleport_count: 0,
			last_step: -1,
		};
		read_otbm(&bytes, &mut collector)?;
		Ok(collector.finish())
	})
	.await
	.map_err(|e| format!("otbm task error: {}", e))??;

	let meta = serialize_meta(&model);
	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	Ok(Response::new(store_map(&mut guard, model, meta)))
}

fn store_map(store: &mut MapStore, model: MapModel, meta: Vec<u8>) -> Vec<u8> {
	store.next_id += 1;
	let id = store.next_id;
	store.maps.insert(id, model);
	let mut out = Vec::with_capacity(4 + meta.len());
	out.extend_from_slice(&id.to_le_bytes());
	out.extend_from_slice(&meta);
	out
}

#[tauri::command]
fn new_otbm(width: u16, height: u16, map_state: tauri::State<MapState>) -> Result<Response, String> {
	let model = MapModel {
		width,
		height,
		min_x: 0,
		min_y: 0,
		max_x: width.saturating_sub(1),
		max_y: height.saturating_sub(1),
		tile_x: Vec::new(),
		tile_y: Vec::new(),
		item_off: vec![0],
		client_ids: Vec::new(),
		server_ids: Vec::new(),
		floors: HashMap::new(),
		teleports: Vec::new(),
		teleport_count: 0,
		edits: HashMap::new(),
	};
	let meta = serialize_meta(&model);
	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	Ok(Response::new(store_map(&mut guard, model, meta)))
}

#[tauri::command]
fn close_map(map_id: u32, map_state: tauri::State<MapState>) -> Result<(), String> {
	map_state.lock().map_err(|e| format!("Lock error: {}", e))?.maps.remove(&map_id);
	Ok(())
}

#[tauri::command]
fn get_map_chunks(map_id: u32, z: u8, keys: Vec<u32>, map_state: tauri::State<MapState>) -> Result<Response, String> {
	let guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let model = guard.maps.get(&map_id).ok_or("map not loaded - call open_otbm first")?;
	Ok(Response::new(serialize_chunks(model, z, &keys)))
}

#[tauri::command]
#[allow(unused_variables)]
fn set_window_acrylic(window: tauri::Window, enabled: bool, color: Option<(u8, u8, u8, u8)>) -> Result<(), String> {
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
	let spr_manager: SprManagerState = Arc::new(Mutex::new(SprManager::new()));
	let otb_store: OtbState = Arc::new(Mutex::new(None));
	let map_store: MapState = Arc::new(Mutex::new(MapStore::default()));

	tauri::Builder::default()
		.plugin(tauri_plugin_dialog::init())
		.manage(spr_manager)
		.manage(otb_store)
		.manage(map_store)
		.invoke_handler(tauri::generate_handler![
			read_file,
			read_file_text,
			read_file_header,
			open_spr_file,
			close_spr_file,
			read_sprites_rgba,
			read_sprites_batch_rgba,
			read_sprites_rgba_lz4,
			parse_dat_file_bin,
			load_otb,
			map_client_ids,
			open_otbm,
			new_otbm,
			close_map,
			paint_tiles,
			move_item,
			delete_item,
			get_map_chunks,
			set_window_acrylic,
			read_settings,
			write_settings
		])
		.setup(move |app| {
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
	use super::*;

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
		fn tile(&mut self, _x: u16, _y: u16, _z: u8, items: &[u16]) {
			self.tiles += 1;
			self.item_sids.extend_from_slice(items);
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

	fn u16_at(b: &[u8], o: usize) -> u16 {
		u16::from_le_bytes([b[o], b[o + 1]])
	}
	fn u32_at(b: &[u8], o: usize) -> u32 {
		u32::from_le_bytes([b[o], b[o + 1], b[o + 2], b[o + 3]])
	}

	fn sample_model() -> MapModel {
		let xs = vec![40u16, 1, 33, 0];
		let ys = vec![0u16, 1, 5, 0];
		let zs = vec![7u8, 7, 7, 6];
		let item_start = vec![0u32, 1, 2, 4];
		let item_count = vec![1u16, 1, 2, 1];
		let client_ids = vec![100u16, 101, 102, 103, 104];
		let server_ids = vec![900u16, 901, 902, 903, 904];
		build_map_model(10, 20, &xs, &ys, &zs, &item_start, &item_count, &client_ids, &server_ids, Vec::new(), 0)
	}

	#[test]
	fn model_is_sorted_and_chunk_indexed() {
		let m = sample_model();
		assert_eq!(m.tile_x, vec![0, 1, 40, 33]);
		assert_eq!(m.tile_y, vec![0, 1, 0, 5]);
		assert_eq!(m.item_off, vec![0, 1, 2, 3, 5]);
		assert_eq!(&m.client_ids[3..5], &[102, 103]);
		assert_eq!(&m.server_ids[3..5], &[902, 903]);

		assert_eq!(m.floors[&6][&0], (0, 1));
		assert_eq!(m.floors[&7][&0], (1, 2));
		assert_eq!(m.floors[&7][&(1u32 << 16)], (2, 4));
	}

	#[test]
	fn serialize_meta_lists_floors() {
		let m = sample_model();
		let meta = serialize_meta(&m);
		assert_eq!(u16_at(&meta, 0), 10);
		assert_eq!(u16_at(&meta, 8), 40);
		assert_eq!(u16_at(&meta, 10), 5);
		assert_eq!(u32_at(&meta, 12), 4);
		assert_eq!(meta[16], 2);
		assert_eq!(&meta[17..19], &[6, 7]);
		assert_eq!(u32_at(&meta, 19), 0);
	}

	#[test]
	fn serialize_chunks_streams_requested_tiles() {
		let m = sample_model();
		let buf = serialize_chunks(&m, 7, &[1u32 << 16, 999]);
		assert_eq!(u32_at(&buf, 0), 1);
		let mut o = 4;
		assert_eq!(u16_at(&buf, o), 1);
		assert_eq!(u16_at(&buf, o + 2), 0);
		assert_eq!(u32_at(&buf, o + 4), 2);
		o += 8;
		assert_eq!(u16_at(&buf, o), 40);
		assert_eq!(u16_at(&buf, o + 2), 0);
		assert_eq!(u16_at(&buf, o + 4), 1);
		assert_eq!(u16_at(&buf, o + 6), 100);
		assert_eq!(u16_at(&buf, o + 8), 900);
		o += 10;
		assert_eq!(u16_at(&buf, o), 33);
		assert_eq!(u16_at(&buf, o + 2), 5);
		assert_eq!(u16_at(&buf, o + 4), 2);
		assert_eq!(u16_at(&buf, o + 6), 102);
		assert_eq!(u16_at(&buf, o + 10), 103);
	}
}
