use std::collections::{HashMap, HashSet};
use std::fs;

use crate::map_model::MapModel;
use crate::formats::tibia::otbm::{read_otbm, OtbmVisitor};
use crate::formats::tibia::otbm_footer::{ChunkEntry, MapIndex};

const CHUNK: u16 = 32;
use crate::formats::tibia::otbm_write::NodeWriter;
use crate::{MapState, MaterialsState};

const OTBM_MAP_DATA: u8 = 2;
const OTBM_TILE_AREA: u8 = 4;
const OTBM_TILE: u8 = 5;
const OTBM_ITEM: u8 = 6;
const OTBM_TOWNS: u8 = 12;
const OTBM_TOWN: u8 = 13;
const OTBM_HOUSETILE: u8 = 14;
const OTBM_ATTR_TILE_FLAGS: u8 = 3;
const OTBM_ATTR_ITEM: u8 = 9;
const OTBM_ATTR_HOUSEDOORID: u8 = 14;

const OTBM_ATTR_DESCRIPTION: u8 = 1;
const OTBM_ATTR_EXT_SPAWN_FILE: u8 = 11;
const OTBM_ATTR_EXT_HOUSE_FILE: u8 = 13;

const NODE_START: u8 = 0xFE;
const NODE_END: u8 = 0xFF;
const ESCAPE_CHAR: u8 = 0xFD;

struct EscReader<'a> {
	b: &'a [u8],
	pos: usize,
}

impl EscReader<'_> {
	fn peek(&self) -> Option<u8> {
		self.b.get(self.pos).copied()
	}
	fn u8(&mut self) -> u8 {
		let b = self.b[self.pos];
		self.pos += 1;
		if b == ESCAPE_CHAR {
			let v = self.b[self.pos];
			self.pos += 1;
			v
		} else {
			b
		}
	}
	fn u16(&mut self) -> u16 {
		u16::from_le_bytes([self.u8(), self.u8()])
	}
	fn u32(&mut self) -> u32 {
		u32::from_le_bytes([self.u8(), self.u8(), self.u8(), self.u8()])
	}
}

struct SaveScan {
	ident: (usize, usize),
	others: Vec<(usize, usize)>,
	tiles: Vec<(u8, u16, u16, usize, usize)>,
	flags: HashMap<(u8, u32), u32>,
	houses: HashMap<(u8, u32), u32>,
	teleports: Vec<u8>,
	teleport_count: u32,
	house_tile_count: u32,
	min_x: u16,
	min_y: u16,
	max_x: u16,
	max_y: u16,
}

impl Default for SaveScan {
	fn default() -> Self {
		SaveScan {
			ident: (0, 0),
			others: Vec::new(),
			tiles: Vec::new(),
			flags: HashMap::new(),
			houses: HashMap::new(),
			teleports: Vec::new(),
			teleport_count: 0,
			house_tile_count: 0,
			min_x: u16::MAX,
			min_y: u16::MAX,
			max_x: 0,
			max_y: 0,
		}
	}
}

impl OtbmVisitor for SaveScan {
	fn header(&mut self, _w: u16, _h: u16) {}
	fn progress(&mut self, _pos: usize, _total: usize) {}
	fn tile(&mut self, _x: u16, _y: u16, _z: u8, _items: &[(u16, u8)]) {}
	fn tile_flags(&mut self, x: u16, y: u16, z: u8, flags: u32) {
		self.flags.insert((z, pos_key(x, y)), flags);
	}
	fn house_tile(&mut self, x: u16, y: u16, z: u8, house_id: u32) {
		self.houses.insert((z, pos_key(x, y)), house_id);
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
	fn identifier(&mut self, start: usize, end: usize) {
		self.ident = (start, end);
	}
	fn tile_span(&mut self, x: u16, y: u16, z: u8, house: bool, start: usize, end: usize) {
		self.min_x = self.min_x.min(x);
		self.min_y = self.min_y.min(y);
		self.max_x = self.max_x.max(x);
		self.max_y = self.max_y.max(y);
		if house {
			self.house_tile_count += 1;
		}
		self.tiles.push((z, x, y, start, end));
	}
	fn other_child(&mut self, start: usize, end: usize) {
		self.others.push((start, end));
	}
}

enum EmitTile<'a> {
	Verbatim { x: u16, y: u16, start: usize, end: usize },
	VerbatimOverride { x: u16, y: u16, start: usize, end: usize, flags: Option<u32>, house: Option<u32>, door: Option<u8> },
	Fresh { x: u16, y: u16, stack: &'a [(u16, u16)], flags: u32, house: u32, door: u8 },
}

impl EmitTile<'_> {
	fn xy(&self) -> (u16, u16) {
		match *self {
			EmitTile::Verbatim { x, y, .. } => (x, y),
			EmitTile::VerbatimOverride { x, y, .. } => (x, y),
			EmitTile::Fresh { x, y, .. } => (x, y),
		}
	}
}

fn pos_key(x: u16, y: u16) -> u32 {
	((x as u32) << 16) | y as u32
}

fn flatten_edits(model: &MapModel) -> HashMap<u8, HashMap<u32, &Vec<(u16, u16)>>> {
	let mut out: HashMap<u8, HashMap<u32, &Vec<(u16, u16)>>> = HashMap::new();
	for (&z, chunks) in &model.edits {
		let floor = out.entry(z).or_default();
		for posmap in chunks.values() {
			for (&pos, stack) in posmap {
				floor.insert(pos, stack);
			}
		}
	}
	out
}

fn flatten_flag_edits(model: &MapModel) -> HashMap<u8, HashMap<u32, u32>> {
	let mut out: HashMap<u8, HashMap<u32, u32>> = HashMap::new();
	for (&z, chunks) in &model.flag_edits {
		let floor = out.entry(z).or_default();
		for posmap in chunks.values() {
			for (&pos, &flags) in posmap {
				floor.insert(pos, flags);
			}
		}
	}
	out
}

fn flatten_house_edits(model: &MapModel) -> HashMap<u8, HashMap<u32, u32>> {
	let mut out: HashMap<u8, HashMap<u32, u32>> = HashMap::new();
	for (&z, chunks) in &model.house_edits {
		let floor = out.entry(z).or_default();
		for posmap in chunks.values() {
			for (&pos, &house) in posmap {
				floor.insert(pos, house);
			}
		}
	}
	out
}

fn flatten_door_edits(model: &MapModel) -> HashMap<u8, HashMap<u32, u8>> {
	let mut out: HashMap<u8, HashMap<u32, u8>> = HashMap::new();
	for (&z, chunks) in &model.door_edits {
		let floor = out.entry(z).or_default();
		for posmap in chunks.values() {
			for (&pos, &door) in posmap {
				floor.insert(pos, door);
			}
		}
	}
	out
}

fn serialize_tile_fresh(w: &mut NodeWriter, x: u16, y: u16, stack: &[(u16, u16)], flags: u32, house: u32, door: u8, door_set: &HashSet<u16>) {
	w.node_start(if house != 0 { OTBM_HOUSETILE } else { OTBM_TILE });
	w.u8((x & 0xFF) as u8);
	w.u8((y & 0xFF) as u8);
	if house != 0 {
		w.u32(house);
	}
	if flags != 0 {
		w.u8(OTBM_ATTR_TILE_FLAGS);
		w.u32(flags);
	}
	let mut iter = stack.iter();
	if let Some(&(_, ground)) = iter.next() {
		w.u8(OTBM_ATTR_ITEM);
		w.u16(ground);
	}
	let mut door_left = door;
	for &(_, server) in iter {
		w.node_start(OTBM_ITEM);
		w.u16(server);
		if door_left != 0 && door_set.contains(&server) {
			w.u8(OTBM_ATTR_HOUSEDOORID);
			w.u8(door_left);
			door_left = 0;
		}
		w.node_end();
	}
	w.node_end();
}

fn scan_node_end(b: &[u8], start: usize) -> usize {
	let mut p = start;
	let mut depth = 0i32;
	while p < b.len() {
		match b[p] {
			ESCAPE_CHAR => p += 2,
			NODE_START => {
				depth += 1;
				p += 1;
			}
			NODE_END => {
				depth -= 1;
				p += 1;
				if depth == 0 {
					return p;
				}
			}
			_ => p += 1,
		}
	}
	b.len()
}

fn copy_children_inject_door(w: &mut NodeWriter, tail: &[u8], door_set: &HashSet<u16>, door_id: u8) {
	let mut pos = 0usize;
	let mut injected = false;
	while pos < tail.len() {
		match tail[pos] {
			NODE_END => {
				w.node_end();
				return;
			}
			NODE_START => {
				let ce = scan_node_end(tail, pos);
				let mut hr = EscReader { b: tail, pos: pos + 1 };
				let typ = hr.u8();
				if typ == OTBM_ITEM && !injected {
					let id = hr.u16();
					if door_set.contains(&id) {
						w.node_start(OTBM_ITEM);
						w.u16(id);
						w.u8(OTBM_ATTR_HOUSEDOORID);
						w.u8(door_id);
						w.raw_escaped(&tail[hr.pos..ce]);
						injected = true;
						pos = ce;
						continue;
					}
				}
				w.raw_escaped(&tail[pos..ce]);
				pos = ce;
			}
			_ => {
				w.raw_escaped(&tail[pos..]);
				return;
			}
		}
	}
}

fn emit_tile_override(w: &mut NodeWriter, span: &[u8], new_flags: Option<u32>, new_house: Option<u32>, new_door: Option<u8>, door_set: &HashSet<u16>) {
	let mut r = EscReader { b: span, pos: 2 };
	let dx = r.u8();
	let dy = r.u8();
	let src_house = if span[1] == OTBM_HOUSETILE { r.u32() } else { 0 };
	let house = new_house.unwrap_or(src_house);

	w.node_start(if house != 0 { OTBM_HOUSETILE } else { OTBM_TILE });
	w.u8(dx);
	w.u8(dy);
	if house != 0 {
		w.u32(house);
	}
	if let Some(f) = new_flags {
		if f != 0 {
			w.u8(OTBM_ATTR_TILE_FLAGS);
			w.u32(f);
		}
	}
	while let Some(b) = r.peek() {
		if b == NODE_START || b == NODE_END {
			break;
		}
		let attr = r.u8();
		if attr == OTBM_ATTR_TILE_FLAGS {
			let f = r.u32();
			if new_flags.is_none() {
				w.u8(OTBM_ATTR_TILE_FLAGS);
				w.u32(f);
			}
		} else if attr == OTBM_ATTR_ITEM {
			let id = r.u16();
			w.u8(OTBM_ATTR_ITEM);
			w.u16(id);
		} else {
			break;
		}
	}
	match new_door {
		Some(d) if d != 0 => copy_children_inject_door(w, &span[r.pos..], door_set, d),
		_ => w.raw_escaped(&span[r.pos..]),
	}
}

fn emit_floor(w: &mut NodeWriter, bytes: Option<&[u8]>, z: u8, mut list: Vec<EmitTile>, door_set: &HashSet<u16>) -> Vec<ChunkEntry> {
	list.sort_unstable_by_key(|t| {
		let (x, y) = t.xy();
		(y / CHUNK, x / CHUNK, y, x)
	});

	let mut out: Vec<ChunkEntry> = Vec::new();
	let mut cur: Option<(u16, u16)> = None;
	let mut start = 0u64;
	let mut count = 0u32;
	for item in &list {
		let (x, y) = item.xy();
		let chunk = (x / CHUNK, y / CHUNK);
		if cur != Some(chunk) {
			if let Some((cx, cy)) = cur {
				w.node_end();
				out.push(ChunkEntry { z, cx, cy, start, end: w.pos() as u64, count });
			}
			start = w.pos() as u64;
			w.node_start(OTBM_TILE_AREA);
			w.u16(x & 0xFF00);
			w.u16(y & 0xFF00);
			w.u8(z);
			cur = Some(chunk);
			count = 0;
		}
		match *item {
			EmitTile::Verbatim { start: s, end: e, .. } => {
				w.raw_escaped(&bytes.expect("verbatim tile requires source bytes")[s..e]);
			}
			EmitTile::VerbatimOverride { start: s, end: e, flags, house, door, .. } => {
				emit_tile_override(w, &bytes.expect("verbatim tile requires source bytes")[s..e], flags, house, door, door_set);
			}
			EmitTile::Fresh { x, y, stack, flags, house, door } => serialize_tile_fresh(w, x, y, stack, flags, house, door, door_set),
		}
		count += 1;
	}
	if let Some((cx, cy)) = cur {
		w.node_end();
		out.push(ChunkEntry { z, cx, cy, start, end: w.pos() as u64, count });
	}
	out
}

fn serialize_root(w: &mut NodeWriter, model: &MapModel) {
	w.u32(model.otbm_version);
	w.u16(model.width);
	w.u16(model.height);
	w.u32(model.items_major);
	w.u32(model.items_minor);
}

fn serialize_map_attrs(w: &mut NodeWriter, model: &MapModel) {
	if !model.description.is_empty() {
		w.u8(OTBM_ATTR_DESCRIPTION);
		w.string(&model.description);
	}
	if !model.spawn_file.is_empty() {
		w.u8(OTBM_ATTR_EXT_SPAWN_FILE);
		w.string(&model.spawn_file);
	}
	if !model.house_file.is_empty() {
		w.u8(OTBM_ATTR_EXT_HOUSE_FILE);
		w.string(&model.house_file);
	}
}

fn serialize_towns(w: &mut NodeWriter, model: &MapModel) {
	if model.towns.is_empty() {
		return;
	}
	w.node_start(OTBM_TOWNS);
	for t in &model.towns {
		w.node_start(OTBM_TOWN);
		w.u32(t.id);
		w.string(&t.name);
		w.u16(t.x);
		w.u16(t.y);
		w.u8(t.z);
		w.node_end();
	}
	w.node_end();
}

fn build_index(model: &MapModel, chunks: Vec<ChunkEntry>, min_x: u16, min_y: u16, max_x: u16, max_y: u16, house_tile_count: u32) -> MapIndex {
	MapIndex {
		chunks,
		min_x,
		min_y,
		max_x,
		max_y,
		teleports: model.teleports.clone(),
		teleport_count: model.teleport_count,
		description: model.description.clone(),
		spawn_file: model.spawn_file.clone(),
		house_file: model.house_file.clone(),
		otbm_version: model.otbm_version,
		items_major: model.items_major,
		items_minor: model.items_minor,
		towns: model.towns.clone(),
		house_tile_count,
	}
}

fn build_faithful(model: &MapModel, bytes: &[u8], door_set: &HashSet<u16>, report: &mut dyn FnMut(f64, &str)) -> Result<(Vec<u8>, MapIndex), String> {
	let mut scan = SaveScan::default();
	read_otbm(bytes, &mut scan)?;
	report(0.1, "Re-encoding tiles");

	let mut base: HashMap<u8, Vec<(u16, u16, usize, usize)>> = HashMap::new();
	for &(z, x, y, s, e) in &scan.tiles {
		base.entry(z).or_default().push((x, y, s, e));
	}
	let edits = flatten_edits(model);
	let flag_edits = flatten_flag_edits(model);
	let house_edits = flatten_house_edits(model);
	let door_edits = flatten_door_edits(model);

	let mut w = NodeWriter::with_capacity(bytes.len() + 4096);
	w.identifier(&bytes[scan.ident.0..scan.ident.1]);
	w.node_start(0);
	serialize_root(&mut w, model);
	w.node_start(OTBM_MAP_DATA);
	serialize_map_attrs(&mut w, model);

	let mut house_tile_count = 0u32;
	let mut chunks: Vec<ChunkEntry> = Vec::new();
	for z in 0u8..=15 {
		report(0.1 + 0.7 * (z as f64 / 16.0), "Re-encoding tiles");
		let empty_edits = HashMap::new();
		let zedits = edits.get(&z).unwrap_or(&empty_edits);
		let empty_flags = HashMap::new();
		let zflags = flag_edits.get(&z).unwrap_or(&empty_flags);
		let empty_houses = HashMap::new();
		let zhouses = house_edits.get(&z).unwrap_or(&empty_houses);
		let empty_doors = HashMap::new();
		let zdoors = door_edits.get(&z).unwrap_or(&empty_doors);
		let mut base_pos: HashSet<u32> = HashSet::new();
		let mut list: Vec<EmitTile> = Vec::new();
		if let Some(tiles) = base.get(&z) {
			for &(x, y, s, e) in tiles {
				let pos = pos_key(x, y);
				base_pos.insert(pos);
				if zedits.contains_key(&pos) {
					continue;
				}
				let flag_ov = zflags.get(&pos).copied();
				let house_ov = zhouses.get(&pos).copied();
				let door_ov = zdoors.get(&pos).copied();
				let final_house = house_ov.unwrap_or_else(|| scan.houses.get(&(z, pos)).copied().unwrap_or(0));
				if final_house != 0 {
					house_tile_count += 1;
				}
				if flag_ov.is_some() || house_ov.is_some() || door_ov.is_some() {
					list.push(EmitTile::VerbatimOverride { x, y, start: s, end: e, flags: flag_ov, house: house_ov, door: door_ov });
				} else {
					list.push(EmitTile::Verbatim { x, y, start: s, end: e });
				}
			}
		}
		for (&pos, &stack) in zedits {
			let flags = zflags.get(&pos).copied().unwrap_or_else(|| scan.flags.get(&(z, pos)).copied().unwrap_or(0));
			let house = zhouses.get(&pos).copied().unwrap_or_else(|| scan.houses.get(&(z, pos)).copied().unwrap_or(0));
			let door = zdoors.get(&pos).copied().unwrap_or(0);
			if !stack.is_empty() || flags != 0 || house != 0 {
				if house != 0 {
					house_tile_count += 1;
				}
				list.push(EmitTile::Fresh { x: (pos >> 16) as u16, y: (pos & 0xFFFF) as u16, stack, flags, house, door });
			}
		}
		for (&pos, &flags) in zflags {
			if base_pos.contains(&pos) || zedits.contains_key(&pos) {
				continue;
			}
			let house = zhouses.get(&pos).copied().unwrap_or(0);
			if flags != 0 || house != 0 {
				if house != 0 {
					house_tile_count += 1;
				}
				list.push(EmitTile::Fresh { x: (pos >> 16) as u16, y: (pos & 0xFFFF) as u16, stack: &[], flags, house, door: 0 });
			}
		}
		for (&pos, &house) in zhouses {
			if house != 0 && !base_pos.contains(&pos) && !zedits.contains_key(&pos) && !zflags.contains_key(&pos) {
				house_tile_count += 1;
				let flags = scan.flags.get(&(z, pos)).copied().unwrap_or(0);
				let door = zdoors.get(&pos).copied().unwrap_or(0);
				list.push(EmitTile::Fresh { x: (pos >> 16) as u16, y: (pos & 0xFFFF) as u16, stack: &[], flags, house, door });
			}
		}
		if list.is_empty() {
			continue;
		}
		chunks.extend(emit_floor(&mut w, Some(bytes), z, list, door_set));
	}

	serialize_towns(&mut w, model);
	for &(s, e) in &scan.others {
		w.raw_escaped(&bytes[s..e]);
	}
	w.node_end();
	w.node_end();

	let (min_x, min_y) = if scan.tiles.is_empty() { (0, 0) } else { (scan.min_x, scan.min_y) };
	let index = build_index(model, chunks, min_x, min_y, scan.max_x, scan.max_y, house_tile_count);
	Ok((w.into_bytes(), index))
}

fn build_from_model(model: &MapModel, door_set: &HashSet<u16>, report: &mut dyn FnMut(f64, &str)) -> Result<(Vec<u8>, MapIndex), String> {
	let edits = flatten_edits(model);
	let flag_edits = flatten_flag_edits(model);
	let house_edits = flatten_house_edits(model);
	let door_edits = flatten_door_edits(model);

	let mut w = NodeWriter::with_capacity(64 * 1024);
	w.identifier(&[0, 0, 0, 0]);
	w.node_start(0);
	serialize_root(&mut w, model);
	w.node_start(OTBM_MAP_DATA);
	serialize_map_attrs(&mut w, model);

	let mut house_tile_count = 0u32;
	let mut chunks: Vec<ChunkEntry> = Vec::new();
	for z in 0u8..=15 {
		report(0.1 + 0.7 * (z as f64 / 16.0), "Encoding tiles");
		let empty_edits = HashMap::new();
		let zedits = edits.get(&z).unwrap_or(&empty_edits);
		let empty_flags = HashMap::new();
		let zflags = flag_edits.get(&z).unwrap_or(&empty_flags);
		let empty_houses = HashMap::new();
		let zhouses = house_edits.get(&z).unwrap_or(&empty_houses);
		let empty_doors = HashMap::new();
		let zdoors = door_edits.get(&z).unwrap_or(&empty_doors);
		let mut base_pos: HashSet<u32> = HashSet::new();
		let mut stacks: Vec<(u16, u16, Vec<(u16, u16)>, u32, u32, u8)> = Vec::new();
		if let Some(floor) = model.floors.get(&z) {
			for &(start, end) in floor.values() {
				for t in start as usize..end as usize {
					let (x, y) = (model.tile_x[t], model.tile_y[t]);
					let pos = pos_key(x, y);
					base_pos.insert(pos);
					if zedits.contains_key(&pos) {
						continue;
					}
					let s = model.item_off[t] as usize;
					let e = model.item_off[t + 1] as usize;
					let stack: Vec<(u16, u16)> = (s..e).map(|j| (model.client_ids[j], model.server_ids[j])).collect();
					let flags = zflags.get(&pos).copied().unwrap_or(model.tile_flags[t]);
					let house = zhouses.get(&pos).copied().unwrap_or_else(|| model.house_ids.get(t).copied().unwrap_or(0));
					let door = zdoors.get(&pos).copied().unwrap_or_else(|| model.door_ids.get(t).copied().unwrap_or(0));
					stacks.push((x, y, stack, flags, house, door));
				}
			}
		}
		for (&pos, &stack) in zedits {
			let flags = zflags.get(&pos).copied().unwrap_or(0);
			let house = zhouses.get(&pos).copied().unwrap_or(0);
			let door = zdoors.get(&pos).copied().unwrap_or(0);
			if !stack.is_empty() || flags != 0 || house != 0 {
				stacks.push(((pos >> 16) as u16, (pos & 0xFFFF) as u16, stack.clone(), flags, house, door));
			}
		}
		for (&pos, &flags) in zflags {
			if base_pos.contains(&pos) || zedits.contains_key(&pos) {
				continue;
			}
			let house = zhouses.get(&pos).copied().unwrap_or(0);
			if flags != 0 || house != 0 {
				stacks.push(((pos >> 16) as u16, (pos & 0xFFFF) as u16, Vec::new(), flags, house, 0));
			}
		}
		for (&pos, &house) in zhouses {
			if house != 0 && !base_pos.contains(&pos) && !zedits.contains_key(&pos) && !zflags.contains_key(&pos) {
				let door = zdoors.get(&pos).copied().unwrap_or(0);
				stacks.push(((pos >> 16) as u16, (pos & 0xFFFF) as u16, Vec::new(), 0, house, door));
			}
		}
		if stacks.is_empty() {
			continue;
		}
		for (_, _, _, _, house, _) in &stacks {
			if *house != 0 {
				house_tile_count += 1;
			}
		}
		let list: Vec<EmitTile> = stacks
			.iter()
			.map(|(x, y, st, fl, hs, dr)| EmitTile::Fresh { x: *x, y: *y, stack: st, flags: *fl, house: *hs, door: *dr })
			.collect();
		chunks.extend(emit_floor(&mut w, None, z, list, door_set));
	}

	serialize_towns(&mut w, model);
	w.node_end();
	w.node_end();

	let index = build_index(model, chunks, model.min_x, model.min_y, model.max_x, model.max_y, house_tile_count);
	Ok((w.into_bytes(), index))
}

fn build_otbm_bytes(model: &MapModel, source: Option<&[u8]>, door_set: &HashSet<u16>, report: &mut dyn FnMut(f64, &str)) -> Result<(Vec<u8>, MapIndex), String> {
	match source {
		Some(bytes) => build_faithful(model, bytes, door_set, report),
		None => build_from_model(model, door_set, report),
	}
}

#[tauri::command]
pub async fn save_otbm(
	map_id: u32,
	path: String,
	window: tauri::Window,
	map_state: tauri::State<'_, MapState>,
	materials_state: tauri::State<'_, MaterialsState>,
) -> Result<(), String> {
	use tauri::Emitter;
	let store = map_state.inner().clone();
	let door_set: HashSet<u16> = materials_state
		.lock()
		.map_err(|e| format!("Lock error: {}", e))?
		.as_ref()
		.map(|m| m.door_ids.clone())
		.unwrap_or_default();
	tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
		let emit = |value: f64, label: &str| {
			let _ = window.emit("save_progress", (value, label.to_string()));
		};
		emit(0.02, "Preparing...");
		let mut guard = store.lock().map_err(|e| format!("Lock error: {}", e))?;
		let model = guard.maps.get_mut(&map_id).ok_or("map not loaded")?;

		let source = match &model.source_path {
			Some(p) => {
				emit(0.05, "Reading source...");
				fs::read(p).ok()
			}
			None => None,
		};

		let mut report = |value: f64, label: &str| emit(value, label);
		let (out, idx) = build_otbm_bytes(model, source.as_deref(), &door_set, &mut report)?;
		emit(0.92, "Writing file...");
		fs::write(&path, &out).map_err(|e| format!("Failed to write {}: {}", path, e))?;
		let sidecar = std::path::Path::new(&path).with_extension("otmi").to_string_lossy().to_string();
		fs::write(&sidecar, &idx.encode()).map_err(|e| format!("Failed to write {}: {}", sidecar, e))?;

		emit(0.97, "Indexing...");
		model.chunk_ranges = idx
			.chunks
			.iter()
			.map(|c| (crate::map_model::ckey(c.z, (c.cx as u32) << 16 | c.cy as u32), (c.start, c.end)))
			.collect();
		model.source_path = Some(std::path::PathBuf::from(&path));
		emit(1.0, "Done");
		Ok(())
	})
	.await
	.map_err(|e| format!("save task error: {}", e))?
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::map_model::{build_map_model, empty_model};
	use std::collections::HashMap as Map;

	#[derive(Default)]
	struct Cmp {
		tiles: Map<(u16, u16, u8), Vec<u16>>,
	}

	impl OtbmVisitor for Cmp {
		fn header(&mut self, _w: u16, _h: u16) {}
		fn progress(&mut self, _p: usize, _t: usize) {}
		fn teleport(&mut self, _sx: u16, _sy: u16, _sz: u8, _dx: u16, _dy: u16, _dz: u8) {}
		fn tile(&mut self, x: u16, y: u16, z: u8, items: &[(u16, u8)]) {
			self.tiles.insert((x, y, z), items.iter().map(|&(id, _)| id).collect());
		}
	}

	fn parse_tiles(bytes: &[u8]) -> Map<(u16, u16, u8), Vec<u16>> {
		let mut c = Cmp::default();
		read_otbm(bytes, &mut c).unwrap();
		c.tiles
	}

	#[derive(Default)]
	struct FlagCmp {
		flags: Map<(u16, u16, u8), u32>,
		items: Map<(u16, u16, u8), Vec<u16>>,
	}

	impl OtbmVisitor for FlagCmp {
		fn header(&mut self, _w: u16, _h: u16) {}
		fn progress(&mut self, _p: usize, _t: usize) {}
		fn teleport(&mut self, _sx: u16, _sy: u16, _sz: u8, _dx: u16, _dy: u16, _dz: u8) {}
		fn tile(&mut self, x: u16, y: u16, z: u8, items: &[(u16, u8)]) {
			self.items.insert((x, y, z), items.iter().map(|&(id, _)| id).collect());
		}
		fn tile_flags(&mut self, x: u16, y: u16, z: u8, flags: u32) {
			self.flags.insert((x, y, z), flags);
		}
	}

	fn set_flag(model: &mut MapModel, z: u8, x: u16, y: u16, flags: u32) {
		let pos = (x as u32) << 16 | y as u32;
		let ck = crate::map_model::chunk_key_of(x, y);
		model.flag_edits.entry(z).or_default().entry(ck).or_default().insert(pos, flags);
	}

	#[derive(Default)]
	struct HouseCmp {
		houses: Map<(u16, u16, u8), u32>,
		doors: Map<(u16, u16, u8), u8>,
	}

	impl OtbmVisitor for HouseCmp {
		fn header(&mut self, _w: u16, _h: u16) {}
		fn progress(&mut self, _p: usize, _t: usize) {}
		fn teleport(&mut self, _sx: u16, _sy: u16, _sz: u8, _dx: u16, _dy: u16, _dz: u8) {}
		fn tile(&mut self, _x: u16, _y: u16, _z: u8, _items: &[(u16, u8)]) {}
		fn house_tile(&mut self, x: u16, y: u16, z: u8, house_id: u32) {
			self.houses.insert((x, y, z), house_id);
		}
		fn tile_door(&mut self, x: u16, y: u16, z: u8, door_id: u8) {
			self.doors.insert((x, y, z), door_id);
		}
	}

	fn read_houses(bytes: &[u8]) -> Map<(u16, u16, u8), u32> {
		let mut c = HouseCmp::default();
		read_otbm(bytes, &mut c).unwrap();
		c.houses
	}

	fn read_doors(bytes: &[u8]) -> Map<(u16, u16, u8), u8> {
		let mut c = HouseCmp::default();
		read_otbm(bytes, &mut c).unwrap();
		c.doors
	}

	#[test]
	fn inject_door_id_into_item_node() {
		let tail = [0xFEu8, OTBM_ITEM, 0xD2, 0x04, 0xFF, 0xFF];
		let mut door_set = HashSet::new();
		door_set.insert(0x04D2u16);
		let mut w = NodeWriter::with_capacity(16);
		copy_children_inject_door(&mut w, &tail, &door_set, 5);
		let out = w.into_bytes();
		assert_eq!(out, vec![0xFE, OTBM_ITEM, 0xD2, 0x04, OTBM_ATTR_HOUSEDOORID, 5, 0xFF, 0xFF]);
	}

	#[test]
	fn fresh_house_tile_emits_door_id() {
		let mut model = build_map_model(50, 50, &[10], &[10], &[7], &[0], &[2], &[1, 2], &[100, 1234], &[1, 1], &[], &[], &[], Vec::new(), 0);
		let pos = (10u32) << 16 | 10u32;
		let ck = crate::map_model::chunk_key_of(10, 10);
		model.house_edits.entry(7).or_default().entry(ck).or_default().insert(pos, 9);
		model.door_edits.entry(7).or_default().entry(ck).or_default().insert(pos, 3);
		let mut door_set = HashSet::new();
		door_set.insert(1234u16);

		let (out, _) = build_from_model(&model, &door_set, &mut |_, _| {}).unwrap();
		assert_eq!(read_houses(&out).get(&(10, 10, 7)), Some(&9));
		assert_eq!(read_doors(&out).get(&(10, 10, 7)), Some(&3), "door item on the house tile carries its door id");
	}

	#[test]
	fn from_model_emits_house_tile() {
		let mut model = build_map_model(50, 50, &[10], &[10], &[7], &[0], &[1], &[1], &[100], &[1], &[], &[], &[], Vec::new(), 0);
		let pos = (10u32) << 16 | 10u32;
		let ck = crate::map_model::chunk_key_of(10, 10);
		model.house_edits.entry(7).or_default().entry(ck).or_default().insert(pos, 42);

		let (out, _) = build_from_model(&model, &HashSet::new(), &mut |_, _| {}).unwrap();
		assert_eq!(read_houses(&out).get(&(10, 10, 7)), Some(&42), "fresh house tile carries its house id");
		assert_eq!(parse_tiles(&out).get(&(10, 10, 7)), Some(&vec![100]), "ground preserved on a house tile");
	}

	#[test]
	fn faithful_save_assigns_and_clears_house_id() {
		let bytes = std::fs::read("../data/860/forgotten.otbm").unwrap();
		let before = parse_tiles(&bytes);
		let mut keys: Vec<(u16, u16, u8)> = before.keys().copied().collect();
		keys.sort_unstable();
		let (x, y, z) = keys[0];

		let mut model = empty_model(0, 0);
		let pos = (x as u32) << 16 | y as u32;
		let ck = crate::map_model::chunk_key_of(x, y);
		model.house_edits.entry(z).or_default().entry(ck).or_default().insert(pos, 7);

		let (out, _) = build_faithful(&model, &bytes, &HashSet::new(), &mut |_, _| {}).unwrap();
		assert_eq!(parse_tiles(&out), before, "item stacks preserved when a house id is spliced in");
		assert_eq!(read_houses(&out).get(&(x, y, z)), Some(&7), "house id spliced onto the verbatim tile");
	}

	#[test]
	fn from_model_writes_tile_flags() {
		let mut model = build_map_model(
			50,
			50,
			&[10],
			&[10],
			&[7],
			&[0],
			&[1],
			&[1],
			&[100],
			&[1],
			&[],
			&[],
			&[],
			Vec::new(),
			0,
		);
		set_flag(&mut model, 7, 10, 10, 0x01);

		let (out, _) = build_from_model(&model, &HashSet::new(), &mut |_, _| {}).unwrap();
		let mut cmp = FlagCmp::default();
		read_otbm(&out, &mut cmp).unwrap();
		assert_eq!(cmp.flags.get(&(10, 10, 7)), Some(&0x01), "tile flags written");
		assert_eq!(cmp.items.get(&(10, 10, 7)), Some(&vec![100]), "ground preserved alongside flags");
	}

	#[test]
	fn faithful_save_splices_flags_and_keeps_items() {
		let bytes = std::fs::read("../data/860/forgotten.otbm").unwrap();
		let before = parse_tiles(&bytes);
		let mut keys: Vec<(u16, u16, u8)> = before.keys().copied().collect();
		keys.sort_unstable();
		let (x, y, z) = keys[0];

		let mut model = empty_model(0, 0);
		set_flag(&mut model, z, x, y, 0x01);

		let (out, _) = build_faithful(&model, &bytes, &HashSet::new(), &mut |_, _| {}).unwrap();
		let after = parse_tiles(&out);
		assert_eq!(before, after, "every tile's item stack is preserved when a zone flag is spliced in");

		let mut cmp = FlagCmp::default();
		read_otbm(&out, &mut cmp).unwrap();
		assert_eq!(cmp.flags.get(&(x, y, z)), Some(&0x01), "flag spliced onto the verbatim tile");
	}

	fn idx_to_table(idx: &MapIndex) -> Vec<(u8, u64, u64, u32)> {
		idx.chunks.iter().map(|c| (c.z, c.start, c.end, c.count)).collect()
	}

	#[test]
	fn faithful_roundtrip_preserves_every_tile() {
		let bytes = std::fs::read("../data/860/forgotten.otbm").unwrap();
		let before = parse_tiles(&bytes);

		let model = empty_model(0, 0);
		let (out, _) = build_faithful(&model, &bytes, &HashSet::new(), &mut |_, _| {}).unwrap();
		let after = parse_tiles(&out);

		assert_eq!(before.len(), after.len(), "tile count unchanged");
		assert_eq!(before, after, "every tile's item stack is byte-identical after save");
	}

	#[test]
	fn footer_chunk_offsets_point_at_tile_areas() {
		let bytes = std::fs::read("../data/860/forgotten.otbm").unwrap();
		let (out, idx) = build_faithful(&empty_model(0, 0), &bytes, &HashSet::new(), &mut |_, _| {}).unwrap();
		let table = idx_to_table(&idx);
		assert!(!table.is_empty(), "at least one chunk indexed");
		for (_z, start, end, count) in table {
			assert!(start < end && (end as usize) <= out.len(), "chunk range in bounds");
			assert!(count > 0, "indexed chunk has tiles");
			assert_eq!(out[start as usize], 0xFE, "chunk offset is a node start");
			assert_eq!(out[start as usize + 1], OTBM_TILE_AREA, "chunk offset opens a tile area");
		}
	}

	#[test]
	fn chunk_ranges_partition_every_tile() {
		let bytes = std::fs::read("../data/860/forgotten.otbm").unwrap();
		let (out, idx) = build_faithful(&empty_model(0, 0), &bytes, &HashSet::new(), &mut |_, _| {}).unwrap();
		let all = parse_tiles(&out);

		let mut union: Map<(u16, u16, u8), Vec<u16>> = Map::new();
		let mut counted = 0u32;
		for c in &idx.chunks {
			let mut sink = Cmp::default();
			crate::formats::tibia::otbm::read_otbm_floor(&out[c.start as usize..c.end as usize], &mut sink).unwrap();
			for (&(x, y, z), _) in &sink.tiles {
				assert_eq!(z, c.z, "tile carries the chunk's z");
				assert_eq!((x / 32, y / 32), (c.cx, c.cy), "tile lies inside the indexed chunk");
			}
			counted += sink.tiles.len() as u32;
			assert_eq!(sink.tiles.len() as u32, c.count, "footer count matches tiles in the chunk");
			union.extend(sink.tiles);
		}
		assert_eq!(union, all, "parsing each chunk range independently reconstructs the whole map");
		assert_eq!(counted, all.len() as u32);
	}

	#[test]
	fn lazy_ensure_floor_loads_columns_from_disk() {
		use crate::map_model::{empty_model as em, lazy_model};
		use crate::formats::tibia::otb::parse_otb;
		let _ = em;

		let otb = parse_otb(&std::fs::read("../data/860/items.otb").unwrap()).unwrap();
		let src = std::fs::read("../data/860/forgotten.otbm").unwrap();
		let (out, idx) = build_faithful(&empty_model(0, 0), &src, &HashSet::new(), &mut |_, _| {}).unwrap();

		let tmp = std::env::temp_dir().join("nosbor_lazy_ensure_test.otbm");
		std::fs::write(&tmp, &out).unwrap();

		let (w, h) = crate::formats::tibia::otbm::read_otbm_header(&out).unwrap();
		let mut model = lazy_model(w, h, &idx, tmp.clone());

		assert!(model.floors.is_empty(), "no floor loaded at lazy open");
		assert!(model.tile_x.is_empty());
		assert!(model.total_tiles > 0, "tile count known up front from footer");

		let z0 = model.available_floors[0];
		model.ensure_floor(z0, &otb).unwrap();
		assert!(model.floors.contains_key(&z0), "floor loaded on demand");
		let after_first = model.tile_x.len();
		assert!(after_first > 0);

		model.ensure_floor(z0, &otb).unwrap();
		assert_eq!(model.tile_x.len(), after_first, "re-ensuring a floor is idempotent");

		for &z in &model.available_floors.clone() {
			model.ensure_floor(z, &otb).unwrap();
		}
		assert_eq!(model.floors.len(), model.available_floors.len(), "all floors loadable");

		let _ = std::fs::remove_file(&tmp);
	}

	#[derive(Default)]
	struct MetaCmp {
		description: String,
		spawn_file: String,
		house_file: String,
		otbm_version: u32,
		towns: Vec<(u32, String, u16, u16, u8)>,
	}

	impl OtbmVisitor for MetaCmp {
		fn header(&mut self, _w: u16, _h: u16) {}
		fn progress(&mut self, _p: usize, _t: usize) {}
		fn teleport(&mut self, _sx: u16, _sy: u16, _sz: u8, _dx: u16, _dy: u16, _dz: u8) {}
		fn tile(&mut self, _x: u16, _y: u16, _z: u8, _items: &[(u16, u8)]) {}
		fn map_version(&mut self, otbm: u32, _major: u32, _minor: u32) {
			self.otbm_version = otbm;
		}
		fn map_description(&mut self, text: String) {
			self.description = text;
		}
		fn spawn_file(&mut self, name: String) {
			self.spawn_file = name;
		}
		fn house_file(&mut self, name: String) {
			self.house_file = name;
		}
		fn town(&mut self, id: u32, name: String, x: u16, y: u16, z: u8) {
			self.towns.push((id, name, x, y, z));
		}
	}

	#[test]
	fn from_model_roundtrips_metadata_and_towns() {
		use crate::map_model::Town;
		let mut model = empty_model(100, 100);
		model.description = "My Map".to_string();
		model.spawn_file = "spawn.xml".to_string();
		model.house_file = "house.xml".to_string();
		model.otbm_version = 2;
		model.towns = vec![
			Town { id: 1, name: "Thais".to_string(), x: 32100, y: 32200, z: 7 },
			Town { id: 2, name: "Carlin".to_string(), x: 32300, y: 31900, z: 6 },
		];

		let (out, idx) = build_from_model(&model, &HashSet::new(), &mut |_, _| {}).unwrap();
		let mut meta = MetaCmp::default();
		read_otbm(&out, &mut meta).unwrap();

		assert_eq!(meta.description, "My Map");
		assert_eq!(meta.spawn_file, "spawn.xml");
		assert_eq!(meta.house_file, "house.xml");
		assert_eq!(meta.otbm_version, 2);
		assert_eq!(meta.towns.len(), 2);
		assert_eq!(meta.towns[0], (1, "Thais".to_string(), 32100, 32200, 7));
		assert_eq!(meta.towns[1], (2, "Carlin".to_string(), 32300, 31900, 6));

		assert_eq!(idx.towns.len(), 2);
		assert_eq!(idx.description, "My Map");
	}

	#[test]
	fn from_model_roundtrips_a_synthetic_map() {
		let xs = vec![10u16, 11, 5];
		let ys = vec![10u16, 10, 5];
		let zs = vec![7u8, 7, 6];
		let item_start = vec![0u32, 3, 4];
		let item_count = vec![3u16, 1, 1];
		let client_ids = vec![1u16, 2, 3, 4, 5];
		let server_ids = vec![100u16, 200, 300, 400, 500];
		let subtypes = vec![1u8; client_ids.len()];
		let model = build_map_model(50, 50, &xs, &ys, &zs, &item_start, &item_count, &client_ids, &server_ids, &subtypes, &[], &[], &[], Vec::new(), 0);

		let (out, idx) = build_from_model(&model, &HashSet::new(), &mut |_, _| {}).unwrap();
		let tiles = parse_tiles(&out);

		assert_eq!(tiles.get(&(10, 10, 7)), Some(&vec![100, 200, 300]));
		assert_eq!(tiles.get(&(11, 10, 7)), Some(&vec![400]));
		assert_eq!(tiles.get(&(5, 5, 6)), Some(&vec![500]));

		let table = idx_to_table(&idx);
		let floors: Vec<u8> = table.iter().map(|t| t.0).collect();
		assert!(floors.contains(&6) && floors.contains(&7), "both floors indexed");
	}

	#[test]
	fn window_minimap_reads_window_tiles() {
		let xs = vec![10u16, 11, 5];
		let ys = vec![10u16, 10, 40];
		let zs = vec![7u8, 7, 7];
		let item_start = vec![0u32, 1, 2];
		let item_count = vec![1u16, 1, 1];
		let client_ids = vec![2u16, 3, 4];
		let server_ids = vec![200u16, 300, 400];
		let subtypes = vec![1u8; client_ids.len()];
		let mut model =
			build_map_model(50, 50, &xs, &ys, &zs, &item_start, &item_count, &client_ids, &server_ids, &subtypes, &[], &[], &[], Vec::new(), 0);

		let mut palette = vec![0u8; 16];
		palette[2] = 50;
		palette[3] = 60;
		palette[4] = 70;

		let otb = crate::formats::tibia::otb::OtbItems { server_to_client: Map::new() };
		let payload = model.window_minimap(7, 10, 10, 2, 1, &palette, &otb).unwrap();
		assert_eq!(u16::from_le_bytes([payload[0], payload[1]]), 10);
		assert_eq!(u16::from_le_bytes([payload[4], payload[5]]), 2);
		assert_eq!(u16::from_le_bytes([payload[6], payload[7]]), 1);
		assert_eq!(&payload[8..10], &[50, 60], "tiles 10,10 and 11,10 inside window, tile 5,40 excluded");
	}
}
