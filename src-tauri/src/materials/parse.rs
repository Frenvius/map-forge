use std::collections::HashMap;

use super::doodad::DoodadComposite;
use super::geometry::{edge_index, AutoBorder};
use super::wall::{wall_alignment, WALL_ALIGNMENT_COUNT};
use super::AlignNode;

pub(crate) enum ToSpec {
	None,
	All,
	Name(String),
}

pub(crate) enum SpecRef {
	Border(u32, usize),
	Item(u16),
}

pub(crate) struct RawSpecific {
	pub(crate) matches: Vec<SpecRef>,
	pub(crate) to_replace: Option<SpecRef>,
	pub(crate) with: u16,
	pub(crate) delete_all: bool,
	pub(crate) keep_border: bool,
}

pub(crate) struct RawBorderRef {
	pub(crate) outer: bool,
	pub(crate) to: ToSpec,
	pub(crate) border_id: u32,
	pub(crate) specifics: Vec<RawSpecific>,
}

pub(crate) struct RawGround {
	pub(crate) name: String,
	pub(crate) z_order: i32,
	pub(crate) items: Vec<(u16, i32)>,
	pub(crate) total_chance: i32,
	pub(crate) borders: Vec<RawBorderRef>,
	pub(crate) friend_names: Vec<String>,
	pub(crate) optional_id: u32,
	pub(crate) use_only_optional: bool,
}

pub(crate) struct RawWall {
	pub(crate) name: String,
	pub(crate) alignments: Vec<AlignNode>,
	pub(crate) door_ids: Vec<u16>,
	pub(crate) friend_names: Vec<String>,
	pub(crate) redirect_name: Option<String>,
}

pub(crate) struct RawDoodad {
	pub(crate) name: String,
	pub(crate) look: Option<u16>,
	pub(crate) singles: Vec<(u16, i32)>,
	pub(crate) composites: Vec<DoodadComposite>,
}

fn parse_specific(node: roxmltree::Node) -> RawSpecific {
	let mut matches = Vec::new();
	let mut to_replace = None;
	let mut with = 0u16;
	let mut delete_all = false;
	let keep_border = node.attribute("keep_border").is_some_and(|v| v == "true");

	let border_ref = |n: &roxmltree::Node| -> Option<SpecRef> {
		let id = n.attribute("id").and_then(|v| v.parse::<u32>().ok())?;
		let edge = n.attribute("edge").and_then(edge_index)?;
		Some(SpecRef::Border(id, edge))
	};

	for section in node.children() {
		match section.tag_name().name() {
			"conditions" => {
				for cond in section.children() {
					match cond.tag_name().name() {
						"match_border" => {
							if let Some(r) = border_ref(&cond) {
								matches.push(r);
							}
						}
						"match_item" => {
							if let Some(id) = cond.attribute("id").and_then(|v| v.parse::<u16>().ok()) {
								matches.push(SpecRef::Item(id));
							}
						}
						_ => {}
					}
				}
			}
			"actions" => {
				for act in section.children() {
					match act.tag_name().name() {
						"replace_border" => {
							to_replace = border_ref(&act);
							with = act.attribute("with").and_then(|v| v.parse::<u16>().ok()).unwrap_or(0);
						}
						"replace_item" => {
							to_replace = act.attribute("id").and_then(|v| v.parse::<u16>().ok()).map(SpecRef::Item);
							with = act.attribute("with").and_then(|v| v.parse::<u16>().ok()).unwrap_or(0);
						}
						"delete_borders" => delete_all = true,
						_ => {}
					}
				}
			}
			_ => {}
		}
	}

	RawSpecific {
		matches,
		to_replace,
		with,
		delete_all,
		keep_border,
	}
}

pub(crate) fn parse_borders(xml: &str, out: &mut HashMap<u32, AutoBorder>) -> Result<(), String> {
	let doc = roxmltree::Document::parse(xml).map_err(|e| format!("borders.xml: {}", e))?;
	for node in doc.descendants().filter(|n| n.has_tag_name("border")) {
		let Some(id) = node.attribute("id").and_then(|v| v.parse::<u32>().ok()) else {
			continue;
		};
		let mut border = AutoBorder::default();
		border.optional = node.attribute("type") == Some("optional");
		for item in node.children().filter(|n| n.has_tag_name("borderitem")) {
			let edge = item.attribute("edge").and_then(edge_index);
			let server_id = item.attribute("item").and_then(|v| v.parse::<u16>().ok());
			if let (Some(idx), Some(sid)) = (edge, server_id) {
				border.tiles[idx] = sid;
			}
		}
		out.insert(id, border);
	}
	Ok(())
}

pub(crate) fn parse_grounds(xml: &str) -> Result<Vec<RawGround>, String> {
	let doc = roxmltree::Document::parse(xml).map_err(|e| format!("grounds.xml: {}", e))?;
	let mut grounds = Vec::new();
	for node in doc.descendants().filter(|n| n.has_tag_name("brush")) {
		if node.attribute("type") != Some("ground") {
			continue;
		}
		let name = node.attribute("name").unwrap_or_default().to_string();
		let z_order = node.attribute("z-order").and_then(|v| v.parse::<i32>().ok()).unwrap_or(0);
		let use_only_optional = node.attribute("solo_optional").is_some_and(|v| v == "true");

		let mut items = Vec::new();
		let mut total_chance = 0i32;
		let mut borders = Vec::new();
		let mut friend_names = Vec::new();
		let mut optional_id = 0u32;

		for child in node.children() {
			match child.tag_name().name() {
				"item" => {
					let id = child.attribute("id").and_then(|v| v.parse::<u16>().ok());
					let chance = child.attribute("chance").and_then(|v| v.parse::<i32>().ok()).unwrap_or(0);
					if let Some(id) = id {
						total_chance += chance;
						items.push((id, total_chance));
					}
				}
				"border" => {
					let outer = child.attribute("align") != Some("inner");
					let to = match child.attribute("to") {
						None => ToSpec::All,
						Some("none") => ToSpec::None,
						Some(name) => ToSpec::Name(name.to_string()),
					};
					let border_id = child.attribute("id").and_then(|v| v.parse::<u32>().ok()).unwrap_or(0);
					let specifics = child.children().filter(|n| n.has_tag_name("specific")).map(parse_specific).collect();
					borders.push(RawBorderRef { outer, to, border_id, specifics });
				}
				"optional" => {
					if let Some(id) = child.attribute("id").and_then(|v| v.parse::<u32>().ok()) {
						optional_id = id;
					}
				}
				"friend" => {
					if let Some(name) = child.attribute("name") {
						friend_names.push(name.to_string());
					}
				}
				_ => {}
			}
		}

		grounds.push(RawGround {
			name,
			z_order,
			items,
			total_chance,
			borders,
			optional_id,
			use_only_optional,
			friend_names,
		});
	}
	Ok(grounds)
}

pub(crate) fn parse_walls(xml: &str) -> Result<Vec<RawWall>, String> {
	let doc = roxmltree::Document::parse(xml).map_err(|e| format!("walls.xml: {}", e))?;
	let mut walls = Vec::new();
	for node in doc.descendants().filter(|n| n.has_tag_name("brush")) {
		if node.attribute("type") != Some("wall") {
			continue;
		}
		let name = node.attribute("name").unwrap_or_default().to_string();
		let mut alignments: Vec<AlignNode> = vec![AlignNode::default(); WALL_ALIGNMENT_COUNT];
		let mut door_ids = Vec::new();
		let mut friend_names = Vec::new();
		let mut redirect_name = None;

		for child in node.children() {
			match child.tag_name().name() {
				"wall" => {
					let Some(alignment) = child.attribute("type").and_then(wall_alignment) else {
						continue;
					};
					for sub in child.children() {
						match sub.tag_name().name() {
							"item" => {
								let id = sub.attribute("id").and_then(|v| v.parse::<u16>().ok());
								let chance = sub.attribute("chance").and_then(|v| v.parse::<i32>().ok()).unwrap_or(1);
								if let Some(id) = id {
									alignments[alignment as usize].items.push((id, chance.max(0)));
								}
							}
							"door" => {
								if let Some(id) = sub.attribute("id").and_then(|v| v.parse::<u16>().ok()) {
									door_ids.push(id);
								}
							}
							_ => {}
						}
					}
				}
				"friend" => {
					if let Some(name) = child.attribute("name").or_else(|| child.attribute("id")) {
						friend_names.push(name.to_string());
						if child.attribute("redirect").is_some_and(|v| v == "true") {
							redirect_name = Some(name.to_string());
						}
					}
				}
				_ => {}
			}
		}

		walls.push(RawWall {
			name,
			alignments,
			door_ids,
			friend_names,
			redirect_name,
		});
	}
	Ok(walls)
}

pub(crate) fn parse_aligned_brushes(
	xml: &str,
	brush_type: &str,
	child_tag: &str,
	count: usize,
	resolve: fn(&str) -> Option<usize>,
) -> Result<Vec<(String, Vec<AlignNode>)>, String> {
	let doc = roxmltree::Document::parse(xml).map_err(|e| format!("{}.xml: {}", brush_type, e))?;
	let mut out = Vec::new();
	for node in doc.descendants().filter(|n| n.has_tag_name("brush")) {
		if node.attribute("type") != Some(brush_type) {
			continue;
		}
		let name = node.attribute("name").unwrap_or_default().to_string();
		let mut aligns: Vec<AlignNode> = vec![AlignNode::default(); count];
		for child in node.children().filter(|n| n.tag_name().name() == child_tag) {
			let Some(idx) = child.attribute("align").and_then(resolve) else {
				continue;
			};
			if let Some(id) = child.attribute("id").and_then(|v| v.parse::<u16>().ok()) {
				aligns[idx].items.push((id, 1));
			}
			for item in child.children().filter(|n| n.has_tag_name("item")) {
				let id = item.attribute("id").and_then(|v| v.parse::<u16>().ok());
				let chance = item.attribute("chance").and_then(|v| v.parse::<i32>().ok()).unwrap_or(1);
				if let Some(id) = id {
					aligns[idx].items.push((id, chance.max(0)));
				}
			}
		}
		out.push((name, aligns));
	}
	Ok(out)
}

fn parse_composite(node: roxmltree::Node) -> DoodadComposite {
	let chance = node.attribute("chance").and_then(|v| v.parse::<i32>().ok()).unwrap_or(1).max(0);
	let mut tiles = Vec::new();
	for tile in node.children().filter(|n| n.has_tag_name("tile")) {
		let dx = tile.attribute("x").and_then(|v| v.parse::<i32>().ok()).unwrap_or(0);
		let dy = tile.attribute("y").and_then(|v| v.parse::<i32>().ok()).unwrap_or(0);
		let items: Vec<u16> = tile
			.children()
			.filter(|n| n.has_tag_name("item"))
			.filter_map(|i| i.attribute("id").and_then(|v| v.parse::<u16>().ok()))
			.collect();
		if !items.is_empty() {
			tiles.push((dx, dy, items));
		}
	}
	DoodadComposite { chance, tiles }
}

pub(crate) fn parse_doodads(xml: &str) -> Result<Vec<RawDoodad>, String> {
	let doc = roxmltree::Document::parse(xml).map_err(|e| format!("doodads.xml: {}", e))?;
	let mut out = Vec::new();
	for node in doc.descendants().filter(|n| n.has_tag_name("brush")) {
		if node.attribute("type") != Some("doodad") {
			continue;
		}
		let name = node.attribute("name").unwrap_or_default().to_string();
		let look = node.attribute("server_lookid").and_then(|v| v.parse::<u16>().ok());
		let mut singles = Vec::new();
		let mut composites = Vec::new();

		let take_item = |n: &roxmltree::Node, singles: &mut Vec<(u16, i32)>| {
			if let Some(id) = n.attribute("id").and_then(|v| v.parse::<u16>().ok()) {
				let chance = n.attribute("chance").and_then(|v| v.parse::<i32>().ok()).unwrap_or(1).max(0);
				singles.push((id, chance));
			}
		};

		for child in node.children() {
			match child.tag_name().name() {
				"item" => take_item(&child, &mut singles),
				"composite" => composites.push(parse_composite(child)),
				"alternate" => {
					for alt in child.children() {
						match alt.tag_name().name() {
							"item" => take_item(&alt, &mut singles),
							"composite" => composites.push(parse_composite(alt)),
							_ => {}
						}
					}
				}
				_ => {}
			}
		}

		out.push(RawDoodad {
			name,
			look,
			singles,
			composites,
		});
	}
	Ok(out)
}
