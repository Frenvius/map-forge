use std::collections::{HashMap, HashSet};
use std::path::Path;

mod aligned;
mod doodad;
mod geometry;
mod ground;
mod parse;
mod wall;

pub use doodad::DoodadBrush;
pub use ground::{BorderBlock, BorderResult, GroundBrush, SpecificCase};
pub use wall::WallBrush;

use aligned::AlignedBrush;
use geometry::{build_border_types, AutoBorder};

pub(crate) const TO_NONE: u32 = 0;
pub(crate) const TO_ALL: u32 = 0xFFFF_FFFF;

#[derive(Clone, Default)]
pub(crate) struct AlignNode {
	pub(crate) items: Vec<(u16, i32)>,
}

impl AlignNode {
	fn weighted(&self, seed: u32) -> Option<u16> {
		let total: i32 = self.items.iter().map(|(_, c)| (*c).max(0)).sum();
		if total <= 0 {
			return self.items.first().map(|(id, _)| *id);
		}
		let mut roll = (seed % total as u32) as i32;
		for &(id, chance) in &self.items {
			let chance = chance.max(0);
			if roll < chance {
				return Some(id);
			}
			roll -= chance;
		}
		self.items.last().map(|(id, _)| *id)
	}
}

#[allow(dead_code)]
pub struct Materials {
	pub borders: HashMap<u32, AutoBorder>,
	pub grounds: Vec<GroundBrush>,
	pub server_to_ground: HashMap<u16, u32>,
	pub name_to_id: HashMap<String, u32>,
	pub border_item_ids: HashSet<u16>,
	pub border_types: [u32; 256],
	pub walls: Vec<WallBrush>,
	pub server_to_wall: HashMap<u16, u32>,
	pub door_ids: HashSet<u16>,
	pub wall_name_to_id: HashMap<String, u32>,
	pub full_border_types: [u8; 16],
	pub half_border_types: [u8; 16],
	pub tables: Vec<AlignedBrush>,
	pub server_to_table: HashMap<u16, u32>,
	pub table_types: [u8; 256],
	pub carpets: Vec<AlignedBrush>,
	pub server_to_carpet: HashMap<u16, u32>,
	pub carpet_types: [u8; 256],
	pub doodads: Vec<DoodadBrush>,
	pub server_to_doodad: HashMap<u16, u32>,
}

impl Materials {
	pub fn load(data_dir: &Path) -> Result<Materials, String> {
		let read = |file: &str| -> Result<String, String> {
			std::fs::read_to_string(data_dir.join(file)).map_err(|e| format!("read {}: {}", file, e))
		};

		let mut borders = HashMap::new();
		parse::parse_borders(&read("borders.xml")?, &mut borders)?;

		let raw_grounds = parse::parse_grounds(&read("grounds.xml")?)?;

		let mut name_to_id: HashMap<String, u32> = HashMap::new();
		for (idx, g) in raw_grounds.iter().enumerate() {
			name_to_id.insert(g.name.clone(), idx as u32 + 1);
		}

		let resolve_to = |spec: &parse::ToSpec| -> u32 {
			match spec {
				parse::ToSpec::None => TO_NONE,
				parse::ToSpec::All => TO_ALL,
				parse::ToSpec::Name(name) => name_to_id.get(name).copied().unwrap_or(TO_NONE),
			}
		};

		let mut grounds = Vec::with_capacity(raw_grounds.len());
		let mut server_to_ground: HashMap<u16, u32> = HashMap::new();
		let mut border_item_ids: HashSet<u16> = HashSet::new();

		for (idx, raw) in raw_grounds.iter().enumerate() {
			let id = idx as u32 + 1;
			let mut block_list = Vec::with_capacity(raw.borders.len());
			let (mut has_zilch_outer, mut has_zilch_inner, mut has_outer, mut has_inner) = (false, false, false, false);

			for raw_border in &raw.borders {
				let to = resolve_to(&raw_border.to);
				if raw_border.outer {
					if to == TO_NONE {
						has_zilch_outer = true;
					} else {
						has_outer = true;
					}
				} else if to == TO_NONE {
					has_zilch_inner = true;
				} else {
					has_inner = true;
				}

				if let Some(autoborder) = borders.get(&raw_border.border_id) {
					for &sid in &autoborder.tiles {
						if sid != 0 {
							border_item_ids.insert(sid);
						}
					}
				}

				let resolve_ref = |r: &parse::SpecRef| -> Option<u16> {
					match r {
						parse::SpecRef::Item(id) => Some(*id),
						parse::SpecRef::Border(bid, edge) => borders.get(bid).map(|b| b.tiles[*edge]).filter(|&s| s != 0),
					}
				};
				let mut specifics = Vec::new();
				for raw_spec in &raw_border.specifics {
					let matches: Vec<u16> = raw_spec.matches.iter().filter_map(&resolve_ref).collect();
					let to_replace = raw_spec.to_replace.as_ref().and_then(&resolve_ref).unwrap_or(0);
					if matches.is_empty() {
						continue;
					}
					if raw_spec.with != 0 {
						border_item_ids.insert(raw_spec.with);
					}
					specifics.push(SpecificCase {
						matches,
						to_replace,
						with: raw_spec.with,
						delete_all: raw_spec.delete_all,
						keep_border: raw_spec.keep_border,
					});
				}

				block_list.push(BorderBlock {
					outer: raw_border.outer,
					to,
					border_id: raw_border.border_id,
					specifics,
				});
			}

			for &(server_id, _) in &raw.items {
				server_to_ground.insert(server_id, id);
			}

			let optional_border_id = if raw.optional_id != 0 && borders.contains_key(&raw.optional_id) {
				if let Some(autoborder) = borders.get(&raw.optional_id) {
					for &sid in &autoborder.tiles {
						if sid != 0 {
							border_item_ids.insert(sid);
						}
					}
				}
				raw.optional_id
			} else {
				0
			};

			let friends = raw
				.friend_names
				.iter()
				.map(|n| {
					if n == "all" {
						TO_ALL
					} else {
						name_to_id.get(n).copied().unwrap_or(0)
					}
				})
				.collect();

			grounds.push(GroundBrush {
				id,
				name: raw.name.clone(),
				z_order: raw.z_order,
				items: raw.items.clone(),
				total_chance: raw.total_chance,
				borders: block_list,
				friends,
				hate_friends: false,
				has_zilch_outer,
				has_zilch_inner,
				has_outer,
				has_inner,
				optional_border_id,
				use_only_optional: raw.use_only_optional,
			});
		}

		let raw_walls = parse::parse_walls(&read("walls.xml")?)?;
		let mut wall_name_to_id: HashMap<String, u32> = HashMap::new();
		for (idx, w) in raw_walls.iter().enumerate() {
			wall_name_to_id.insert(w.name.clone(), idx as u32 + 1);
		}

		let mut walls = Vec::with_capacity(raw_walls.len());
		let mut server_to_wall: HashMap<u16, u32> = HashMap::new();
		let mut door_ids: HashSet<u16> = HashSet::new();
		for (idx, raw) in raw_walls.into_iter().enumerate() {
			let id = idx as u32 + 1;
			for node in &raw.alignments {
				for &(server_id, _) in &node.items {
					server_to_wall.insert(server_id, id);
				}
			}
			for &door_id in &raw.door_ids {
				server_to_wall.insert(door_id, id);
				door_ids.insert(door_id);
			}
			let friends = raw
				.friend_names
				.iter()
				.map(|n| if n == "all" { TO_ALL } else { wall_name_to_id.get(n).copied().unwrap_or(0) })
				.collect();
			let redirect_to = raw.redirect_name.as_ref().and_then(|n| wall_name_to_id.get(n).copied()).unwrap_or(0);
			walls.push(WallBrush {
				id,
				name: raw.name,
				alignments: raw.alignments,
				friends,
				redirect_to,
			});
		}

		let (full_border_types, half_border_types) = wall::build_wall_tables();

		let build_aligned = |raw: Vec<(String, Vec<AlignNode>)>| -> (Vec<AlignedBrush>, HashMap<u16, u32>) {
			let mut brushes = Vec::with_capacity(raw.len());
			let mut server_map: HashMap<u16, u32> = HashMap::new();
			for (idx, (name, alignments)) in raw.into_iter().enumerate() {
				let id = idx as u32 + 1;
				for node in &alignments {
					for &(server_id, _) in &node.items {
						server_map.insert(server_id, id);
					}
				}
				brushes.push(AlignedBrush { id, name, alignments });
			}
			(brushes, server_map)
		};

		let doodads_xml = read("doodads.xml")?;
		let (tables, server_to_table) = build_aligned(parse::parse_aligned_brushes(
			&doodads_xml,
			"table",
			"table",
			aligned::TABLE_ALIGNMENT_COUNT,
			aligned::table_alignment,
		)?);
		let (carpets, server_to_carpet) = build_aligned(parse::parse_aligned_brushes(
			&doodads_xml,
			"carpet",
			"carpet",
			aligned::CARPET_ALIGNMENT_COUNT,
			aligned::carpet_alignment,
		)?);

		let mut doodads = Vec::new();
		let mut server_to_doodad: HashMap<u16, u32> = HashMap::new();
		for (idx, raw) in parse::parse_doodads(&doodads_xml)?.into_iter().enumerate() {
			let id = idx as u32 + 1;
			if let Some(look) = raw.look {
				server_to_doodad.insert(look, id);
			}
			for &(item_id, _) in &raw.singles {
				server_to_doodad.entry(item_id).or_insert(id);
			}
			doodads.push(DoodadBrush {
				id,
				name: raw.name,
				singles: raw.singles,
				composites: raw.composites,
			});
		}

		Ok(Materials {
			borders,
			grounds,
			server_to_ground,
			name_to_id,
			border_item_ids,
			border_types: build_border_types(),
			walls,
			server_to_wall,
			door_ids,
			wall_name_to_id,
			full_border_types,
			half_border_types,
			tables,
			server_to_table,
			table_types: aligned::build_table_types(),
			carpets,
			server_to_carpet,
			carpet_types: aligned::build_carpet_types(),
			doodads,
			server_to_doodad,
		})
	}

	pub fn is_border_item(&self, server_id: u16) -> bool {
		self.border_item_ids.contains(&server_id)
	}

	pub fn is_door(&self, server_id: u16) -> bool {
		self.door_ids.contains(&server_id)
	}

	pub fn ground_brush_for(&self, server_id: u16) -> Option<&GroundBrush> {
		let id = *self.server_to_ground.get(&server_id)?;
		self.brush(id)
	}

	fn brush(&self, id: u32) -> Option<&GroundBrush> {
		if id == 0 {
			return None;
		}
		self.grounds.get(id as usize - 1)
	}
}

#[cfg(test)]
mod tests {
	use super::aligned::*;
	use super::geometry::*;
	use super::wall::*;
	use super::*;
	use std::path::PathBuf;

	fn data_dir() -> PathBuf {
		PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../data/860")
	}

	#[test]
	fn border_table_matches_reference_patterns() {
		let t = build_border_types();
		assert_eq!(t[TILE_N as usize] & 0xFF, NORTH_HORIZONTAL as u32);
		assert_eq!(t[(TILE_N | TILE_W) as usize] & 0xFF, NORTHWEST_DIAGONAL as u32);
		assert_eq!(t[(TILE_N | TILE_W | TILE_NW) as usize] & 0xFF, NORTHWEST_DIAGONAL as u32);
		assert_eq!(
			t[(TILE_N | TILE_E | TILE_W) as usize],
			NORTH_HORIZONTAL as u32 | (EAST_HORIZONTAL as u32) << 8 | (WEST_HORIZONTAL as u32) << 16
		);
		assert_eq!(
			t[(TILE_NW | TILE_NE) as usize],
			NORTHWEST_CORNER as u32 | (NORTHEAST_CORNER as u32) << 8
		);
		assert_eq!(
			t[(TILE_N | TILE_E | TILE_SW) as usize],
			NORTHEAST_DIAGONAL as u32 | (SOUTHWEST_CORNER as u32) << 8
		);
	}

	#[test]
	fn lua_wall_segment_matches_native_tables() {
		use crate::lua_host::LuaHost;
		use crate::scripting::{wall_segment, ScopedLua};
		let (full, half) = build_wall_tables();
		let mut host = LuaHost::new(PathBuf::from("../data/scripts"));
		host.load_all().unwrap();
		let _s = ScopedLua::enter(&host);
		for mask in 0u8..16 {
			assert_eq!(wall_segment(mask, false), Some(full[mask as usize]), "full mask {}", mask);
			assert_eq!(wall_segment(mask, true), Some(half[mask as usize]), "half mask {}", mask);
		}
	}

	#[test]
	fn wall_tables_and_alignment_lookup() {
		let (full, _half) = build_wall_tables();
		assert_eq!(full[0], WALL_POLE);
		assert_eq!(full[(WALLTILE_W | WALLTILE_E) as usize], WALL_HORIZONTAL);
		assert_eq!(full[(WALLTILE_N | WALLTILE_S) as usize], WALL_VERTICAL);
		assert_eq!(full[(WALLTILE_N | WALLTILE_W | WALLTILE_E | WALLTILE_S) as usize], WALL_INTERSECTION);

		let m = Materials::load(&data_dir()).unwrap();
		let stone = m.wall_brush_for(1050).expect("stone wall horizontal item maps to a wall brush");

		assert!(m.wall_id_for(stone, 0, 0).is_some(), "pole alignment resolves");
		let horizontal = m.wall_id_for(stone, WALLTILE_W | WALLTILE_E, 0).unwrap();
		assert_eq!(horizontal, 1050, "W+E neighbours -> horizontal stone wall");
		let t_junction = m.wall_id_for(stone, WALLTILE_N | WALLTILE_W | WALLTILE_E, 0);
		assert!(t_junction.is_some(), "T-junction folds to an available alignment via the half table");
	}

	#[test]
	fn table_and_carpet_tables_match_reference() {
		let t = build_table_types();
		assert_eq!(t[(TILE_N | TILE_S) as usize], TABLE_VERTICAL);
		assert_eq!(t[(TILE_E | TILE_W) as usize], TABLE_HORIZONTAL);
		assert_eq!(t[0], TABLE_ALONE);

		let c = build_carpet_types();
		assert_eq!(c[(TILE_N | TILE_NW | TILE_W) as usize], NORTHWEST_CORNER);
		assert_eq!(c[(TILE_N | TILE_W | TILE_E) as usize], NORTH_HORIZONTAL);
		assert_eq!(c[(TILE_W | TILE_NW) as usize], WEST_HORIZONTAL);
		assert_eq!(c[(TILE_E | TILE_NW) as usize], NORTHEAST_CORNER);
		assert_eq!(c[(TILE_S | TILE_NW) as usize], NORTHWEST_CORNER);
		assert_eq!(c[TILE_S as usize], SOUTHWEST_CORNER);
	}

	#[test]
	fn loads_tables_and_carpets() {
		let m = Materials::load(&data_dir()).unwrap();
		assert!(!m.tables.is_empty(), "tables parsed from doodads.xml");
		assert!(!m.carpets.is_empty(), "carpets parsed from doodads.xml");

		let floe = m.carpet_brush_for(7145).expect("ice floe carpet item maps to a carpet brush");
		assert_eq!(m.carpet_id_for(floe, 0, 0), Some(7145), "isolated carpet -> center piece");

		let log = m.table_brush_for(4191).expect("log table item maps to a table brush");
		assert!(m.table_id_for(log, TILE_W | TILE_E, 0).is_some(), "horizontal table alignment resolves");
	}

	#[test]
	fn loads_grounds_and_borders() {
		let m = Materials::load(&data_dir()).unwrap();
		assert!(!m.grounds.is_empty(), "grounds parsed");
		assert!(!m.borders.is_empty(), "borders parsed");

		let grass = m.ground_brush_for(4526).expect("grass ground item maps to a brush");
		assert_eq!(grass.name, "grass");
		assert!(grass.has_outer, "grass has an outer border");
	}

	#[test]
	fn grass_surrounded_by_empty_has_no_outer_border() {
		let m = Materials::load(&data_dir()).unwrap();
		let grass_id = *m.name_to_id.get("grass").unwrap();
		let border_ids = m.calculate_borders(grass_id, &[0; 8], false).items;
		assert!(!border_ids.is_empty(), "grass against all-empty yields its zilch inner border");
		for sid in &border_ids {
			assert!(m.is_border_item(*sid), "produced ids are border items");
		}
	}

	#[test]
	fn doodad_placement_singles_and_composites() {
		let m = Materials::load(&data_dir()).unwrap();
		assert!(!m.doodads.is_empty(), "doodad brushes parsed");

		let tufts = m.doodad_brush_for(6216).expect("grass tufts doodad resolves");
		let single = m.doodad_placement(tufts, 0);
		assert_eq!(single.len(), 1, "grass tufts is single-tile");
		assert_eq!((single[0].0, single[0].1), (0, 0), "single doodad stamps at the cursor");

		let has_multi = m
			.doodads
			.iter()
			.any(|d| (0..32u32).any(|s| m.doodad_placement(d.id, s).iter().any(|&(dx, dy, _)| dx != 0 || dy != 0)));
		assert!(has_multi, "at least one doodad stamps an offset composite tile");
	}

	#[test]
	fn optional_border_only_appears_with_flag() {
		let m = Materials::load(&data_dir()).unwrap();
		let opt = m.grounds.iter().find(|g| g.optional_border_id != 0).expect("a ground brush defines an optional border");
		let own = m
			.grounds
			.iter()
			.find(|g| {
				g.id != opt.id
					&& !g.friends.contains(&opt.id)
					&& !opt.friends.contains(&g.id)
					&& !g.friends.contains(&TO_ALL)
					&& !opt.friends.contains(&TO_ALL)
			})
			.expect("a non-friend ground brush exists");

		let neigh = [opt.id; 8];
		let without = m.calculate_borders(own.id, &neigh, false).items.len();
		let with = m.calculate_borders(own.id, &neigh, true).items.len();
		assert!(with > without, "the optional flag adds the gravel border ({without} -> {with})");
	}

	#[test]
	fn parses_border_specific_cases() {
		let m = Materials::load(&data_dir()).unwrap();
		let total: usize = m.grounds.iter().flat_map(|g| &g.borders).map(|b| b.specifics.len()).sum();
		assert!(total > 0, "ground brushes carry specific-case rules");
		let well_formed = m
			.grounds
			.iter()
			.flat_map(|g| &g.borders)
			.flat_map(|b| &b.specifics)
			.any(|s| s.with != 0 && !s.matches.is_empty() && m.is_border_item(s.with));
		assert!(well_formed, "at least one specific case resolves to a real replacement border");
	}
}
