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

pub trait OtbmVisitor {
	fn header(&mut self, width: u16, height: u16);
	fn progress(&mut self, pos: usize, total: usize);
	fn tile(&mut self, x: u16, y: u16, z: u8, items: &[u16]);
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
	fn house_tile(&mut self, _x: u16, _y: u16, _z: u8) {}
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
	scratch: Vec<u16>,
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
				let (x, y, z) = p.tile(house, base_x, base_y, base_z)?;
				p.v.tile_span(x, y, z, house, node_start, p.r.pos);
				if house {
					p.v.house_tile(x, y, z);
				}
				Ok(())
			} else {
				p.skip_subtree()
			}
		})
	}

	fn tile(&mut self, house: bool, base_x: u16, base_y: u16, base_z: u8) -> Result<(u16, u16, u8), String> {
		let dx = self.r.data_u8().ok_or("otbm: tile missing dx")?;
		let dy = self.r.data_u8().ok_or("otbm: tile missing dy")?;
		if house {
			self.r.data_u32();
		}
		let tile_x = base_x.wrapping_add(dx as u16);
		let tile_y = base_y.wrapping_add(dy as u16);
		self.scratch.clear();

		while let Some(attr) = self.r.data_u8() {
			match attr {
				OTBM_ATTR_TILE_FLAGS => {
					if self.r.data_u32().is_none() {
						break;
					}
				}
				OTBM_ATTR_ITEM => match self.r.data_u16() {
					Some(id) => self.scratch.push(id),
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
		Ok((tile_x, tile_y, base_z))
	}

	fn tile_item(&mut self, tile_x: u16, tile_y: u16, base_z: u8) -> Result<(), String> {
		let id = self.r.data_u16().ok_or("otbm: item missing id")?;
		self.scratch.push(id);

		while let Some(attr) = self.r.data_u8() {
			let ok = match attr {
				OTBM_ATTR_COUNT | OTBM_ATTR_TIER | OTBM_ATTR_HOUSEDOORID | OTBM_ATTR_RUNE_CHARGES => self.r.skip_data(1),
				OTBM_ATTR_ACTION_ID | OTBM_ATTR_UNIQUE_ID | OTBM_ATTR_CHARGES | OTBM_ATTR_DEPOT_ID => self.r.skip_data(2),
				OTBM_ATTR_TEXT | OTBM_ATTR_DESC | OTBM_ATTR_DESCRIPTION => match self.r.data_u16() {
					Some(len) => self.r.skip_data(len as usize),
					None => false,
				},
				OTBM_ATTR_TELE_DEST => {
					if let (Some(dx), Some(dy), Some(dz)) = (self.r.data_u16(), self.r.data_u16(), self.r.data_u8()) {
						self.v.teleport(tile_x, tile_y, base_z, dx, dy, dz);
					}
					false
				}
				_ => false,
			};
			if !ok {
				break;
			}
		}
		self.skip_subtree()
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

pub fn read_otbm_floor<V: OtbmVisitor>(slice: &[u8], visitor: &mut V) -> Result<(), String> {
	let mut p = Parser {
		r: Reader { b: slice, pos: 0 },
		v: visitor,
		total: slice.len(),
		scratch: Vec::new(),
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
