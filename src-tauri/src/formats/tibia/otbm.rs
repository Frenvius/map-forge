const OTBM_MAP_DATA: u8 = 2;
const OTBM_TILE_AREA: u8 = 4;
const OTBM_TILE: u8 = 5;
const OTBM_ITEM: u8 = 6;
const OTBM_TOWNS: u8 = 12;
const OTBM_TOWN: u8 = 13;
const OTBM_HOUSETILE: u8 = 14;
const OTBM_WAYPOINTS: u8 = 15;
const OTBM_WAYPOINT: u8 = 16;

const NODE_START: u8 = 0xFE;
const NODE_END: u8 = 0xFF;
const ESCAPE_CHAR: u8 = 0xFD;

const OTBM_ATTR_TILE_FLAGS: u8 = 3;
const OTBM_ATTR_ITEM: u8 = 9;

const OTBM_ATTR_EXT_SPAWN_FILE: u8 = 11;
const OTBM_ATTR_EXT_HOUSE_FILE: u8 = 13;

const OTBM_ATTR_DESCRIPTION: u8 = 1;
const OTBM_ATTR_ACTION_ID: u8 = 4;
const OTBM_ATTR_UNIQUE_ID: u8 = 5;
const OTBM_ATTR_TEXT: u8 = 6;
const OTBM_ATTR_DESC: u8 = 7;
const OTBM_ATTR_TELE_DEST: u8 = 8;
const OTBM_ATTR_DEPOT_ID: u8 = 10;
const OTBM_ATTR_RUNE_CHARGES: u8 = 12;
const OTBM_ATTR_HOUSEDOORID: u8 = 14;
const OTBM_ATTR_COUNT: u8 = 15;
const OTBM_ATTR_CHARGES: u8 = 22;
const OTBM_ATTR_TIER: u8 = 41;

#[derive(Default, Clone, PartialEq)]
pub struct ItemAttrs {
	pub action_id: u16,
	pub unique_id: u16,
	pub text: String,
	pub desc: String,
	pub charges: u16,
	pub tier: u8,
	pub depot_id: u16,
	pub subtype: u8,
	pub has_contents: bool,
	pub tele_x: u16,
	pub tele_y: u16,
	pub tele_z: u8,
}

impl ItemAttrs {
	pub fn is_default(&self) -> bool {
		self.action_id == 0
			&& self.unique_id == 0
			&& self.text.is_empty()
			&& self.desc.is_empty()
			&& self.charges == 0
			&& self.tier == 0
			&& self.depot_id == 0
			&& self.subtype == 0
			&& !self.has_contents
			&& self.tele_x == 0
			&& self.tele_y == 0
			&& self.tele_z == 0
	}

	pub fn has_tele(&self) -> bool {
		self.tele_x != 0 || self.tele_y != 0 || self.tele_z != 0
	}
}

#[derive(Default, Clone, PartialEq)]
pub struct ContainedItem {
	pub server_id: u16,
	pub subtype: u8,
	pub attrs: ItemAttrs,
	pub items: Vec<ContainedItem>,
}

pub fn attrs_key(z: u8, x: u16, y: u16, idx: u8) -> u64 {
	((z as u64) << 40) | ((x as u64) << 24) | ((y as u64) << 8) | (idx as u64)
}

pub trait OtbmVisitor {
	fn header(&mut self, width: u16, height: u16);
	fn progress(&mut self, pos: usize, total: usize);
	fn tile(&mut self, x: u16, y: u16, z: u8, items: &[(u16, u8)]);
	fn tile_flags(&mut self, _x: u16, _y: u16, _z: u8, _flags: u32) {}
	fn tile_item_attrs(&mut self, _x: u16, _y: u16, _z: u8, _stack_idx: u8, _attrs: ItemAttrs) {}
	fn tile_item_contents(&mut self, _x: u16, _y: u16, _z: u8, _stack_idx: u8, _contents: Vec<ContainedItem>) {}
	fn teleport(&mut self, sx: u16, sy: u16, sz: u8, dx: u16, dy: u16, dz: u8);

	fn identifier(&mut self, _start: usize, _end: usize) {}
	fn root_payload(&mut self, _start: usize, _end: usize) {}
	fn map_attrs(&mut self, _start: usize, _end: usize) {}
	fn tile_span(&mut self, _x: u16, _y: u16, _z: u8, _house: bool, _start: usize, _end: usize) {}
	fn other_child(&mut self, _start: usize, _end: usize) {}

	fn map_version(&mut self, _otbm: u32, _items_major: u32, _items_minor: u32) {}
	fn map_description(&mut self, _text: String) {}
	fn spawn_file(&mut self, _name: String) {}
	fn house_file(&mut self, _name: String) {}
	fn house_tile(&mut self, _x: u16, _y: u16, _z: u8, _house_id: u32) {}
	fn tile_door(&mut self, _x: u16, _y: u16, _z: u8, _door_id: u8) {}
	fn town(&mut self, _id: u32, _name: String, _x: u16, _y: u16, _z: u8) {}
	fn waypoint(&mut self, _name: String, _x: u16, _y: u16, _z: u8) {}
}

struct Reader<'a> {
	b: &'a [u8],
	pos: usize,
}

impl<'a> Reader<'a> {
	fn peek(&self) -> Option<u8> {
		self.b.get(self.pos).copied()
	}

	fn data_u8(&mut self) -> Option<u8> {
		let b = *self.b.get(self.pos)?;
		if b == NODE_START || b == NODE_END {
			return None;
		}
		self.pos += 1;
		if b == ESCAPE_CHAR {
			let lit = *self.b.get(self.pos)?;
			self.pos += 1;
			Some(lit)
		} else {
			Some(b)
		}
	}

	fn data_u16(&mut self) -> Option<u16> {
		Some(u16::from_le_bytes([self.data_u8()?, self.data_u8()?]))
	}

	fn data_u32(&mut self) -> Option<u32> {
		Some(u32::from_le_bytes([self.data_u8()?, self.data_u8()?, self.data_u8()?, self.data_u8()?]))
	}

	fn data_string(&mut self) -> Option<String> {
		let len = self.data_u16()? as usize;
		let mut bytes = Vec::with_capacity(len);
		for _ in 0..len {
			bytes.push(self.data_u8()?);
		}
		Some(String::from_utf8_lossy(&bytes).into_owned())
	}

	fn skip_data(&mut self, n: usize) -> bool {
		for _ in 0..n {
			if self.data_u8().is_none() {
				return false;
			}
		}
		true
	}

	fn skip_to_structural(&mut self) {
		while let Some(b) = self.peek() {
			if b == NODE_START || b == NODE_END {
				break;
			}
			self.pos += 1;
			if b == ESCAPE_CHAR {
				self.pos += 1;
			}
		}
	}
}

struct Parser<'a, V: OtbmVisitor> {
	r: Reader<'a>,
	v: &'a mut V,
	total: usize,
	scratch: Vec<(u16, u8)>,
	cur_door: u8,
}

impl<'a, V: OtbmVisitor> Parser<'a, V> {
	fn run(&mut self) -> Result<(), String> {
		if self.r.b.len() < 6 {
			return Err("otbm: file too small to be a node-tree".into());
		}
		self.v.identifier(0, 4);
		self.r.pos = 4;
		if self.r.peek() != Some(NODE_START) {
			return Err("otbm: missing root node start byte".into());
		}
		self.r.pos += 1;

		self.r.data_u8().ok_or("otbm: missing root type")?;
		let rp_start = self.r.pos;
		let otbm_version = self.r.data_u32().ok_or("otbm: missing version")?;
		let width = self.r.data_u16().ok_or("otbm: missing width")?;
		let height = self.r.data_u16().ok_or("otbm: missing height")?;
		let items_major = self.r.data_u32().unwrap_or(0);
		let items_minor = self.r.data_u32().unwrap_or(0);
		self.v.header(width, height);
		self.v.map_version(otbm_version, items_major, items_minor);
		self.r.skip_to_structural();
		self.v.root_payload(rp_start, self.r.pos);

		self.each_child(|p| {
			let kind = p.r.data_u8().ok_or("otbm: missing node type")?;
			if kind == OTBM_MAP_DATA {
				p.map_data()
			} else {
				p.skip_subtree()
			}
		})
	}

	fn map_data(&mut self) -> Result<(), String> {
		let attrs_start = self.r.pos;
		while let Some(attr) = self.r.data_u8() {
			let ok = match attr {
				OTBM_ATTR_DESCRIPTION => match self.r.data_string() {
					Some(s) => {
						self.v.map_description(s);
						true
					}
					None => false,
				},
				OTBM_ATTR_EXT_SPAWN_FILE => match self.r.data_string() {
					Some(s) => {
						self.v.spawn_file(s);
						true
					}
					None => false,
				},
				OTBM_ATTR_EXT_HOUSE_FILE => match self.r.data_string() {
					Some(s) => {
						self.v.house_file(s);
						true
					}
					None => false,
				},
				_ => false,
			};
			if !ok {
				break;
			}
		}
		self.r.skip_to_structural();
		self.v.map_attrs(attrs_start, self.r.pos);
		self.each_child(|p| {
			let node_start = p.r.pos - 1;
			let kind = p.r.data_u8().ok_or("otbm: missing node type")?;
			if kind == OTBM_TILE_AREA {
				p.tile_area()
			} else if kind == OTBM_TOWNS {
				p.towns()
			} else if kind == OTBM_WAYPOINTS {
				p.waypoints()
			} else {
				p.skip_subtree()?;
				p.v.other_child(node_start, p.r.pos);
				Ok(())
			}
		})
	}

	fn towns(&mut self) -> Result<(), String> {
		self.r.skip_to_structural();
		self.each_child(|p| {
			let kind = p.r.data_u8().ok_or("otbm: missing node type")?;
			if kind == OTBM_TOWN {
				let id = p.r.data_u32().ok_or("otbm: town missing id")?;
				let name = p.r.data_string().ok_or("otbm: town missing name")?;
				let x = p.r.data_u16().ok_or("otbm: town missing temple x")?;
				let y = p.r.data_u16().ok_or("otbm: town missing temple y")?;
				let z = p.r.data_u8().ok_or("otbm: town missing temple z")?;
				p.v.town(id, name, x, y, z);
			}
			p.skip_subtree()
		})
	}

	fn waypoints(&mut self) -> Result<(), String> {
		self.r.skip_to_structural();
		self.each_child(|p| {
			let kind = p.r.data_u8().ok_or("otbm: missing node type")?;
			if kind == OTBM_WAYPOINT {
				let name = p.r.data_string().ok_or("otbm: waypoint missing name")?;
				let x = p.r.data_u16().ok_or("otbm: waypoint missing x")?;
				let y = p.r.data_u16().ok_or("otbm: waypoint missing y")?;
				let z = p.r.data_u8().ok_or("otbm: waypoint missing z")?;
				p.v.waypoint(name, x, y, z);
			}
			p.skip_subtree()
		})
	}

	fn tile_area(&mut self) -> Result<(), String> {
		let base_x = self.r.data_u16().ok_or("otbm: tile area missing base x")?;
		let base_y = self.r.data_u16().ok_or("otbm: tile area missing base y")?;
		let base_z = self.r.data_u8().ok_or("otbm: tile area missing base z")?;
		self.r.skip_to_structural();
		self.v.progress(self.r.pos, self.total);
		self.each_child(|p| {
			let node_start = p.r.pos - 1;
			let kind = p.r.data_u8().ok_or("otbm: missing node type")?;
			if kind == OTBM_TILE || kind == OTBM_HOUSETILE {
				let house = kind == OTBM_HOUSETILE;
				let (x, y, z, house_id) = p.tile(house, base_x, base_y, base_z)?;
				p.v.tile_span(x, y, z, house, node_start, p.r.pos);
				if house {
					p.v.house_tile(x, y, z, house_id);
				}
				Ok(())
			} else {
				p.skip_subtree()
			}
		})
	}

	fn tile(&mut self, house: bool, base_x: u16, base_y: u16, base_z: u8) -> Result<(u16, u16, u8, u32), String> {
		let dx = self.r.data_u8().ok_or("otbm: tile missing dx")?;
		let dy = self.r.data_u8().ok_or("otbm: tile missing dy")?;
		let house_id = if house { self.r.data_u32().unwrap_or(0) } else { 0 };
		let tile_x = base_x.wrapping_add(dx as u16);
		let tile_y = base_y.wrapping_add(dy as u16);
		self.scratch.clear();
		self.cur_door = 0;
		let mut flags = 0u32;

		while let Some(attr) = self.r.data_u8() {
			match attr {
				OTBM_ATTR_TILE_FLAGS => match self.r.data_u32() {
					Some(f) => flags = f,
					None => break,
				},
				OTBM_ATTR_ITEM => match self.r.data_u16() {
					Some(id) => self.scratch.push((id, 1)),
					None => break,
				},
				_ => break,
			}
		}
		self.r.skip_to_structural();

		self.each_child(|p| {
			let kind = p.r.data_u8().ok_or("otbm: missing node type")?;
			if kind == OTBM_ITEM {
				p.tile_item(tile_x, tile_y, base_z)
			} else {
				p.skip_subtree()
			}
		})?;

		let items = std::mem::take(&mut self.scratch);
		self.v.tile(tile_x, tile_y, base_z, &items);
		self.scratch = items;
		if flags != 0 {
			self.v.tile_flags(tile_x, tile_y, base_z, flags);
		}
		if self.cur_door != 0 {
			self.v.tile_door(tile_x, tile_y, base_z, self.cur_door);
		}
		Ok((tile_x, tile_y, base_z, house_id))
	}

	fn tile_item(&mut self, tile_x: u16, tile_y: u16, base_z: u8) -> Result<(), String> {
		let id = self.r.data_u16().ok_or("otbm: item missing id")?;
		let item_idx = self.scratch.len();
		self.scratch.push((id, 1));

		let mut ia = ItemAttrs::default();

		while let Some(attr) = self.r.data_u8() {
			let ok = match attr {
				OTBM_ATTR_COUNT => match self.r.data_u8() {
					Some(c) => {
						self.scratch[item_idx].1 = c.max(1);
						true
					}
					None => false,
				},
				OTBM_ATTR_HOUSEDOORID => match self.r.data_u8() {
					Some(d) => {
						self.cur_door = d;
						true
					}
					None => false,
				},
				OTBM_ATTR_ACTION_ID => match self.r.data_u16() {
					Some(v) => {
						ia.action_id = v;
						true
					}
					None => false,
				},
				OTBM_ATTR_UNIQUE_ID => match self.r.data_u16() {
					Some(v) => {
						ia.unique_id = v;
						true
					}
					None => false,
				},
				OTBM_ATTR_CHARGES => match self.r.data_u16() {
					Some(v) => {
						ia.charges = v;
						true
					}
					None => false,
				},
				OTBM_ATTR_DEPOT_ID => match self.r.data_u16() {
					Some(v) => {
						ia.depot_id = v;
						true
					}
					None => false,
				},
				OTBM_ATTR_TIER => match self.r.data_u8() {
					Some(v) => {
						ia.tier = v;
						true
					}
					None => false,
				},
				OTBM_ATTR_RUNE_CHARGES => self.r.skip_data(1),
				OTBM_ATTR_TEXT => match self.r.data_string() {
					Some(s) => {
						ia.text = s;
						true
					}
					None => false,
				},
				OTBM_ATTR_DESC | OTBM_ATTR_DESCRIPTION => match self.r.data_string() {
					Some(s) => {
						ia.desc = s;
						true
					}
					None => false,
				},
				OTBM_ATTR_TELE_DEST => {
					if let (Some(dx), Some(dy), Some(dz)) = (self.r.data_u16(), self.r.data_u16(), self.r.data_u8()) {
						self.v.teleport(tile_x, tile_y, base_z, dx, dy, dz);
						ia.tele_x = dx;
						ia.tele_y = dy;
						ia.tele_z = dz;
						true
					} else {
						false
					}
				}
				_ => false,
			};
			if !ok {
				break;
			}
		}

		self.r.skip_to_structural();
		let mut contents: Vec<ContainedItem> = Vec::new();
		self.each_child(|p| {
			let kind = p.r.data_u8().ok_or("otbm: missing node type")?;
			if kind == OTBM_ITEM {
				contents.push(p.contained_item()?);
				Ok(())
			} else {
				p.skip_subtree()
			}
		})?;
		ia.has_contents = !contents.is_empty();

		if !ia.is_default() {
			self.v.tile_item_attrs(tile_x, tile_y, base_z, item_idx as u8, ia);
		}
		if !contents.is_empty() {
			self.v.tile_item_contents(tile_x, tile_y, base_z, item_idx as u8, contents);
		}
		Ok(())
	}

	fn contained_item(&mut self) -> Result<ContainedItem, String> {
		let server_id = self.r.data_u16().ok_or("otbm: contained item missing id")?;
		let mut subtype = 1u8;
		let mut attrs = ItemAttrs::default();

		while let Some(attr) = self.r.data_u8() {
			let ok = match attr {
				OTBM_ATTR_COUNT => match self.r.data_u8() {
					Some(c) => {
						subtype = c.max(1);
						true
					}
					None => false,
				},
				OTBM_ATTR_ACTION_ID => self.r.data_u16().map(|v| attrs.action_id = v).is_some(),
				OTBM_ATTR_UNIQUE_ID => self.r.data_u16().map(|v| attrs.unique_id = v).is_some(),
				OTBM_ATTR_CHARGES => self.r.data_u16().map(|v| attrs.charges = v).is_some(),
				OTBM_ATTR_DEPOT_ID => self.r.data_u16().map(|v| attrs.depot_id = v).is_some(),
				OTBM_ATTR_TIER => self.r.data_u8().map(|v| attrs.tier = v).is_some(),
				OTBM_ATTR_RUNE_CHARGES => self.r.skip_data(1),
				OTBM_ATTR_TEXT => self.r.data_string().map(|s| attrs.text = s).is_some(),
				OTBM_ATTR_DESC | OTBM_ATTR_DESCRIPTION => self.r.data_string().map(|s| attrs.desc = s).is_some(),
				OTBM_ATTR_TELE_DEST => match (self.r.data_u16(), self.r.data_u16(), self.r.data_u8()) {
					(Some(dx), Some(dy), Some(dz)) => {
						attrs.tele_x = dx;
						attrs.tele_y = dy;
						attrs.tele_z = dz;
						true
					}
					_ => false,
				},
				_ => false,
			};
			if !ok {
				break;
			}
		}

		self.r.skip_to_structural();
		let mut items: Vec<ContainedItem> = Vec::new();
		self.each_child(|p| {
			let kind = p.r.data_u8().ok_or("otbm: missing node type")?;
			if kind == OTBM_ITEM {
				items.push(p.contained_item()?);
				Ok(())
			} else {
				p.skip_subtree()
			}
		})?;
		attrs.has_contents = !items.is_empty();

		Ok(ContainedItem { server_id, subtype, attrs, items })
	}

	fn skip_subtree(&mut self) -> Result<(), String> {
		self.r.skip_to_structural();
		self.each_child(|p| {
			p.r.data_u8();
			p.skip_subtree()
		})
	}

	fn each_child(&mut self, mut f: impl FnMut(&mut Self) -> Result<(), String>) -> Result<(), String> {
		loop {
			match self.r.peek() {
				Some(NODE_END) => {
					self.r.pos += 1;
					return Ok(());
				}
				Some(NODE_START) => {
					self.r.pos += 1;
					f(self)?;
				}
				Some(_) => return Err("otbm: expected node boundary".into()),
				None => return Err("otbm: premature end of node-tree".into()),
			}
		}
	}
}

pub fn read_otbm<V: OtbmVisitor>(bytes: &[u8], visitor: &mut V) -> Result<(), String> {
	let mut parser = Parser {
		r: Reader { b: bytes, pos: 0 },
		v: visitor,
		total: bytes.len(),
		scratch: Vec::new(),
		cur_door: 0,
	};
	parser.run()
}

pub fn read_otbm_header(bytes: &[u8]) -> Result<(u16, u16), String> {
	let mut r = Reader { b: bytes, pos: 0 };
	if bytes.len() < 6 {
		return Err("otbm: file too small for header".into());
	}
	r.pos = 4;
	if r.peek() != Some(NODE_START) {
		return Err("otbm: missing root node start byte".into());
	}
	r.pos += 1;
	r.data_u8().ok_or("otbm: missing root type")?;
	r.data_u32().ok_or("otbm: missing version")?;
	let width = r.data_u16().ok_or("otbm: missing width")?;
	let height = r.data_u16().ok_or("otbm: missing height")?;
	Ok((width, height))
}

pub fn read_otbm_version(bytes: &[u8]) -> Result<(u32, u32, u32), String> {
	let mut r = Reader { b: bytes, pos: 0 };
	if bytes.len() < 6 {
		return Err("otbm: file too small for header".into());
	}
	r.pos = 4;
	if r.peek() != Some(NODE_START) {
		return Err("otbm: missing root node start byte".into());
	}
	r.pos += 1;
	r.data_u8().ok_or("otbm: missing root type")?;
	let otbm_version = r.data_u32().ok_or("otbm: missing version")?;
	r.data_u16().ok_or("otbm: missing width")?;
	r.data_u16().ok_or("otbm: missing height")?;
	let items_major = r.data_u32().unwrap_or(0);
	let items_minor = r.data_u32().unwrap_or(0);
	Ok((otbm_version, items_major, items_minor))
}

pub fn read_otbm_floor<V: OtbmVisitor>(slice: &[u8], visitor: &mut V) -> Result<(), String> {
	let mut p = Parser {
		r: Reader { b: slice, pos: 0 },
		v: visitor,
		total: slice.len(),
		scratch: Vec::new(),
		cur_door: 0,
	};
	loop {
		match p.r.peek() {
			Some(NODE_START) => {
				p.r.pos += 1;
				let kind = p.r.data_u8().ok_or("otbm floor: missing node type")?;
				if kind == OTBM_TILE_AREA {
					p.tile_area()?;
				} else {
					p.skip_subtree()?;
				}
			}
			_ => break,
		}
	}
	Ok(())
}
