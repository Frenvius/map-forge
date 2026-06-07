use super::geometry::{
	edge_index, EAST_HORIZONTAL, NORTHEAST_CORNER, NORTHEAST_DIAGONAL, NORTHWEST_CORNER, NORTHWEST_DIAGONAL, NORTH_HORIZONTAL,
	SOUTHEAST_CORNER, SOUTHEAST_DIAGONAL, SOUTHWEST_CORNER, SOUTHWEST_DIAGONAL, SOUTH_HORIZONTAL, TILE_E, TILE_N, TILE_NE, TILE_NW, TILE_S,
	TILE_SE, TILE_SW, TILE_W, WEST_HORIZONTAL,
};
use super::{AlignNode, Materials};

pub(crate) const TABLE_ALIGNMENT_COUNT: usize = 7;
pub(crate) const CARPET_ALIGNMENT_COUNT: usize = 14;

pub(crate) const TABLE_NORTH_END: u8 = 0;
pub(crate) const TABLE_SOUTH_END: u8 = 1;
pub(crate) const TABLE_EAST_END: u8 = 2;
pub(crate) const TABLE_WEST_END: u8 = 3;
pub(crate) const TABLE_HORIZONTAL: u8 = 4;
pub(crate) const TABLE_VERTICAL: u8 = 5;
pub(crate) const TABLE_ALONE: u8 = 6;

const CARPET_CENTER: u8 = 13;

pub(crate) fn table_alignment(name: &str) -> Option<usize> {
	Some(match name {
		"vertical" => TABLE_VERTICAL,
		"horizontal" => TABLE_HORIZONTAL,
		"south" => TABLE_SOUTH_END,
		"east" => TABLE_EAST_END,
		"north" => TABLE_NORTH_END,
		"west" => TABLE_WEST_END,
		"alone" => TABLE_ALONE,
		_ => return None,
	} as usize)
}

pub(crate) fn carpet_alignment(name: &str) -> Option<usize> {
	if name == "center" {
		return Some(CARPET_CENTER as usize);
	}
	edge_index(name)
}

pub(crate) fn build_table_types() -> [u8; 256] {
	let mut table = [0u8; 256];
	for (i, slot) in table.iter_mut().enumerate() {
		let i = i as u32;
		let (n, s, e, w) = (i & TILE_N != 0, i & TILE_S != 0, i & TILE_E != 0, i & TILE_W != 0);
		*slot = if n && s && !e && !w {
			TABLE_VERTICAL
		} else if e && w && !n && !s {
			TABLE_HORIZONTAL
		} else if n && !s && !e && !w {
			TABLE_SOUTH_END
		} else if s && !n && !e && !w {
			TABLE_NORTH_END
		} else if e && !w && !n && !s {
			TABLE_WEST_END
		} else if w && !e && !n && !s {
			TABLE_EAST_END
		} else {
			TABLE_ALONE
		};
	}
	table
}

pub(crate) fn build_carpet_types() -> [u8; 256] {
	let mut table = [0u8; 256];
	for (i, slot) in table.iter_mut().enumerate() {
		let i = i as u32;
		let nw = i & TILE_NW != 0;
		let n = i & TILE_N != 0;
		let ne = i & TILE_NE != 0;
		let w = i & TILE_W != 0;
		let e = i & TILE_E != 0;
		let sw = i & TILE_SW != 0;
		let s = i & TILE_S != 0;
		let se = i & TILE_SE != 0;

		*slot = if n && s && e && w {
			let missing = (!nw) as i32 + (!ne) as i32 + (!sw) as i32 + (!se) as i32;
			if missing == 1 {
				if !nw {
					SOUTHEAST_DIAGONAL
				} else if !ne {
					SOUTHWEST_DIAGONAL
				} else if !sw {
					NORTHEAST_DIAGONAL
				} else {
					NORTHWEST_DIAGONAL
				}
			} else {
				CARPET_CENTER
			}
		} else if n && s && w {
			if sw && nw {
				WEST_HORIZONTAL
			} else if sw {
				SOUTHWEST_CORNER
			} else if nw {
				NORTHWEST_CORNER
			} else {
				WEST_HORIZONTAL
			}
		} else if n && s && e {
			EAST_HORIZONTAL
		} else if n && w && e {
			if sw {
				NORTHWEST_CORNER
			} else {
				NORTH_HORIZONTAL
			}
		} else if s && w && e {
			SOUTH_HORIZONTAL
		} else if n && w {
			NORTHWEST_CORNER
		} else if n && e {
			NORTHEAST_CORNER
		} else if s && w {
			SOUTHWEST_CORNER
		} else if s && e {
			SOUTHEAST_CORNER
		} else if n && s {
			if nw && sw {
				WEST_HORIZONTAL
			} else if nw {
				NORTHWEST_CORNER
			} else if sw {
				SOUTHWEST_CORNER
			} else if ne {
				NORTHEAST_CORNER
			} else if se {
				SOUTHEAST_CORNER
			} else {
				CARPET_CENTER
			}
		} else if w && e {
			let n_side = nw || ne;
			let s_side = sw || se;
			if sw && e && w {
				SOUTHWEST_CORNER
			} else if n_side && s_side {
				CARPET_CENTER
			} else if n_side {
				NORTH_HORIZONTAL
			} else if s_side {
				SOUTH_HORIZONTAL
			} else {
				CARPET_CENTER
			}
		} else if n {
			if nw {
				NORTHWEST_CORNER
			} else if ne {
				NORTHEAST_CORNER
			} else if sw {
				SOUTHWEST_CORNER
			} else if se {
				SOUTHEAST_CORNER
			} else {
				CARPET_CENTER
			}
		} else if s {
			if sw {
				SOUTHWEST_CORNER
			} else if se {
				SOUTHEAST_CORNER
			} else if nw {
				NORTHWEST_CORNER
			} else if ne {
				NORTHEAST_CORNER
			} else {
				SOUTHWEST_CORNER
			}
		} else if w {
			if nw {
				WEST_HORIZONTAL
			} else if sw {
				SOUTHWEST_CORNER
			} else if se {
				SOUTH_HORIZONTAL
			} else {
				CARPET_CENTER
			}
		} else if e {
			if nw {
				NORTHEAST_CORNER
			} else if ne {
				NORTHEAST_CORNER
			} else if se {
				SOUTH_HORIZONTAL
			} else {
				CARPET_CENTER
			}
		} else if nw && ne {
			NORTH_HORIZONTAL
		} else if sw && se {
			SOUTH_HORIZONTAL
		} else if nw && sw {
			WEST_HORIZONTAL
		} else if ne && se {
			EAST_HORIZONTAL
		} else if ne {
			NORTHEAST_CORNER
		} else if se {
			SOUTHEAST_CORNER
		} else if sw {
			SOUTHWEST_CORNER
		} else {
			CARPET_CENTER
		};
	}
	table
}

#[derive(Clone)]
#[allow(dead_code)]
pub struct AlignedBrush {
	pub id: u32,
	pub name: String,
	pub(crate) alignments: Vec<AlignNode>,
}

impl Materials {
	pub fn table_brush_for(&self, server_id: u16) -> Option<u32> {
		self.server_to_table.get(&server_id).copied()
	}

	pub fn table_id_for(&self, own: u32, tiledata: u32, seed: u32) -> Option<u16> {
		let tb = self.tables.get(own.checked_sub(1)? as usize)?;
		let alignment = self.table_types[(tiledata & 0xFF) as usize] as usize;
		tb.alignments.get(alignment).and_then(|n| n.weighted(seed))
	}

	pub fn carpet_brush_for(&self, server_id: u16) -> Option<u32> {
		self.server_to_carpet.get(&server_id).copied()
	}

	pub fn carpet_id_for(&self, own: u32, tiledata: u32, seed: u32) -> Option<u16> {
		let cb = self.carpets.get(own.checked_sub(1)? as usize)?;
		let alignment = self.carpet_types[(tiledata & 0xFF) as usize] as usize;
		cb.alignments.get(alignment).and_then(|n| n.weighted(seed))
	}
}
