pub const BORDER_NONE: u8 = 0;
pub const NORTH_HORIZONTAL: u8 = 1;
pub const EAST_HORIZONTAL: u8 = 2;
pub const SOUTH_HORIZONTAL: u8 = 3;
pub const WEST_HORIZONTAL: u8 = 4;
pub const NORTHWEST_CORNER: u8 = 5;
pub const NORTHEAST_CORNER: u8 = 6;
pub const SOUTHWEST_CORNER: u8 = 7;
pub const SOUTHEAST_CORNER: u8 = 8;
pub const NORTHWEST_DIAGONAL: u8 = 9;
pub const NORTHEAST_DIAGONAL: u8 = 10;
pub const SOUTHEAST_DIAGONAL: u8 = 11;
pub const SOUTHWEST_DIAGONAL: u8 = 12;

pub(crate) const TILE_NW: u32 = 1;
pub(crate) const TILE_N: u32 = 2;
pub(crate) const TILE_NE: u32 = 4;
pub(crate) const TILE_W: u32 = 8;
pub(crate) const TILE_E: u32 = 16;
pub(crate) const TILE_SW: u32 = 32;
pub(crate) const TILE_S: u32 = 64;
pub(crate) const TILE_SE: u32 = 128;

pub(crate) fn edge_index(edge: &str) -> Option<usize> {
	Some(match edge {
		"n" => NORTH_HORIZONTAL,
		"e" => EAST_HORIZONTAL,
		"s" => SOUTH_HORIZONTAL,
		"w" => WEST_HORIZONTAL,
		"cnw" => NORTHWEST_CORNER,
		"cne" => NORTHEAST_CORNER,
		"csw" => SOUTHWEST_CORNER,
		"cse" => SOUTHEAST_CORNER,
		"dnw" => NORTHWEST_DIAGONAL,
		"dne" => NORTHEAST_DIAGONAL,
		"dse" => SOUTHEAST_DIAGONAL,
		"dsw" => SOUTHWEST_DIAGONAL,
		_ => return None,
	} as usize)
}

#[derive(Clone, Default)]
pub struct AutoBorder {
	pub tiles: [u16; 13],
	pub optional: bool,
}

pub(crate) fn diagonal_components(direction: u8) -> Option<(u8, u8)> {
	match direction {
		NORTHWEST_DIAGONAL => Some((WEST_HORIZONTAL, NORTH_HORIZONTAL)),
		NORTHEAST_DIAGONAL => Some((EAST_HORIZONTAL, NORTH_HORIZONTAL)),
		SOUTHWEST_DIAGONAL => Some((SOUTH_HORIZONTAL, WEST_HORIZONTAL)),
		SOUTHEAST_DIAGONAL => Some((SOUTH_HORIZONTAL, EAST_HORIZONTAL)),
		_ => None,
	}
}

pub(crate) fn build_border_types() -> [u32; 256] {
	let mut table = [0u32; 256];
	for (i, slot) in table.iter_mut().enumerate() {
		let i = i as u32;
		let mut result: u32 = 0;
		let mut shift = 0u32;
		let mut add = |val: u8| {
			result |= (val as u32) << (shift * 8);
			shift += 1;
		};

		let has_n = i & TILE_N != 0;
		let has_s = i & TILE_S != 0;
		let has_e = i & TILE_E != 0;
		let has_w = i & TILE_W != 0;

		let nw_d = has_n && has_w && !has_s && !has_e;
		let ne_d = has_n && has_e && !has_s && !has_w;
		let sw_d = has_s && has_w && !has_n && !has_e;
		let se_d = has_s && has_e && !has_n && !has_w;

		let (mut n_used, mut s_used, mut e_used, mut w_used) = (false, false, false, false);

		if nw_d {
			add(NORTHWEST_DIAGONAL);
			n_used = true;
			w_used = true;
		}
		if ne_d {
			add(NORTHEAST_DIAGONAL);
			n_used = true;
			e_used = true;
		}
		if sw_d {
			add(SOUTHWEST_DIAGONAL);
			s_used = true;
			w_used = true;
		}
		if se_d {
			add(SOUTHEAST_DIAGONAL);
			s_used = true;
			e_used = true;
		}

		if has_n && !n_used {
			add(NORTH_HORIZONTAL);
		}
		if has_s && !s_used {
			add(SOUTH_HORIZONTAL);
		}
		if has_e && !e_used {
			add(EAST_HORIZONTAL);
		}
		if has_w && !w_used {
			add(WEST_HORIZONTAL);
		}

		if i & TILE_NW != 0 && !has_n && !has_w {
			add(NORTHWEST_CORNER);
		}
		if i & TILE_NE != 0 && !has_n && !has_e {
			add(NORTHEAST_CORNER);
		}
		if i & TILE_SW != 0 && !has_s && !has_w {
			add(SOUTHWEST_CORNER);
		}
		if i & TILE_SE != 0 && !has_s && !has_e {
			add(SOUTHEAST_CORNER);
		}

		drop(add);
		*slot = result;
	}
	table
}
