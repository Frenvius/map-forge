use std::collections::{HashMap, HashSet};
use std::io::{Read, Seek, SeekFrom};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::ipc::Response;

use crate::otb::OtbItems;
use crate::otbm::{read_otbm_floor, ItemAttrs, OtbmVisitor};
use crate::otbm_footer::MapIndex;
use crate::{MapState, MinimapPaletteState, OtbState};

pub(crate) const CHUNK: u32 = 32;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Town {
	pub id: u32,
	pub name: String,
	pub x: u16,
	pub y: u16,
	pub z: u8,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Waypoint {
	pub name: String,
	pub x: u16,
	pub y: u16,
	pub z: u8,
}

pub(crate) const ACTION_PAINT: u8 = 1;
pub(crate) const ACTION_ERASE: u8 = 2;
pub(crate) const ACTION_MOVE: u8 = 3;
pub(crate) const ACTION_DELETE: u8 = 4;
pub(crate) const ACTION_FLAG: u8 = 5;
pub(crate) const ACTION_HOUSE: u8 = 6;

const UNDO_LIMIT: usize = 200;
const MERGE_WINDOW: Duration = Duration::from_millis(500);

struct TileChange {
	z: u8,
	pos: u32,
	before: Vec<(u16, u16)>,
	after: Vec<(u16, u16)>,
}

struct FlagChange {
	z: u8,
	pos: u32,
	before: u32,
	after: u32,
}

struct HouseChange {
	z: u8,
	pos: u32,
	before: u32,
	after: u32,
}

#[derive(Default)]
struct Batch {
	items: Vec<TileChange>,
	flags: Vec<FlagChange>,
	houses: Vec<HouseChange>,
}

#[derive(Default)]
struct History {
	recording: Option<HashMap<(u8, u32), Vec<(u16, u16)>>>,
	flag_recording: Option<HashMap<(u8, u32), u32>>,
	house_recording: Option<HashMap<(u8, u32), u32>>,
	undo: Vec<Batch>,
	redo: Vec<Batch>,
	last_kind: u8,
	last_commit: Option<Instant>,
}

pub struct MapModel {
	pub(crate) width: u16,
	pub(crate) height: u16,
	pub(crate) min_x: u16,
	pub(crate) min_y: u16,
	pub(crate) max_x: u16,
	pub(crate) max_y: u16,
	pub(crate) tile_x: Vec<u16>,
	pub(crate) tile_y: Vec<u16>,
	pub(crate) item_off: Vec<u32>,
	pub(crate) client_ids: Vec<u16>,
	pub(crate) server_ids: Vec<u16>,
	pub(crate) subtypes: Vec<u8>,
	pub(crate) tile_flags: Vec<u32>,
	pub(crate) house_ids: Vec<u32>,
	pub(crate) door_ids: Vec<u8>,
	pub(crate) floors: HashMap<u8, HashMap<u32, (u32, u32)>>,
	pub(crate) teleports: Vec<u8>,
	pub(crate) teleport_count: u32,
	pub(crate) edits: HashMap<u8, HashMap<u32, HashMap<u32, Vec<(u16, u16)>>>>,
	pub(crate) flag_edits: HashMap<u8, HashMap<u32, HashMap<u32, u32>>>,
	pub(crate) house_edits: HashMap<u8, HashMap<u32, HashMap<u32, u32>>>,
	pub(crate) door_edits: HashMap<u8, HashMap<u32, HashMap<u32, u8>>>,
	pub(crate) source_path: Option<std::path::PathBuf>,
	pub(crate) available_floors: Vec<u8>,
	pub(crate) total_tiles: u32,
	pub(crate) eager: bool,
	pub(crate) loaded_chunks: HashSet<u64>,
	pub(crate) chunk_ranges: HashMap<u64, (u64, u64)>,
	pub(crate) floor_chunks: HashMap<u8, Vec<u32>>,
	pub(crate) description: String,
	pub(crate) spawn_file: String,
	pub(crate) house_file: String,
	pub(crate) otbm_version: u32,
	pub(crate) items_major: u32,
	pub(crate) items_minor: u32,
	pub(crate) towns: Vec<Town>,
	pub(crate) waypoints: Vec<Waypoint>,
	pub(crate) house_tile_count: u32,
	pub(crate) item_attrs: HashMap<u64, ItemAttrs>,
	history: History,
}

pub(crate) fn ckey(z: u8, chunk: u32) -> u64 {
	((z as u64) << 32) | chunk as u64
}

#[derive(Default)]
pub struct MapStore {
	pub(crate) maps: HashMap<u32, MapModel>,
	pub(crate) next_id: u32,
}

pub(crate) fn push_u16(out: &mut Vec<u8>, v: u16) {
	out.extend_from_slice(&v.to_le_bytes());
}

pub(crate) fn push_u32(out: &mut Vec<u8>, v: u32) {
	out.extend_from_slice(&v.to_le_bytes());
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn build_map_model(
	width: u16,
	height: u16,
	xs: &[u16],
	ys: &[u16],
	zs: &[u8],
	item_start: &[u32],
	item_count: &[u16],
	client_ids: &[u16],
	server_ids: &[u16],
	subtypes: &[u8],
	flags: &[u32],
	house_ids: &[u32],
	door_ids: &[u8],
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
	let mut subtype_col: Vec<u8> = Vec::with_capacity(subtypes.len());
	let mut flag_col: Vec<u32> = Vec::with_capacity(n);
	let mut house_col: Vec<u32> = Vec::with_capacity(n);
	let mut door_col: Vec<u8> = Vec::with_capacity(n);
	let mut acc: u32 = 0;
	for &oi in &order {
		let i = oi as usize;
		let s = item_start[i] as usize;
		let c = item_count[i] as usize;
		tile_x.push(xs[i]);
		tile_y.push(ys[i]);
		flag_col.push(flags.get(i).copied().unwrap_or(0));
		house_col.push(house_ids.get(i).copied().unwrap_or(0));
		door_col.push(door_ids.get(i).copied().unwrap_or(0));
		client_col.extend_from_slice(&client_ids[s..s + c]);
		server_col.extend_from_slice(&server_ids[s..s + c]);
		subtype_col.extend_from_slice(&subtypes[s..s + c]);
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

	let mut available_floors: Vec<u8> = floors.keys().copied().collect();
	available_floors.sort_unstable();
	let total_tiles = tile_x.len() as u32;

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
		subtypes: subtype_col,
		tile_flags: flag_col,
		house_ids: house_col,
		door_ids: door_col,
		floors,
		teleports,
		teleport_count,
		edits: HashMap::new(),
		flag_edits: HashMap::new(),
		house_edits: HashMap::new(),
		door_edits: HashMap::new(),
		source_path: None,
		available_floors,
		total_tiles,
		eager: true,
		loaded_chunks: HashSet::new(),
		chunk_ranges: HashMap::new(),
		floor_chunks: HashMap::new(),
		description: String::new(),
		spawn_file: String::new(),
		house_file: String::new(),
		otbm_version: 0,
		items_major: 0,
		items_minor: 0,
		towns: Vec::new(),
		waypoints: Vec::new(),
		house_tile_count: 0,
		item_attrs: HashMap::new(),
		history: History::default(),
	}
}

pub(crate) fn serialize_meta(m: &MapModel) -> Vec<u8> {
	let mut out = Vec::with_capacity(32 + m.teleports.len());
	push_u16(&mut out, m.width);
	push_u16(&mut out, m.height);
	push_u16(&mut out, m.min_x);
	push_u16(&mut out, m.min_y);
	push_u16(&mut out, m.max_x);
	push_u16(&mut out, m.max_y);
	push_u32(&mut out, m.total_tiles);
	out.push(m.available_floors.len() as u8);
	out.extend_from_slice(&m.available_floors);
	push_u32(&mut out, m.teleport_count);
	out.extend_from_slice(&m.teleports);
	let (cx, cy, cz) = match m.towns.first() {
		Some(t) => (t.x, t.y, t.z),
		None => ((m.min_x / 2).wrapping_add(m.max_x / 2), (m.min_y / 2).wrapping_add(m.max_y / 2), 7),
	};
	push_u16(&mut out, cx);
	push_u16(&mut out, cy);
	out.push(cz);
	out
}

pub(crate) fn serialize_chunks(m: &MapModel, z: u8, keys: &[u32]) -> Vec<u8> {
	let mut out = Vec::new();
	push_u32(&mut out, 0);
	let mut chunk_count = 0u32;
	let floor = m.floors.get(&z);
	let efloor = m.edits.get(&z);
	let feloor = m.flag_edits.get(&z);
	let hfloor = m.house_edits.get(&z);
	for &k in keys {
		let base_range = floor.and_then(|f| f.get(&k).copied());
		let edits_chunk = efloor.and_then(|c| c.get(&k));
		let flags_chunk = feloor.and_then(|c| c.get(&k));
		let house_chunk = hfloor.and_then(|c| c.get(&k));

		let mut by_pos: HashMap<u32, (u32, u32, Vec<(u16, u16, u8)>)> = HashMap::new();
		if let Some((start, end)) = base_range {
			for t in start as usize..end as usize {
				let pos = (m.tile_x[t] as u32) << 16 | m.tile_y[t] as u32;
				if edits_chunk.is_some_and(|c| c.contains_key(&pos)) {
					continue;
				}
				let s = m.item_off[t] as usize;
				let e = m.item_off[t + 1] as usize;
				let items = (s..e).map(|j| (m.client_ids[j], m.server_ids[j], m.subtypes[j])).collect();
				by_pos.insert(pos, (m.tile_flags[t], m.house_ids.get(t).copied().unwrap_or(0), items));
			}
		}
		if let Some(c) = edits_chunk {
			for (&pos, stack) in c {
				let base = base_flags(m, z, k, (pos >> 16) as u16, (pos & 0xFFFF) as u16);
				let house = base_house_id(m, z, k, (pos >> 16) as u16, (pos & 0xFFFF) as u16);
				let items = stack.iter().map(|&(cl, sv)| (cl, sv, 1u8)).collect();
				by_pos.insert(pos, (base, house, items));
			}
		}
		if let Some(c) = flags_chunk {
			for (&pos, &flags) in c {
				by_pos.entry(pos).or_insert_with(|| (0, 0, Vec::new())).0 = flags;
			}
		}
		if let Some(c) = house_chunk {
			for (&pos, &house) in c {
				by_pos.entry(pos).or_insert_with(|| (0, 0, Vec::new())).1 = house;
			}
		}

		let mut tiles: Vec<(u16, u16, u32, u32, Vec<(u16, u16, u8)>)> = by_pos
			.into_iter()
			.filter(|(_, (flags, house, items))| !items.is_empty() || *flags != 0 || *house != 0)
			.map(|(pos, (flags, house, items))| ((pos >> 16) as u16, (pos & 0xFFFF) as u16, flags, house, items))
			.collect();
		if tiles.is_empty() {
			continue;
		}
		tiles.sort_unstable_by_key(|(x, y, _, _, _)| (*y, *x));

		push_u16(&mut out, (k >> 16) as u16);
		push_u16(&mut out, (k & 0xFFFF) as u16);
		push_u32(&mut out, tiles.len() as u32);
		for (x, y, flags, house, items) in &tiles {
			push_u16(&mut out, *x);
			push_u16(&mut out, *y);
			push_u32(&mut out, *flags);
			push_u32(&mut out, *house);
			push_u16(&mut out, items.len() as u16);
			for (c, s, sub) in items {
				push_u16(&mut out, *c);
				push_u16(&mut out, *s);
				out.push(*sub);
			}
		}
		chunk_count += 1;
	}
	out[0..4].copy_from_slice(&chunk_count.to_le_bytes());
	out
}

pub(crate) fn base_tile_items(m: &MapModel, z: u8, chunk_key: u32, x: u16, y: u16) -> Vec<(u16, u16)> {
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

pub(crate) fn chunk_key_of(x: u16, y: u16) -> u32 {
	((x as u32 / CHUNK) << 16) | (y as u32 / CHUNK)
}

pub(crate) fn base_flags(m: &MapModel, z: u8, chunk_key: u32, x: u16, y: u16) -> u32 {
	if let Some(&(start, end)) = m.floors.get(&z).and_then(|f| f.get(&chunk_key)) {
		for t in start as usize..end as usize {
			if m.tile_x[t] == x && m.tile_y[t] == y {
				return m.tile_flags[t];
			}
		}
	}
	0
}

pub(crate) fn flags_at(m: &MapModel, z: u8, x: u16, y: u16) -> u32 {
	let chunk_key = chunk_key_of(x, y);
	let pos = (x as u32) << 16 | y as u32;
	if let Some(&f) = m.flag_edits.get(&z).and_then(|c| c.get(&chunk_key)).and_then(|t| t.get(&pos)) {
		return f;
	}
	base_flags(m, z, chunk_key, x, y)
}

pub(crate) fn base_house_id(m: &MapModel, z: u8, chunk_key: u32, x: u16, y: u16) -> u32 {
	if let Some(&(start, end)) = m.floors.get(&z).and_then(|f| f.get(&chunk_key)) {
		for t in start as usize..end as usize {
			if m.tile_x[t] == x && m.tile_y[t] == y {
				return m.house_ids.get(t).copied().unwrap_or(0);
			}
		}
	}
	0
}

pub(crate) fn house_id_at(m: &MapModel, z: u8, x: u16, y: u16) -> u32 {
	let chunk_key = chunk_key_of(x, y);
	let pos = (x as u32) << 16 | y as u32;
	if let Some(&h) = m.house_edits.get(&z).and_then(|c| c.get(&chunk_key)).and_then(|t| t.get(&pos)) {
		return h;
	}
	base_house_id(m, z, chunk_key, x, y)
}

pub(crate) fn base_subtype(m: &MapModel, z: u8, chunk_key: u32, x: u16, y: u16, item_idx: usize) -> u8 {
	if let Some(&(start, end)) = m.floors.get(&z).and_then(|f| f.get(&chunk_key)) {
		for t in start as usize..end as usize {
			if m.tile_x[t] == x && m.tile_y[t] == y {
				let s = m.item_off[t] as usize;
				let e = m.item_off[t + 1] as usize;
				let global = s + item_idx;
				if global < e {
					return m.subtypes[global];
				}
				return 1;
			}
		}
	}
	1
}

pub(crate) fn base_door_id(m: &MapModel, z: u8, chunk_key: u32, x: u16, y: u16) -> u8 {
	if let Some(&(start, end)) = m.floors.get(&z).and_then(|f| f.get(&chunk_key)) {
		for t in start as usize..end as usize {
			if m.tile_x[t] == x && m.tile_y[t] == y {
				return m.door_ids.get(t).copied().unwrap_or(0);
			}
		}
	}
	0
}

pub(crate) fn door_id_at(m: &MapModel, z: u8, x: u16, y: u16) -> u8 {
	let chunk_key = chunk_key_of(x, y);
	let pos = (x as u32) << 16 | y as u32;
	if let Some(&d) = m.door_edits.get(&z).and_then(|c| c.get(&chunk_key)).and_then(|t| t.get(&pos)) {
		return d;
	}
	base_door_id(m, z, chunk_key, x, y)
}

pub(crate) fn stack_at(m: &MapModel, z: u8, x: u16, y: u16) -> Vec<(u16, u16)> {
	let chunk_key = chunk_key_of(x, y);
	let pos = (x as u32) << 16 | y as u32;
	if let Some(stack) = m.edits.get(&z).and_then(|c| c.get(&chunk_key)).and_then(|t| t.get(&pos)) {
		return stack.clone();
	}
	base_tile_items(m, z, chunk_key, x, y)
}

pub(crate) fn tile_stack_mut<'a>(m: &'a mut MapModel, z: u8, x: u16, y: u16) -> &'a mut Vec<(u16, u16)> {
	let chunk_key = chunk_key_of(x, y);
	let pos = (x as u32) << 16 | y as u32;
	if m.history.recording.as_ref().is_some_and(|r| !r.contains_key(&(z, pos))) {
		let snapshot = stack_at(m, z, x, y);
		m.history.recording.as_mut().unwrap().insert((z, pos), snapshot);
	}
	let known = m.edits.get(&z).and_then(|c| c.get(&chunk_key)).is_some_and(|t| t.contains_key(&pos));
	let base = if known { Vec::new() } else { base_tile_items(m, z, chunk_key, x, y) };
	m.edits.entry(z).or_default().entry(chunk_key).or_default().entry(pos).or_insert(base)
}

impl MapModel {
	pub(crate) fn ensure_chunks(&mut self, z: u8, keys: &[u32], otb: &OtbItems) -> Result<(), String> {
		if self.eager {
			return Ok(());
		}
		let mut todo: Vec<(u8, u32, u64, u64)> = Vec::new();
		for &key in keys {
			let ck = ckey(z, key);
			if self.loaded_chunks.contains(&ck) {
				continue;
			}
			if let Some(&(start, end)) = self.chunk_ranges.get(&ck) {
				todo.push((z, key, start, end));
			}
		}
		self.load_chunks(&todo, otb)
	}

	pub(crate) fn ensure_floor(&mut self, z: u8, otb: &OtbItems) -> Result<(), String> {
		if self.eager {
			return Ok(());
		}
		let Some(keys) = self.floor_chunks.get(&z) else {
			return Ok(());
		};
		let mut todo: Vec<(u8, u32, u64, u64)> = Vec::new();
		for &key in keys {
			let ck = ckey(z, key);
			if self.loaded_chunks.contains(&ck) {
				continue;
			}
			if let Some(&(start, end)) = self.chunk_ranges.get(&ck) {
				todo.push((z, key, start, end));
			}
		}
		self.load_chunks(&todo, otb)
	}

	fn collect_ring(cx: u32, cy: u32, keys: &mut HashSet<u32>) {
		for dy in -1i64..=1 {
			for dx in -1i64..=1 {
				let nx = cx as i64 + dx;
				let ny = cy as i64 + dy;
				if nx < 0 || ny < 0 || nx > u16::MAX as i64 || ny > u16::MAX as i64 {
					continue;
				}
				keys.insert(((nx as u32) << 16) | ny as u32);
			}
		}
	}

	pub(crate) fn ensure_tiles(&mut self, z: u8, tiles: &[(u16, u16)], otb: &OtbItems) -> Result<(), String> {
		if self.eager || tiles.is_empty() {
			return Ok(());
		}
		let mut keys: HashSet<u32> = HashSet::new();
		for &(x, y) in tiles {
			Self::collect_ring(x as u32 / CHUNK, y as u32 / CHUNK, &mut keys);
		}
		let keys: Vec<u32> = keys.into_iter().collect();
		self.ensure_chunks(z, &keys, otb)
	}

	pub(crate) fn ensure_span(&mut self, z: u8, min_x: u16, min_y: u16, max_x: u16, max_y: u16, otb: &OtbItems) -> Result<(), String> {
		if self.eager {
			return Ok(());
		}
		let mut keys: HashSet<u32> = HashSet::new();
		for cy in (min_y as u32 / CHUNK)..=(max_y as u32 / CHUNK) {
			for cx in (min_x as u32 / CHUNK)..=(max_x as u32 / CHUNK) {
				Self::collect_ring(cx, cy, &mut keys);
			}
		}
		let keys: Vec<u32> = keys.into_iter().collect();
		self.ensure_chunks(z, &keys, otb)
	}

	pub(crate) fn window_minimap(
		&mut self,
		z: u8,
		x0: u16,
		y0: u16,
		w: u16,
		h: u16,
		palette: &[u8],
		otb: &OtbItems,
	) -> Result<Vec<u8>, String> {
		let w = w as usize;
		let h = h as usize;
		let mut out = Vec::with_capacity(8 + w * h);
		push_u16(&mut out, x0);
		push_u16(&mut out, y0);
		push_u16(&mut out, w as u16);
		push_u16(&mut out, h as u16);
		if w == 0 || h == 0 {
			return Ok(out);
		}

		let x0u = x0 as u32;
		let y0u = y0 as u32;
		let x1 = x0u + w as u32 - 1;
		let y1 = y0u + h as u32 - 1;
		let mut keys: Vec<u32> = Vec::new();
		for cy in (y0u / CHUNK)..=(y1 / CHUNK) {
			for cx in (x0u / CHUNK)..=(x1 / CHUNK) {
				keys.push((cx << 16) | cy);
			}
		}
		self.ensure_chunks(z, &keys, otb)?;

		let pick = |clients: &[u16]| -> u8 {
			for &c in clients.iter().rev() {
				let ci = c as usize;
				if ci < palette.len() && palette[ci] != 0 {
					return palette[ci];
				}
			}
			0
		};

		let mut grid = vec![0u8; w * h];
		let efloor = self.edits.get(&z);
		if let Some(floor) = self.floors.get(&z) {
			for &key in &keys {
				let Some(&(start, end)) = floor.get(&key) else {
					continue;
				};
				let edits_chunk = efloor.and_then(|c| c.get(&key));
				for t in start as usize..end as usize {
					let x = self.tile_x[t] as u32;
					let y = self.tile_y[t] as u32;
					if x < x0u || x > x1 || y < y0u || y > y1 {
						continue;
					}
					let pos = (x << 16) | y;
					if edits_chunk.is_some_and(|c| c.contains_key(&pos)) {
						continue;
					}
					let s = self.item_off[t] as usize;
					let e = self.item_off[t + 1] as usize;
					let col = pick(&self.client_ids[s..e]);
					if col != 0 {
						grid[(y - y0u) as usize * w + (x - x0u) as usize] = col;
					}
				}
			}
		}
		if let Some(chunks) = efloor {
			for chunk in chunks.values() {
				for (&pos, stack) in chunk {
					let x = (pos >> 16) & 0xFFFF;
					let y = pos & 0xFFFF;
					if x < x0u || x > x1 || y < y0u || y > y1 || stack.is_empty() {
						continue;
					}
					let clients: Vec<u16> = stack.iter().map(|&(c, _)| c).collect();
					let col = pick(&clients);
					if col != 0 {
						grid[(y - y0u) as usize * w + (x - x0u) as usize] = col;
					}
				}
			}
		}

		out.extend_from_slice(&grid);
		Ok(out)
	}

	fn load_chunks(&mut self, items: &[(u8, u32, u64, u64)], otb: &OtbItems) -> Result<(), String> {
		if items.is_empty() {
			return Ok(());
		}
		let path = self.source_path.clone().ok_or("lazy chunk load needs a source file")?;
		let mut f = std::fs::File::open(&path).map_err(|e| format!("Failed to open {}: {}", path.display(), e))?;
		for &(z, key, start, end) in items {
			f.seek(SeekFrom::Start(start)).map_err(|e| format!("seek error: {}", e))?;
			let mut slice = vec![0u8; end.saturating_sub(start) as usize];
			f.read_exact(&mut slice).map_err(|e| format!("read error: {}", e))?;
			let mut col = FloorCollector {
				otb,
				xs: Vec::new(),
				ys: Vec::new(),
				item_start: Vec::new(),
				item_count: Vec::new(),
				client_ids: Vec::new(),
				server_ids: Vec::new(),
				subtypes: Vec::new(),
				flags: Vec::new(),
				house_ids: Vec::new(),
				door_ids: Vec::new(),
				attrs: Vec::new(),
			};
			read_otbm_floor(&slice, &mut col)?;
			for (x, y, idx, a) in &col.attrs {
				self.item_attrs.insert(crate::otbm::attrs_key(z, *x, *y, *idx), a.clone());
			}
			self.append_chunk(z, key, &col);
			self.loaded_chunks.insert(ckey(z, key));
		}
		Ok(())
	}

	fn append_chunk(&mut self, z: u8, key: u32, col: &FloorCollector) {
		let n = col.xs.len();
		let mut order: Vec<u32> = (0..n as u32).collect();
		order.sort_unstable_by_key(|&oi| {
			let i = oi as usize;
			((col.ys[i] as u32) << 16) | col.xs[i] as u32
		});

		let start = self.tile_x.len() as u32;
		let mut acc = *self.item_off.last().unwrap();
		for &oi in &order {
			let i = oi as usize;
			let s = col.item_start[i] as usize;
			let c = col.item_count[i] as usize;
			self.tile_x.push(col.xs[i]);
			self.tile_y.push(col.ys[i]);
			self.tile_flags.push(col.flags[i]);
			self.house_ids.push(col.house_ids.get(i).copied().unwrap_or(0));
			self.door_ids.push(col.door_ids.get(i).copied().unwrap_or(0));
			self.client_ids.extend_from_slice(&col.client_ids[s..s + c]);
			self.server_ids.extend_from_slice(&col.server_ids[s..s + c]);
			self.subtypes.extend_from_slice(&col.subtypes[s..s + c]);
			acc += c as u32;
			self.item_off.push(acc);
		}
		let end = self.tile_x.len() as u32;
		if end > start {
			self.floors.entry(z).or_default().insert(key, (start, end));
		}
	}

	pub(crate) fn record_begin(&mut self) {
		if self.history.recording.is_none() {
			self.history.recording = Some(HashMap::new());
		}
		if self.history.flag_recording.is_none() {
			self.history.flag_recording = Some(HashMap::new());
		}
		if self.history.house_recording.is_none() {
			self.history.house_recording = Some(HashMap::new());
		}
	}

	pub(crate) fn set_tile_flags(&mut self, z: u8, x: u16, y: u16, new_flags: u32) {
		let chunk_key = chunk_key_of(x, y);
		let pos = (x as u32) << 16 | y as u32;
		if self.history.flag_recording.as_ref().is_some_and(|r| !r.contains_key(&(z, pos))) {
			let before = flags_at(self, z, x, y);
			self.history.flag_recording.as_mut().unwrap().insert((z, pos), before);
		}
		self.flag_edits.entry(z).or_default().entry(chunk_key).or_default().insert(pos, new_flags);
	}

	pub(crate) fn set_tile_house_id(&mut self, z: u8, x: u16, y: u16, new_house: u32) {
		let chunk_key = chunk_key_of(x, y);
		let pos = (x as u32) << 16 | y as u32;
		if self.history.house_recording.as_ref().is_some_and(|r| !r.contains_key(&(z, pos))) {
			let before = house_id_at(self, z, x, y);
			self.history.house_recording.as_mut().unwrap().insert((z, pos), before);
		}
		self.house_edits.entry(z).or_default().entry(chunk_key).or_default().insert(pos, new_house);
	}

	pub(crate) fn set_tile_door_id(&mut self, z: u8, x: u16, y: u16, door_id: u8) {
		let chunk_key = chunk_key_of(x, y);
		let pos = (x as u32) << 16 | y as u32;
		self.door_edits.entry(z).or_default().entry(chunk_key).or_default().insert(pos, door_id);
	}

	pub(crate) fn record_commit(&mut self, kind: u8) {
		let item_before = self.history.recording.take();
		let flag_before = self.history.flag_recording.take();
		let house_before = self.history.house_recording.take();
		let mut items: Vec<TileChange> = item_before
			.into_iter()
			.flatten()
			.filter_map(|((z, pos), before)| {
				let after = stack_at(self, z, (pos >> 16) as u16, (pos & 0xFFFF) as u16);
				(before != after).then_some(TileChange { z, pos, before, after })
			})
			.collect();
		let mut flags: Vec<FlagChange> = flag_before
			.into_iter()
			.flatten()
			.filter_map(|((z, pos), before)| {
				let after = flags_at(self, z, (pos >> 16) as u16, (pos & 0xFFFF) as u16);
				(before != after).then_some(FlagChange { z, pos, before, after })
			})
			.collect();
		let mut houses: Vec<HouseChange> = house_before
			.into_iter()
			.flatten()
			.filter_map(|((z, pos), before)| {
				let after = house_id_at(self, z, (pos >> 16) as u16, (pos & 0xFFFF) as u16);
				(before != after).then_some(HouseChange { z, pos, before, after })
			})
			.collect();
		if items.is_empty() && flags.is_empty() && houses.is_empty() {
			return;
		}

		let mergeable = matches!(kind, ACTION_PAINT | ACTION_ERASE | ACTION_FLAG | ACTION_HOUSE)
			&& self.history.last_kind == kind
			&& self.history.redo.is_empty()
			&& self.history.last_commit.is_some_and(|t| t.elapsed() < MERGE_WINDOW);

		if mergeable {
			if let Some(group) = self.history.undo.last_mut() {
				for ch in items.drain(..) {
					match group.items.iter_mut().find(|c| c.z == ch.z && c.pos == ch.pos) {
						Some(existing) => existing.after = ch.after,
						None => group.items.push(ch),
					}
				}
				for ch in flags.drain(..) {
					match group.flags.iter_mut().find(|c| c.z == ch.z && c.pos == ch.pos) {
						Some(existing) => existing.after = ch.after,
						None => group.flags.push(ch),
					}
				}
				for ch in houses.drain(..) {
					match group.houses.iter_mut().find(|c| c.z == ch.z && c.pos == ch.pos) {
						Some(existing) => existing.after = ch.after,
						None => group.houses.push(ch),
					}
				}
			}
		} else {
			self.history.redo.clear();
			self.history.undo.push(Batch { items, flags, houses });
			if self.history.undo.len() > UNDO_LIMIT {
				self.history.undo.remove(0);
			}
		}
		self.history.last_kind = kind;
		self.history.last_commit = Some(Instant::now());
	}

	fn set_overlay(&mut self, z: u8, pos: u32, stack: Vec<(u16, u16)>) {
		let chunk_key = chunk_key_of((pos >> 16) as u16, (pos & 0xFFFF) as u16);
		self.edits.entry(z).or_default().entry(chunk_key).or_default().insert(pos, stack);
	}

	fn set_flag_overlay(&mut self, z: u8, pos: u32, flags: u32) {
		let chunk_key = chunk_key_of((pos >> 16) as u16, (pos & 0xFFFF) as u16);
		self.flag_edits.entry(z).or_default().entry(chunk_key).or_default().insert(pos, flags);
	}

	fn set_house_overlay(&mut self, z: u8, pos: u32, house: u32) {
		let chunk_key = chunk_key_of((pos >> 16) as u16, (pos & 0xFFFF) as u16);
		self.house_edits.entry(z).or_default().entry(chunk_key).or_default().insert(pos, house);
	}

	pub(crate) fn undo(&mut self) -> Vec<(u8, u32)> {
		let Some(batch) = self.history.undo.pop() else {
			return Vec::new();
		};
		let touched = self.apply(&batch, true);
		self.history.redo.push(batch);
		self.history.last_commit = None;
		touched
	}

	pub(crate) fn redo(&mut self) -> Vec<(u8, u32)> {
		let Some(batch) = self.history.redo.pop() else {
			return Vec::new();
		};
		let touched = self.apply(&batch, false);
		self.history.undo.push(batch);
		self.history.last_commit = None;
		touched
	}

	fn apply(&mut self, batch: &Batch, to_before: bool) -> Vec<(u8, u32)> {
		let mut touched: HashSet<(u8, u32)> = HashSet::new();
		for ch in &batch.items {
			let stack = if to_before { ch.before.clone() } else { ch.after.clone() };
			self.set_overlay(ch.z, ch.pos, stack);
			let chunk_key = chunk_key_of((ch.pos >> 16) as u16, (ch.pos & 0xFFFF) as u16);
			touched.insert((ch.z, chunk_key));
		}
		for ch in &batch.flags {
			let flags = if to_before { ch.before } else { ch.after };
			self.set_flag_overlay(ch.z, ch.pos, flags);
			let chunk_key = chunk_key_of((ch.pos >> 16) as u16, (ch.pos & 0xFFFF) as u16);
			touched.insert((ch.z, chunk_key));
		}
		for ch in &batch.houses {
			let house = if to_before { ch.before } else { ch.after };
			self.set_house_overlay(ch.z, ch.pos, house);
			let chunk_key = chunk_key_of((ch.pos >> 16) as u16, (ch.pos & 0xFFFF) as u16);
			touched.insert((ch.z, chunk_key));
		}
		touched.into_iter().collect()
	}
}

pub(crate) fn store_map(store: &mut MapStore, model: MapModel, meta: Vec<u8>) -> Vec<u8> {
	store.next_id += 1;
	let id = store.next_id;
	store.maps.insert(id, model);
	let mut out = Vec::with_capacity(4 + meta.len());
	out.extend_from_slice(&id.to_le_bytes());
	out.extend_from_slice(&meta);
	out
}

pub(crate) fn empty_model(width: u16, height: u16) -> MapModel {
	MapModel {
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
		subtypes: Vec::new(),
		tile_flags: Vec::new(),
		house_ids: Vec::new(),
		floors: HashMap::new(),
		teleports: Vec::new(),
		teleport_count: 0,
		edits: HashMap::new(),
		flag_edits: HashMap::new(),
		house_edits: HashMap::new(),
		door_ids: Vec::new(),
		door_edits: HashMap::new(),
		source_path: None,
		available_floors: Vec::new(),
		total_tiles: 0,
		eager: true,
		loaded_chunks: HashSet::new(),
		chunk_ranges: HashMap::new(),
		floor_chunks: HashMap::new(),
		description: String::new(),
		spawn_file: String::new(),
		house_file: String::new(),
		otbm_version: 2,
		items_major: 3,
		items_minor: 860,
		towns: Vec::new(),
		waypoints: Vec::new(),
		house_tile_count: 0,
		item_attrs: HashMap::new(),
		history: History::default(),
	}
}

pub(crate) fn lazy_model(width: u16, height: u16, idx: &MapIndex, source: std::path::PathBuf) -> MapModel {
	let mut chunk_ranges: HashMap<u64, (u64, u64)> = HashMap::with_capacity(idx.chunks.len());
	let mut floor_chunks: HashMap<u8, Vec<u32>> = HashMap::new();
	let mut floor_set: HashSet<u8> = HashSet::new();
	let mut total_tiles = 0u32;
	for c in &idx.chunks {
		let key = (c.cx as u32) << 16 | c.cy as u32;
		chunk_ranges.insert(ckey(c.z, key), (c.start, c.end));
		floor_chunks.entry(c.z).or_default().push(key);
		floor_set.insert(c.z);
		total_tiles += c.count;
	}
	let mut available_floors: Vec<u8> = floor_set.into_iter().collect();
	available_floors.sort_unstable();

	MapModel {
		width,
		height,
		min_x: idx.min_x,
		min_y: idx.min_y,
		max_x: idx.max_x,
		max_y: idx.max_y,
		tile_x: Vec::new(),
		tile_y: Vec::new(),
		item_off: vec![0],
		client_ids: Vec::new(),
		server_ids: Vec::new(),
		subtypes: Vec::new(),
		tile_flags: Vec::new(),
		house_ids: Vec::new(),
		floors: HashMap::new(),
		teleports: idx.teleports.clone(),
		teleport_count: idx.teleport_count,
		edits: HashMap::new(),
		flag_edits: HashMap::new(),
		house_edits: HashMap::new(),
		door_ids: Vec::new(),
		door_edits: HashMap::new(),
		source_path: Some(source),
		available_floors,
		total_tiles,
		eager: false,
		loaded_chunks: HashSet::new(),
		chunk_ranges,
		floor_chunks,
		description: idx.description.clone(),
		spawn_file: idx.spawn_file.clone(),
		house_file: idx.house_file.clone(),
		otbm_version: idx.otbm_version,
		items_major: idx.items_major,
		items_minor: idx.items_minor,
		towns: idx.towns.clone(),
		waypoints: Vec::new(),
		house_tile_count: idx.house_tile_count,
		item_attrs: HashMap::new(),
		history: History::default(),
	}
}

struct FloorCollector<'a> {
	otb: &'a OtbItems,
	xs: Vec<u16>,
	ys: Vec<u16>,
	item_start: Vec<u32>,
	item_count: Vec<u16>,
	client_ids: Vec<u16>,
	server_ids: Vec<u16>,
	subtypes: Vec<u8>,
	flags: Vec<u32>,
	house_ids: Vec<u32>,
	door_ids: Vec<u8>,
	attrs: Vec<(u16, u16, u8, ItemAttrs)>,
}

impl OtbmVisitor for FloorCollector<'_> {
	fn header(&mut self, _w: u16, _h: u16) {}
	fn progress(&mut self, _pos: usize, _total: usize) {}
	fn teleport(&mut self, _sx: u16, _sy: u16, _sz: u8, _dx: u16, _dy: u16, _dz: u8) {}
	fn tile(&mut self, x: u16, y: u16, _z: u8, items: &[(u16, u8)]) {
		let start = self.client_ids.len() as u32;
		let mut n: u16 = 0;
		for &(sid, sub) in items {
			if let Some(cid) = self.otb.client_id(sid) {
				if cid != 0 {
					self.client_ids.push(cid);
					self.server_ids.push(sid);
					self.subtypes.push(sub);
					n += 1;
				}
			}
		}
		self.xs.push(x);
		self.ys.push(y);
		self.item_start.push(start);
		self.item_count.push(n);
		self.flags.push(0);
		self.house_ids.push(0);
		self.door_ids.push(0);
	}
	fn tile_flags(&mut self, _x: u16, _y: u16, _z: u8, flags: u32) {
		if let Some(last) = self.flags.last_mut() {
			*last = flags;
		}
	}
	fn house_tile(&mut self, _x: u16, _y: u16, _z: u8, house_id: u32) {
		if let Some(last) = self.house_ids.last_mut() {
			*last = house_id;
		}
	}
	fn tile_door(&mut self, _x: u16, _y: u16, _z: u8, door_id: u8) {
		if let Some(last) = self.door_ids.last_mut() {
			*last = door_id;
		}
	}
	fn tile_item_attrs(&mut self, x: u16, y: u16, _z: u8, stack_idx: u8, attrs: ItemAttrs) {
		self.attrs.push((x, y, stack_idx, attrs));
	}
}

#[tauri::command]
pub fn new_otbm(width: u16, height: u16, map_state: tauri::State<MapState>) -> Result<Response, String> {
	let model = empty_model(width, height);
	let meta = serialize_meta(&model);
	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	Ok(Response::new(store_map(&mut guard, model, meta)))
}

#[tauri::command]
pub fn close_map(map_id: u32, map_state: tauri::State<MapState>) -> Result<(), String> {
	map_state.lock().map_err(|e| format!("Lock error: {}", e))?.maps.remove(&map_id);
	Ok(())
}

#[tauri::command]
pub fn get_map_chunks(
	map_id: u32,
	z: u8,
	keys: Vec<u32>,
	otb_state: tauri::State<OtbState>,
	map_state: tauri::State<MapState>,
) -> Result<Response, String> {
	let otb_guard = otb_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let otb = otb_guard.as_ref().ok_or("items.otb not loaded")?;
	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let model = guard.maps.get_mut(&map_id).ok_or("map not loaded - call open_otbm first")?;
	model.ensure_chunks(z, &keys, otb)?;
	Ok(Response::new(serialize_chunks(model, z, &keys)))
}

#[tauri::command]
pub fn set_minimap_palette(colors: Vec<u8>, palette_state: tauri::State<MinimapPaletteState>) -> Result<(), String> {
	*palette_state.lock().map_err(|e| format!("Lock error: {}", e))? = colors;
	Ok(())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn get_minimap(
	map_id: u32,
	z: u8,
	x: u16,
	y: u16,
	w: u16,
	h: u16,
	otb_state: tauri::State<OtbState>,
	map_state: tauri::State<MapState>,
	palette_state: tauri::State<MinimapPaletteState>,
) -> Result<Response, String> {
	let palette_guard = palette_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let otb_guard = otb_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let otb = otb_guard.as_ref().ok_or("items.otb not loaded")?;
	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let model = guard.maps.get_mut(&map_id).ok_or("map not loaded - call open_otbm first")?;
	let payload = model.window_minimap(z, x, y, w, h, &palette_guard, otb)?;
	Ok(Response::new(payload))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TileItemEntry {
	pub server_id: u16,
	pub client_id: u16,
	pub subtype: u8,
	pub action_id: u16,
	pub unique_id: u16,
	pub text: String,
	pub desc: String,
	pub charges: u16,
	pub tier: u8,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TilePropertiesPayload {
	pub flags: u32,
	pub house_id: u32,
	pub door_id: u8,
	pub items: Vec<TileItemEntry>,
}

#[tauri::command]
pub fn get_tile_items(
	map_id: u32,
	z: u8,
	x: u16,
	y: u16,
	otb_state: tauri::State<OtbState>,
	map_state: tauri::State<MapState>,
) -> Result<TilePropertiesPayload, String> {
	let otb_guard = otb_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let otb = otb_guard.as_ref().ok_or("items.otb not loaded")?;
	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let m = guard.maps.get_mut(&map_id).ok_or("map not loaded")?;
	let chunk_key = chunk_key_of(x, y);
	m.ensure_chunks(z, &[chunk_key], otb)?;
	let tile_flags = flags_at(m, z, x, y);
	let tile_house = house_id_at(m, z, x, y);
	let tile_door = door_id_at(m, z, x, y);
	let stack = stack_at(m, z, x, y);
	let mut items = Vec::with_capacity(stack.len());
	for (i, &(cid, sid)) in stack.iter().enumerate() {
		let key = crate::otbm::attrs_key(z, x, y, i as u8);
		let a = m.item_attrs.get(&key);
		let sub = base_subtype(m, z, chunk_key, x, y, i);
		items.push(TileItemEntry {
			server_id: sid,
			client_id: cid,
			subtype: sub,
			action_id: a.map_or(0, |a| a.action_id),
			unique_id: a.map_or(0, |a| a.unique_id),
			text: a.map_or_else(String::new, |a| a.text.clone()),
			desc: a.map_or_else(String::new, |a| a.desc.clone()),
			charges: a.map_or(0, |a| a.charges),
			tier: a.map_or(0, |a| a.tier),
		});
	}
	Ok(TilePropertiesPayload { flags: tile_flags, house_id: tile_house, door_id: tile_door, items })
}

#[tauri::command]
pub fn undo_edit(map_id: u32, map_state: tauri::State<MapState>) -> Result<Vec<(u8, u32)>, String> {
	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let m = guard.maps.get_mut(&map_id).ok_or("map not loaded")?;
	Ok(m.undo())
}

#[tauri::command]
pub fn redo_edit(map_id: u32, map_state: tauri::State<MapState>) -> Result<Vec<(u8, u32)>, String> {
	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let m = guard.maps.get_mut(&map_id).ok_or("map not loaded")?;
	Ok(m.redo())
}

#[cfg(test)]
mod tests {
	use super::*;

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
		let subtypes = vec![1u8, 1, 1, 1, 1];
		build_map_model(10, 20, &xs, &ys, &zs, &item_start, &item_count, &client_ids, &server_ids, &subtypes, &[], &[], &[], Vec::new(), 0)
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
		assert_eq!(u32_at(&buf, o + 4), 0);
		assert_eq!(u32_at(&buf, o + 8), 0);
		assert_eq!(u16_at(&buf, o + 12), 1);
		assert_eq!(u16_at(&buf, o + 14), 100);
		assert_eq!(u16_at(&buf, o + 16), 900);
		assert_eq!(buf[o + 18], 1);
		o += 19;
		assert_eq!(u16_at(&buf, o), 33);
		assert_eq!(u16_at(&buf, o + 2), 5);
		assert_eq!(u32_at(&buf, o + 4), 0);
		assert_eq!(u32_at(&buf, o + 8), 0);
		assert_eq!(u16_at(&buf, o + 12), 2);
		assert_eq!(u16_at(&buf, o + 14), 102);
		assert_eq!(u16_at(&buf, o + 19), 103);
	}
}
