use std::collections::{HashMap, HashSet};
use std::io::{Read, Seek, SeekFrom};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::ipc::Response;

use crate::formats::tibia::otb::OtbItems;
use crate::formats::tibia::otbm::{read_otbm_floor, ContainedItem, ItemAttrs, OtbmVisitor};
use crate::formats::tibia::otbm_footer::MapIndex;
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
pub(crate) const ACTION_ATTRS: u8 = 7;

const DEFAULT_UNDO_STEPS: usize = 200;
const DEFAULT_UNDO_BYTES: usize = 256 * 1024 * 1024;
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

struct DoorChange {
	z: u8,
	pos: u32,
	before: u8,
	after: u8,
}

struct AttrChange {
	key: u64,
	before: Option<ItemAttrs>,
	after: Option<ItemAttrs>,
}

struct ContentsChange {
	key: u64,
	before: Option<Vec<ContainedItem>>,
	after: Option<Vec<ContainedItem>>,
}

#[derive(Default)]
struct Batch {
	items: Vec<TileChange>,
	flags: Vec<FlagChange>,
	houses: Vec<HouseChange>,
	doors: Vec<DoorChange>,
	attrs: Vec<AttrChange>,
	contents: Vec<ContentsChange>,
	sidecar_before: String,
	sidecar_after: String,
}

impl Batch {
	fn is_empty(&self) -> bool {
		self.items.is_empty()
			&& self.flags.is_empty()
			&& self.houses.is_empty()
			&& self.doors.is_empty()
			&& self.attrs.is_empty()
			&& self.contents.is_empty()
			&& self.sidecar_before.is_empty()
			&& self.sidecar_after.is_empty()
	}

	fn memsize(&self) -> usize {
		let items: usize = self.items.iter().map(|c| 24 + (c.before.len() + c.after.len()) * 4).sum();
		items
			+ self.flags.len() * 16
			+ self.houses.len() * 16
			+ self.doors.len() * 8
			+ self.attrs.len() * 80
			+ self.contents.len() * 128
			+ self.sidecar_before.len()
			+ self.sidecar_after.len()
			+ 64
	}
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditResult {
	pub applied: bool,
	pub touched: Vec<(u8, u32)>,
	pub sidecar: String,
}

struct History {
	recording: Option<HashMap<(u8, u32), Vec<(u16, u16)>>>,
	flag_recording: Option<HashMap<(u8, u32), u32>>,
	house_recording: Option<HashMap<(u8, u32), u32>>,
	door_recording: Option<HashMap<(u8, u32), u8>>,
	attr_recording: Option<HashMap<u64, Option<ItemAttrs>>>,
	contents_recording: Option<HashMap<u64, Option<Vec<ContainedItem>>>>,
	undo: Vec<Batch>,
	redo: Vec<Batch>,
	last_kind: u8,
	last_commit: Option<Instant>,
	max_steps: usize,
	max_bytes: usize,
	used_bytes: usize,
}

impl Default for History {
	fn default() -> Self {
		History {
			recording: None,
			flag_recording: None,
			house_recording: None,
			door_recording: None,
			attr_recording: None,
			contents_recording: None,
			undo: Vec::new(),
			redo: Vec::new(),
			last_kind: 0,
			last_commit: None,
			max_steps: DEFAULT_UNDO_STEPS,
			max_bytes: DEFAULT_UNDO_BYTES,
			used_bytes: 0,
		}
	}
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
	pub(crate) container_contents: HashMap<u64, Vec<ContainedItem>>,
	pub(crate) strip_action_ids: bool,
	pub(crate) strip_unique_ids: bool,
	history: History,
}

pub(crate) fn ckey(z: u8, chunk: u32) -> u64 {
	((z as u64) << 32) | chunk as u64
}

pub(crate) struct ImportOverlay<'a> {
	pub dests: &'a [Option<(u16, u16, u8)>],
	pub item_off: &'a [u32],
	pub client_ids: &'a [u16],
	pub server_ids: &'a [u16],
	pub flags: &'a [u32],
	pub house_ids: &'a [u32],
	pub door_ids: &'a [u8],
	pub house_id_map: &'a std::collections::HashMap<u32, u32>,
	pub import_houses: bool,
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
		container_contents: HashMap::new(),
		strip_action_ids: false,
		strip_unique_ids: false,
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
				let x = (pos >> 16) as u16;
				let y = (pos & 0xFFFF) as u16;
				let base = base_flags(m, z, k, x, y);
				let house = base_house_id(m, z, k, x, y);
				let items = stack
					.iter()
					.enumerate()
					.map(|(idx, &(cl, sv))| (cl, sv, subtype_at(m, z, x, y, idx)))
					.collect();
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

fn push_str_u16(out: &mut Vec<u8>, s: &str) {
	let b = s.as_bytes();
	push_u16(out, b.len().min(u16::MAX as usize) as u16);
	out.extend_from_slice(&b[..b.len().min(u16::MAX as usize)]);
}

pub(crate) fn serialize_chunk_tooltips(m: &MapModel, z: u8, keys: &[u32]) -> Vec<u8> {
	let mut out = Vec::new();
	push_u32(&mut out, 0);
	let mut chunk_count = 0u32;
	for &k in keys {
		let mut positions: Vec<(u16, u16)> = Vec::new();
		let edits_chunk = m.edits.get(&z).and_then(|c| c.get(&k));
		if let Some(&(start, end)) = m.floors.get(&z).and_then(|f| f.get(&k)) {
			for t in start as usize..end as usize {
				let x = m.tile_x[t];
				let y = m.tile_y[t];
				let pos = (x as u32) << 16 | y as u32;
				if edits_chunk.is_some_and(|c| c.contains_key(&pos)) {
					continue;
				}
				positions.push((x, y));
			}
		}
		if let Some(c) = edits_chunk {
			for &pos in c.keys() {
				positions.push(((pos >> 16) as u16, (pos & 0xFFFF) as u16));
			}
		}
		positions.sort_unstable_by_key(|(x, y)| (*y, *x));
		positions.dedup();

		let mut tile_bytes = Vec::new();
		let mut tile_count = 0u32;
		for (x, y) in positions {
			let door = door_id_at(m, z, x, y);
			let stack_len = stack_at(m, z, x, y).len();
			let mut action = 0u16;
			let mut unique = 0u16;
			let mut text = String::new();
			let mut desc = String::new();
			for i in 0..stack_len {
				if let Some(a) = m.item_attrs.get(&crate::formats::tibia::otbm::attrs_key(z, x, y, i as u8)) {
					if action == 0 {
						action = a.action_id;
					}
					if unique == 0 {
						unique = a.unique_id;
					}
					if text.is_empty() {
						text = a.text.clone();
					}
					if desc.is_empty() {
						desc = a.desc.clone();
					}
				}
			}
			if action == 0 && unique == 0 && door == 0 && text.is_empty() && desc.is_empty() {
				continue;
			}
			push_u16(&mut tile_bytes, x);
			push_u16(&mut tile_bytes, y);
			push_u16(&mut tile_bytes, action);
			push_u16(&mut tile_bytes, unique);
			push_u16(&mut tile_bytes, door as u16);
			push_str_u16(&mut tile_bytes, &text);
			push_str_u16(&mut tile_bytes, &desc);
			tile_count += 1;
		}
		if tile_count == 0 {
			continue;
		}
		push_u16(&mut out, (k >> 16) as u16);
		push_u16(&mut out, (k & 0xFFFF) as u16);
		push_u32(&mut out, tile_count);
		out.extend_from_slice(&tile_bytes);
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

pub(crate) fn base_first_item(m: &MapModel, z: u8, chunk_key: u32, x: u16, y: u16) -> Option<(u16, u16)> {
	let &(start, end) = m.floors.get(&z)?.get(&chunk_key)?;
	for t in start as usize..end as usize {
		if m.tile_x[t] == x && m.tile_y[t] == y {
			let s = m.item_off[t] as usize;
			if s >= m.item_off[t + 1] as usize {
				return None;
			}
			return Some((m.client_ids[s], m.server_ids[s]));
		}
	}
	None
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

pub(crate) fn subtype_at(m: &MapModel, z: u8, x: u16, y: u16, item_idx: usize) -> u8 {
	let key = crate::formats::tibia::otbm::attrs_key(z, x, y, item_idx as u8);
	if let Some(a) = m.item_attrs.get(&key) {
		if a.subtype > 0 {
			return a.subtype;
		}
	}
	base_subtype(m, z, chunk_key_of(x, y), x, y, item_idx)
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

pub(crate) fn with_stack<R>(m: &MapModel, z: u8, x: u16, y: u16, f: impl FnOnce(&[(u16, u16)]) -> R) -> R {
	let chunk_key = chunk_key_of(x, y);
	let pos = (x as u32) << 16 | y as u32;
	if let Some(stack) = m.edits.get(&z).and_then(|c| c.get(&chunk_key)).and_then(|t| t.get(&pos)) {
		return f(stack);
	}
	f(&base_tile_items(m, z, chunk_key, x, y))
}

pub(crate) fn first_item_at(m: &MapModel, z: u8, x: u16, y: u16) -> Option<(u16, u16)> {
	let chunk_key = chunk_key_of(x, y);
	let pos = (x as u32) << 16 | y as u32;
	if let Some(stack) = m.edits.get(&z).and_then(|c| c.get(&chunk_key)).and_then(|t| t.get(&pos)) {
		return stack.first().copied();
	}
	base_first_item(m, z, chunk_key, x, y)
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
				contents: Vec::new(),
			};
			read_otbm_floor(&slice, &mut col)?;
			for (x, y, idx, a) in &col.attrs {
				self.item_attrs.insert(crate::formats::tibia::otbm::attrs_key(z, *x, *y, *idx), a.clone());
			}
			for (x, y, idx, c) in col.contents.drain(..) {
				self.container_contents.insert(crate::formats::tibia::otbm::attrs_key(z, x, y, idx), c);
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
		if self.history.door_recording.is_none() {
			self.history.door_recording = Some(HashMap::new());
		}
		if self.history.attr_recording.is_none() {
			self.history.attr_recording = Some(HashMap::new());
		}
		if self.history.contents_recording.is_none() {
			self.history.contents_recording = Some(HashMap::new());
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
		if self.history.door_recording.as_ref().is_some_and(|r| !r.contains_key(&(z, pos))) {
			let before = door_id_at(self, z, x, y);
			self.history.door_recording.as_mut().unwrap().insert((z, pos), before);
		}
		self.door_edits.entry(z).or_default().entry(chunk_key).or_default().insert(pos, door_id);
	}

	pub(crate) fn set_item_attr(&mut self, key: u64, new_attrs: ItemAttrs) {
		if let Some(r) = self.history.attr_recording.as_mut() {
			if !r.contains_key(&key) {
				r.insert(key, self.item_attrs.get(&key).cloned());
			}
		}
		if new_attrs.is_default() {
			self.item_attrs.remove(&key);
		} else {
			self.item_attrs.insert(key, new_attrs);
		}
	}

	pub(crate) fn set_container_contents(&mut self, key: u64, contents: Vec<ContainedItem>) {
		if let Some(r) = self.history.contents_recording.as_mut() {
			if !r.contains_key(&key) {
				r.insert(key, self.container_contents.get(&key).cloned());
			}
		}
		if contents.is_empty() {
			self.container_contents.remove(&key);
		} else {
			self.container_contents.insert(key, contents);
		}
	}

	pub(crate) fn record_commit(&mut self, kind: u8) {
		let item_before = self.history.recording.take();
		let flag_before = self.history.flag_recording.take();
		let house_before = self.history.house_recording.take();
		let door_before = self.history.door_recording.take();
		let attr_before = self.history.attr_recording.take();
		let contents_before = self.history.contents_recording.take();
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
		let mut doors: Vec<DoorChange> = door_before
			.into_iter()
			.flatten()
			.filter_map(|((z, pos), before)| {
				let after = door_id_at(self, z, (pos >> 16) as u16, (pos & 0xFFFF) as u16);
				(before != after).then_some(DoorChange { z, pos, before, after })
			})
			.collect();
		let mut attrs: Vec<AttrChange> = attr_before
			.into_iter()
			.flatten()
			.filter_map(|(key, before)| {
				let after = self.item_attrs.get(&key).cloned();
				(before != after).then_some(AttrChange { key, before, after })
			})
			.collect();
		let mut contents: Vec<ContentsChange> = contents_before
			.into_iter()
			.flatten()
			.filter_map(|(key, before)| {
				let after = self.container_contents.get(&key).cloned();
				(before != after).then_some(ContentsChange { key, before, after })
			})
			.collect();
		if items.is_empty()
			&& flags.is_empty()
			&& houses.is_empty()
			&& doors.is_empty()
			&& attrs.is_empty()
			&& contents.is_empty()
		{
			return;
		}

		let mergeable = matches!(kind, ACTION_PAINT | ACTION_ERASE | ACTION_FLAG | ACTION_HOUSE)
			&& self.history.last_kind == kind
			&& self.history.redo.is_empty()
			&& self.history.undo.last().is_some_and(|b| b.sidecar_before.is_empty() && b.sidecar_after.is_empty())
			&& self.history.last_commit.is_some_and(|t| t.elapsed() < MERGE_WINDOW);

		if mergeable {
			if let Some(group) = self.history.undo.last_mut() {
				let old = group.memsize();
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
				for ch in doors.drain(..) {
					match group.doors.iter_mut().find(|c| c.z == ch.z && c.pos == ch.pos) {
						Some(existing) => existing.after = ch.after,
						None => group.doors.push(ch),
					}
				}
				for ch in attrs.drain(..) {
					match group.attrs.iter_mut().find(|c| c.key == ch.key) {
						Some(existing) => existing.after = ch.after,
						None => group.attrs.push(ch),
					}
				}
				for ch in contents.drain(..) {
					match group.contents.iter_mut().find(|c| c.key == ch.key) {
						Some(existing) => existing.after = ch.after,
						None => group.contents.push(ch),
					}
				}
				let new = group.memsize();
				self.history.used_bytes = self.history.used_bytes + new - old;
			}
			self.history.last_commit = Some(Instant::now());
		} else {
			self.push_batch(Batch {
				items,
				flags,
				houses,
				doors,
				attrs,
				contents,
				..Default::default()
			});
		}
		self.history.last_kind = kind;
	}

	fn clear_redo(&mut self) {
		let freed: usize = self.history.redo.iter().map(|b| b.memsize()).sum();
		self.history.used_bytes = self.history.used_bytes.saturating_sub(freed);
		self.history.redo.clear();
	}

	fn evict(&mut self) {
		while self.history.undo.len() > 1
			&& (self.history.undo.len() > self.history.max_steps || self.history.used_bytes > self.history.max_bytes)
		{
			let dropped = self.history.undo.remove(0);
			self.history.used_bytes = self.history.used_bytes.saturating_sub(dropped.memsize());
		}
	}

	fn push_batch(&mut self, batch: Batch) {
		self.clear_redo();
		self.history.used_bytes += batch.memsize();
		self.history.undo.push(batch);
		self.evict();
		self.history.last_commit = Some(Instant::now());
	}

	pub(crate) fn attach_sidecar(&mut self, before: String, after: String) {
		let used = &mut self.history.used_bytes;
		if let Some(batch) = self.history.undo.last_mut() {
			*used = used.saturating_sub(batch.sidecar_before.len() + batch.sidecar_after.len());
			batch.sidecar_before = before;
			batch.sidecar_after = after;
			*used += batch.sidecar_before.len() + batch.sidecar_after.len();
		}
		self.history.last_commit = None;
		self.evict();
	}

	pub(crate) fn push_sidecar_batch(&mut self, before: String, after: String) {
		self.push_batch(Batch {
			sidecar_before: before,
			sidecar_after: after,
			..Default::default()
		});
		self.history.last_commit = None;
	}

	pub(crate) fn set_history_limits(&mut self, max_steps: usize, max_bytes: usize) {
		self.history.max_steps = max_steps.max(1);
		self.history.max_bytes = max_bytes;
		self.evict();
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

	fn set_door_overlay(&mut self, z: u8, pos: u32, door: u8) {
		let chunk_key = chunk_key_of((pos >> 16) as u16, (pos & 0xFFFF) as u16);
		self.door_edits.entry(z).or_default().entry(chunk_key).or_default().insert(pos, door);
	}

	#[allow(clippy::too_many_arguments)]
	pub(crate) fn import_overlay(&mut self, ops: &ImportOverlay, progress: &mut dyn FnMut(usize, usize)) -> (Vec<(u8, u32)>, u32) {
		let n = ops.dests.len();
		let mut batch = Batch::default();
		let mut touched: HashSet<(u8, u32)> = HashSet::new();
		let mut imported = 0u32;
		for i in 0..n {
			if i % 65536 == 0 {
				progress(i, n);
			}
			let Some((nx, ny, nz)) = ops.dests[i] else { continue };
			let src_house = ops.house_ids[i];
			if !ops.import_houses && src_house != 0 {
				continue;
			}
			let pos = (nx as u32) << 16 | ny as u32;
			let chunk = chunk_key_of(nx, ny);

			let s = ops.item_off[i] as usize;
			let e = ops.item_off[i + 1] as usize;
			let mut items: Vec<(u16, u16)> = Vec::with_capacity(e - s);
			for j in s..e {
				items.push((ops.client_ids[j], ops.server_ids[j]));
			}

			let before = stack_at(self, nz, nx, ny);
			let after = items.clone();
			self.edits.entry(nz).or_default().entry(chunk).or_default().insert(pos, items);
			batch.items.push(TileChange { z: nz, pos, before, after });

			let flags = ops.flags[i];
			if flags != 0 {
				let before_f = flags_at(self, nz, nx, ny);
				if before_f != flags {
					self.flag_edits.entry(nz).or_default().entry(chunk).or_default().insert(pos, flags);
					batch.flags.push(FlagChange { z: nz, pos, before: before_f, after: flags });
				}
			}
			let mapped_house = if src_house == 0 {
				0
			} else {
				ops.house_id_map.get(&src_house).copied().unwrap_or(src_house)
			};
			if mapped_house != 0 {
				let before_h = house_id_at(self, nz, nx, ny);
				if before_h != mapped_house {
					self.house_edits.entry(nz).or_default().entry(chunk).or_default().insert(pos, mapped_house);
					batch.houses.push(HouseChange { z: nz, pos, before: before_h, after: mapped_house });
				}
			}
			let door = ops.door_ids[i];
			if door != 0 {
				self.door_edits.entry(nz).or_default().entry(chunk).or_default().insert(pos, door);
			}
			touched.insert((nz, chunk));
			imported += 1;
		}
		progress(n, n);

		if !batch.is_empty() {
			self.push_batch(batch);
			self.history.last_kind = ACTION_PAINT;
		}
		(touched.into_iter().collect(), imported)
	}

	pub(crate) fn undo(&mut self) -> EditResult {
		let Some(batch) = self.history.undo.pop() else {
			return EditResult { applied: false, touched: Vec::new(), sidecar: String::new() };
		};
		let touched = self.apply(&batch, true);
		let sidecar = batch.sidecar_before.clone();
		self.history.redo.push(batch);
		self.history.last_commit = None;
		EditResult { applied: true, touched, sidecar }
	}

	pub(crate) fn redo(&mut self) -> EditResult {
		let Some(batch) = self.history.redo.pop() else {
			return EditResult { applied: false, touched: Vec::new(), sidecar: String::new() };
		};
		let touched = self.apply(&batch, false);
		let sidecar = batch.sidecar_after.clone();
		self.history.undo.push(batch);
		self.history.last_commit = None;
		EditResult { applied: true, touched, sidecar }
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
		for ch in &batch.doors {
			let door = if to_before { ch.before } else { ch.after };
			self.set_door_overlay(ch.z, ch.pos, door);
			let chunk_key = chunk_key_of((ch.pos >> 16) as u16, (ch.pos & 0xFFFF) as u16);
			touched.insert((ch.z, chunk_key));
		}
		for ch in &batch.attrs {
			let val = if to_before { &ch.before } else { &ch.after };
			match val {
				Some(a) => { self.item_attrs.insert(ch.key, a.clone()); }
				None => { self.item_attrs.remove(&ch.key); }
			}
		}
		for ch in &batch.contents {
			let val = if to_before { &ch.before } else { &ch.after };
			match val {
				Some(c) => { self.container_contents.insert(ch.key, c.clone()); }
				None => { self.container_contents.remove(&ch.key); }
			}
			let z = (ch.key >> 40) as u8;
			let x = ((ch.key >> 24) & 0xFFFF) as u16;
			let y = ((ch.key >> 8) & 0xFFFF) as u16;
			touched.insert((z, chunk_key_of(x, y)));
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
		container_contents: HashMap::new(),
		strip_action_ids: false,
		strip_unique_ids: false,
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
		container_contents: HashMap::new(),
		strip_action_ids: false,
		strip_unique_ids: false,
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
	contents: Vec<(u16, u16, u8, Vec<ContainedItem>)>,
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
	fn tile_item_contents(&mut self, x: u16, y: u16, _z: u8, stack_idx: u8, contents: Vec<ContainedItem>) {
		self.contents.push((x, y, stack_idx, contents));
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
	let otb_guard = otb_state.read().map_err(|e| format!("Lock error: {}", e))?;
	let empty = OtbItems::default();
	let otb = otb_guard.as_ref().unwrap_or(&empty);
	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let model = guard.maps.get_mut(&map_id).ok_or("map not loaded - call open_otbm first")?;
	model.ensure_chunks(z, &keys, otb)?;
	Ok(Response::new(serialize_chunks(model, z, &keys)))
}

#[tauri::command]
pub fn get_chunk_tooltips(
	map_id: u32,
	z: u8,
	keys: Vec<u32>,
	otb_state: tauri::State<OtbState>,
	map_state: tauri::State<MapState>,
) -> Result<Response, String> {
	let otb_guard = otb_state.read().map_err(|e| format!("Lock error: {}", e))?;
	let empty = OtbItems::default();
	let otb = otb_guard.as_ref().unwrap_or(&empty);
	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let model = guard.maps.get_mut(&map_id).ok_or("map not loaded - call open_otbm first")?;
	model.ensure_chunks(z, &keys, otb)?;
	Ok(Response::new(serialize_chunk_tooltips(model, z, &keys)))
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
	let otb_guard = otb_state.read().map_err(|e| format!("Lock error: {}", e))?;
	let empty = OtbItems::default();
	let otb = otb_guard.as_ref().unwrap_or(&empty);
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
	pub group: u8,
	pub kind: String,
	pub action_id: u16,
	pub unique_id: u16,
	pub text: String,
	pub desc: String,
	pub charges: u16,
	pub tier: u8,
	pub depot_id: u16,
	pub tele_x: u16,
	pub tele_y: u16,
	pub tele_z: u8,
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
	let otb_guard = otb_state.read().map_err(|e| format!("Lock error: {}", e))?;
	let empty = OtbItems::default();
	let otb = otb_guard.as_ref().unwrap_or(&empty);
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
		let key = crate::formats::tibia::otbm::attrs_key(z, x, y, i as u8);
		let a = m.item_attrs.get(&key);
		let sub = subtype_at(m, z, x, y, i);
		items.push(TileItemEntry {
			server_id: sid,
			client_id: cid,
			subtype: sub,
			group: otb.group(sid),
			kind: otb.kind(sid).to_string(),
			action_id: a.map_or(0, |a| a.action_id),
			unique_id: a.map_or(0, |a| a.unique_id),
			text: a.map_or_else(String::new, |a| a.text.clone()),
			desc: a.map_or_else(String::new, |a| a.desc.clone()),
			charges: a.map_or(0, |a| a.charges),
			tier: a.map_or(0, |a| a.tier),
			depot_id: a.map_or(0, |a| a.depot_id),
			tele_x: a.map_or(0, |a| a.tele_x),
			tele_y: a.map_or(0, |a| a.tele_y),
			tele_z: a.map_or(0, |a| a.tele_z),
		});
	}
	Ok(TilePropertiesPayload { flags: tile_flags, house_id: tile_house, door_id: tile_door, items })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdMarker {
	pub x: u16,
	pub y: u16,
	pub z: u8,
	pub action_id: u16,
	pub unique_id: u16,
}

#[tauri::command]
pub fn list_id_markers(
	map_id: u32,
	otb_state: tauri::State<OtbState>,
	map_state: tauri::State<MapState>,
) -> Result<Vec<IdMarker>, String> {
	let otb_guard = otb_state.read().map_err(|e| format!("Lock error: {}", e))?;
	let empty = OtbItems::default();
	let otb = otb_guard.as_ref().unwrap_or(&empty);
	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let m = guard.maps.get_mut(&map_id).ok_or("map not loaded")?;

	for z in m.available_floors.clone() {
		m.ensure_floor(z, otb)?;
	}

	let mut markers: Vec<IdMarker> = m
		.item_attrs
		.iter()
		.filter(|(_, a)| a.action_id > 0 || a.unique_id > 0)
		.map(|(&key, a)| IdMarker {
			z: (key >> 40) as u8,
			x: ((key >> 24) & 0xFFFF) as u16,
			y: ((key >> 8) & 0xFFFF) as u16,
			action_id: a.action_id,
			unique_id: a.unique_id,
		})
		.collect();
	markers.sort_unstable_by_key(|m| (m.z, m.y, m.x, m.action_id, m.unique_id));
	Ok(markers)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemMarker {
	pub x: u16,
	pub y: u16,
	pub z: u8,
	pub client_id: u16,
	pub server_id: u16,
	pub has_contents: bool,
}

#[tauri::command]
pub fn list_items_with_client_ids(
	map_id: u32,
	client_ids: Vec<u16>,
	otb_state: tauri::State<OtbState>,
	map_state: tauri::State<MapState>,
) -> Result<Vec<ItemMarker>, String> {
	let wanted: HashSet<u16> = client_ids.into_iter().collect();
	if wanted.is_empty() {
		return Ok(Vec::new());
	}
	let otb_guard = otb_state.read().map_err(|e| format!("Lock error: {}", e))?;
	let empty = OtbItems::default();
	let otb = otb_guard.as_ref().unwrap_or(&empty);
	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let m = guard.maps.get_mut(&map_id).ok_or("map not loaded")?;

	let floors = m.available_floors.clone();
	for z in floors.iter().copied() {
		m.ensure_floor(z, otb)?;
	}

	let mut out: Vec<ItemMarker> = Vec::new();
	for z in floors {
		let mut positions: Vec<(u16, u16)> = Vec::new();
		if let Some(f) = m.floors.get(&z) {
			for &(start, end) in f.values() {
				for t in start as usize..end as usize {
					positions.push((m.tile_x[t], m.tile_y[t]));
				}
			}
		}
		if let Some(c) = m.edits.get(&z) {
			for tiles in c.values() {
				for &pos in tiles.keys() {
					positions.push(((pos >> 16) as u16, (pos & 0xFFFF) as u16));
				}
			}
		}
		positions.sort_unstable_by_key(|(x, y)| (*y, *x));
		positions.dedup();
		for (x, y) in positions {
			for (idx, (client_id, server_id)) in stack_at(m, z, x, y).into_iter().enumerate() {
				if wanted.contains(&client_id) {
					let has_contents = m
						.item_attrs
						.get(&crate::formats::tibia::otbm::attrs_key(z, x, y, idx as u8))
						.is_some_and(|a| a.has_contents);
					out.push(ItemMarker { x, y, z, client_id, server_id, has_contents });
				}
			}
		}
	}
	Ok(out)
}

#[tauri::command]
pub fn undo_edit(map_id: u32, map_state: tauri::State<MapState>) -> Result<EditResult, String> {
	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let m = guard.maps.get_mut(&map_id).ok_or("map not loaded")?;
	Ok(m.undo())
}

#[tauri::command]
pub fn redo_edit(map_id: u32, map_state: tauri::State<MapState>) -> Result<EditResult, String> {
	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let m = guard.maps.get_mut(&map_id).ok_or("map not loaded")?;
	Ok(m.redo())
}

#[tauri::command]
pub fn attach_undo_sidecar(map_id: u32, before: String, after: String, map_state: tauri::State<MapState>) -> Result<(), String> {
	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let m = guard.maps.get_mut(&map_id).ok_or("map not loaded")?;
	m.attach_sidecar(before, after);
	Ok(())
}

#[tauri::command]
pub fn push_undo_sidecar(map_id: u32, before: String, after: String, map_state: tauri::State<MapState>) -> Result<(), String> {
	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let m = guard.maps.get_mut(&map_id).ok_or("map not loaded")?;
	m.push_sidecar_batch(before, after);
	Ok(())
}

#[tauri::command]
pub fn set_history_limits(map_id: u32, max_steps: u32, max_bytes: f64, map_state: tauri::State<MapState>) -> Result<(), String> {
	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let m = guard.maps.get_mut(&map_id).ok_or("map not loaded")?;
	m.set_history_limits(max_steps as usize, max_bytes as usize);
	Ok(())
}

#[tauri::command]
pub fn strip_action_ids(map_id: u32, map_state: tauri::State<MapState>) -> Result<u32, String> {
	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let m = guard.maps.get_mut(&map_id).ok_or("map not loaded")?;
	let mut count = 0u32;
	for attrs in m.item_attrs.values_mut() {
		if attrs.action_id > 0 {
			attrs.action_id = 0;
			count += 1;
		}
	}
	m.item_attrs.retain(|_, a| !a.is_default());
	m.strip_action_ids = true;
	Ok(count)
}

#[tauri::command]
pub fn strip_unique_ids(map_id: u32, map_state: tauri::State<MapState>) -> Result<u32, String> {
	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let m = guard.maps.get_mut(&map_id).ok_or("map not loaded")?;
	let mut count = 0u32;
	for attrs in m.item_attrs.values_mut() {
		if attrs.unique_id > 0 {
			attrs.unique_id = 0;
			count += 1;
		}
	}
	m.item_attrs.retain(|_, a| !a.is_default());
	m.strip_unique_ids = true;
	Ok(count)
}

#[tauri::command]
pub fn clear_marker_at(map_id: u32, z: u8, x: u16, y: u16, action: bool, map_state: tauri::State<MapState>) -> Result<(), String> {
	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let m = guard.maps.get_mut(&map_id).ok_or("map not loaded")?;
	for idx in 0..=255u8 {
		let key = crate::formats::tibia::otbm::attrs_key(z, x, y, idx);
		if let Some(a) = m.item_attrs.get_mut(&key) {
			if action {
				a.action_id = 0;
			} else {
				a.unique_id = 0;
			}
		}
	}
	m.item_attrs.retain(|_, a| !a.is_default());
	Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemAttrsPatch {
	pub action_id: u16,
	pub unique_id: u16,
	pub text: String,
	pub desc: String,
	pub charges: u16,
	pub tier: u8,
	pub depot_id: u16,
	pub subtype: u8,
	pub tele_x: u16,
	pub tele_y: u16,
	pub tele_z: u8,
}

#[tauri::command]
pub fn set_item_attrs(
	map_id: u32,
	z: u8,
	x: u16,
	y: u16,
	stack_idx: u8,
	patch: ItemAttrsPatch,
	map_state: tauri::State<MapState>,
) -> Result<(), String> {
	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let m = guard.maps.get_mut(&map_id).ok_or("map not loaded")?;

	let key = crate::formats::tibia::otbm::attrs_key(z, x, y, stack_idx);
	let new_attrs = ItemAttrs {
		action_id: patch.action_id,
		unique_id: patch.unique_id,
		text: patch.text,
		desc: patch.desc,
		charges: patch.charges,
		tier: patch.tier,
		depot_id: patch.depot_id,
		subtype: patch.subtype,
		has_contents: m.item_attrs.get(&key).map_or(false, |a| a.has_contents),
		tele_x: patch.tele_x,
		tele_y: patch.tele_y,
		tele_z: patch.tele_z,
	};

	let old_tele = m.item_attrs.get(&key).map(|a| (a.tele_x, a.tele_y, a.tele_z));
	let new_tele = (patch.tele_x, patch.tele_y, patch.tele_z);

	m.record_begin();
	m.set_item_attr(key, new_attrs);

	let pos = (x as u32) << 16 | y as u32;
	let chunk_key = chunk_key_of(x, y);
	if !m.edits.get(&z).and_then(|f| f.get(&chunk_key)).is_some_and(|c| c.contains_key(&pos)) {
		let stack = stack_at(m, z, x, y);
		m.edits.entry(z).or_default().entry(chunk_key).or_default().insert(pos, stack);
	}

	m.record_commit(ACTION_ATTRS);

	if old_tele != Some(new_tele) {
		update_teleport_blob(m, x, y, z, new_tele.0, new_tele.1, new_tele.2);
	}

	Ok(())
}

fn update_teleport_blob(m: &mut MapModel, sx: u16, sy: u16, sz: u8, dx: u16, dy: u16, dz: u8) {
	let count = m.teleport_count as usize;
	for i in 0..count {
		let off = i * 10;
		let ex = u16::from_le_bytes([m.teleports[off], m.teleports[off + 1]]);
		let ey = u16::from_le_bytes([m.teleports[off + 2], m.teleports[off + 3]]);
		let ez = m.teleports[off + 4];
		if ex == sx && ey == sy && ez == sz {
			if dx == 0 && dy == 0 && dz == 0 {
				m.teleports.drain(off..off + 10);
				m.teleport_count -= 1;
			} else {
				m.teleports[off + 5..off + 7].copy_from_slice(&dx.to_le_bytes());
				m.teleports[off + 7..off + 9].copy_from_slice(&dy.to_le_bytes());
				m.teleports[off + 9] = dz;
			}
			return;
		}
	}
	if dx != 0 || dy != 0 || dz != 0 {
		m.teleports.extend_from_slice(&sx.to_le_bytes());
		m.teleports.extend_from_slice(&sy.to_le_bytes());
		m.teleports.push(sz);
		m.teleports.extend_from_slice(&dx.to_le_bytes());
		m.teleports.extend_from_slice(&dy.to_le_bytes());
		m.teleports.push(dz);
		m.teleport_count += 1;
	}
}

fn ensure_tile_edited(m: &mut MapModel, z: u8, x: u16, y: u16) {
	let pos = (x as u32) << 16 | y as u32;
	let chunk_key = chunk_key_of(x, y);
	if !m.edits.get(&z).and_then(|f| f.get(&chunk_key)).is_some_and(|c| c.contains_key(&pos)) {
		let stack = stack_at(m, z, x, y);
		m.edits.entry(z).or_default().entry(chunk_key).or_default().insert(pos, stack);
	}
}

fn sync_has_contents(m: &mut MapModel, key: u64, has: bool) {
	let cur = m.item_attrs.get(&key).map(|a| a.has_contents).unwrap_or(false);
	if cur != has {
		let mut a = m.item_attrs.get(&key).cloned().unwrap_or_default();
		a.has_contents = has;
		m.set_item_attr(key, a);
	}
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerItemDto {
	pub server_id: u16,
	pub client_id: u16,
	pub subtype: u8,
	pub has_contents: bool,
}

fn nav_contents<'a>(root: &'a [ContainedItem], path: &[u32]) -> Option<&'a [ContainedItem]> {
	let mut cur = root;
	for &i in path {
		cur = &cur.get(i as usize)?.items;
	}
	Some(cur)
}

fn nav_contents_mut<'a>(root: &'a mut Vec<ContainedItem>, path: &[u32]) -> Option<&'a mut Vec<ContainedItem>> {
	let mut cur = root;
	for &i in path {
		cur = &mut cur.get_mut(i as usize)?.items;
	}
	Some(cur)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn get_container(
	map_id: u32,
	z: u8,
	x: u16,
	y: u16,
	stack_idx: u8,
	path: Vec<u32>,
	otb_state: tauri::State<OtbState>,
	map_state: tauri::State<MapState>,
) -> Result<Vec<ContainerItemDto>, String> {
	let otb_guard = otb_state.read().map_err(|e| format!("Lock error: {}", e))?;
	let empty = OtbItems::default();
	let otb = otb_guard.as_ref().unwrap_or(&empty);
	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let m = guard.maps.get_mut(&map_id).ok_or("map not loaded")?;
	m.ensure_chunks(z, &[chunk_key_of(x, y)], otb)?;
	let key = crate::formats::tibia::otbm::attrs_key(z, x, y, stack_idx);
	let root = m.container_contents.get(&key).cloned().unwrap_or_default();
	let list = nav_contents(&root, &path).unwrap_or(&[]);
	Ok(list
		.iter()
		.map(|c| ContainerItemDto {
			server_id: c.server_id,
			client_id: otb.client_id(c.server_id).unwrap_or(c.server_id),
			subtype: c.subtype,
			has_contents: !c.items.is_empty(),
		})
		.collect())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn container_add_item(
	map_id: u32,
	z: u8,
	x: u16,
	y: u16,
	stack_idx: u8,
	path: Vec<u32>,
	server_id: u16,
	map_state: tauri::State<MapState>,
) -> Result<(), String> {
	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let m = guard.maps.get_mut(&map_id).ok_or("map not loaded")?;
	let key = crate::formats::tibia::otbm::attrs_key(z, x, y, stack_idx);
	let mut root = m.container_contents.get(&key).cloned().unwrap_or_default();
	let list = nav_contents_mut(&mut root, &path).ok_or("container path not found")?;
	list.push(ContainedItem { server_id, subtype: 1, attrs: ItemAttrs::default(), items: Vec::new() });

	m.record_begin();
	m.set_container_contents(key, root);
	sync_has_contents(m, key, true);
	ensure_tile_edited(m, z, x, y);
	m.record_commit(ACTION_ATTRS);
	Ok(())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn container_remove_item(
	map_id: u32,
	z: u8,
	x: u16,
	y: u16,
	stack_idx: u8,
	path: Vec<u32>,
	child_idx: u8,
	map_state: tauri::State<MapState>,
) -> Result<(), String> {
	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let m = guard.maps.get_mut(&map_id).ok_or("map not loaded")?;
	let key = crate::formats::tibia::otbm::attrs_key(z, x, y, stack_idx);
	let mut root = m.container_contents.get(&key).cloned().unwrap_or_default();
	let list = nav_contents_mut(&mut root, &path).ok_or("container path not found")?;
	if (child_idx as usize) >= list.len() {
		return Ok(());
	}
	list.remove(child_idx as usize);

	m.record_begin();
	sync_has_contents(m, key, !root.is_empty());
	m.set_container_contents(key, root);
	ensure_tile_edited(m, z, x, y);
	m.record_commit(ACTION_ATTRS);
	Ok(())
}

#[tauri::command]
pub fn set_door_id(
	map_id: u32,
	z: u8,
	x: u16,
	y: u16,
	door_id: u8,
	map_state: tauri::State<MapState>,
) -> Result<(), String> {
	let mut guard = map_state.lock().map_err(|e| format!("Lock error: {}", e))?;
	let m = guard.maps.get_mut(&map_id).ok_or("map not loaded")?;
	m.record_begin();
	m.set_tile_door_id(z, x, y, door_id);
	m.record_commit(ACTION_ATTRS);
	Ok(())
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn history_evicts_oldest_and_round_trips_sidecar() {
		let mut m = empty_model(100, 100);
		m.push_sidecar_batch("a0".into(), "a1".into());
		m.push_sidecar_batch("b0".into(), "b1".into());
		m.push_sidecar_batch("c0".into(), "c1".into());

		m.set_history_limits(2, 1 << 30);

		let r1 = m.undo();
		assert!(r1.applied);
		assert_eq!(r1.sidecar, "c0");
		let r2 = m.undo();
		assert_eq!(r2.sidecar, "b0");
		let r3 = m.undo();
		assert!(!r3.applied, "oldest batch was evicted by the 2-step cap");

		let redo = m.redo();
		assert_eq!(redo.sidecar, "b1", "redo replays the after payload");
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
