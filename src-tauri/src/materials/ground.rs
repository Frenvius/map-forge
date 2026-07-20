use super::geometry::{diagonal_components, BORDER_NONE};
use super::{Materials, TO_ALL, TO_NONE};

#[derive(Clone)]
pub struct SpecificCase {
	pub matches: Vec<u16>,
	pub to_replace: u16,
	pub with: u16,
	pub delete_all: bool,
	pub keep_border: bool,
}

#[derive(Default)]
pub struct BorderResult {
	pub items: Vec<u16>,
	pub specifics: Vec<SpecificCase>,
}

#[derive(Clone)]
pub struct BorderBlock {
	pub outer: bool,
	pub to: u32,
	pub border_id: u32,
	pub specifics: Vec<SpecificCase>,
}

#[derive(Clone, Default)]
#[allow(dead_code)]
pub struct GroundBrush {
	pub id: u32,
	pub name: String,
	pub z_order: i32,
	pub items: Vec<(u16, i32)>,
	pub total_chance: i32,
	pub borders: Vec<BorderBlock>,
	pub friends: Vec<u32>,
	pub hate_friends: bool,
	pub has_zilch_outer: bool,
	pub has_zilch_inner: bool,
	pub has_outer: bool,
	pub has_inner: bool,
	pub optional_border_id: u32,
	pub use_only_optional: bool,
}

impl GroundBrush {
	pub fn pick_item(&self, roll: u32) -> Option<u16> {
		if self.total_chance <= 0 {
			return self.items.first().map(|&(id, _)| id);
		}
		let target = (roll % self.total_chance as u32) as i32;
		self.items
			.iter()
			.find(|&&(_, cumulative)| target < cumulative)
			.or_else(|| self.items.last())
			.map(|&(id, _)| id)
	}

	fn has_optional(&self) -> bool {
		self.optional_border_id != 0
	}
	fn has_outer_border(&self) -> bool {
		self.has_outer || self.has_optional()
	}
	fn has_inner_border(&self) -> bool {
		self.has_inner
	}
	fn has_outer_zilch(&self) -> bool {
		self.has_zilch_outer || self.has_optional()
	}
	fn has_inner_zilch(&self) -> bool {
		self.has_zilch_inner
	}
	fn friend_of(&self, other: &GroundBrush) -> bool {
		let found = self.friends.iter().any(|&f| f == other.id || f == TO_ALL);
		if found {
			!self.hate_friends
		} else {
			self.hate_friends
		}
	}
}

struct Cluster {
	alignment: u32,
	z: i32,
	border_id: u32,
}

impl Materials {
	fn get_brush_to<'a>(&'a self, first: Option<&'a GroundBrush>, second: Option<&'a GroundBrush>) -> Option<&'a BorderBlock> {
		match (first, second) {
			(Some(first), Some(second)) => {
				if first.z_order < second.z_order && second.has_outer_border() {
					if first.has_inner_border() {
						for bb in &first.borders {
							if bb.outer {
								continue;
							}
							if bb.to == second.id || bb.to == TO_ALL {
								return Some(bb);
							}
						}
					}
					for bb in &second.borders {
						if !bb.outer {
							continue;
						}
						if bb.to == first.id || bb.to == TO_ALL {
							return Some(bb);
						}
					}
					None
				} else if first.has_inner_border() {
					for bb in &first.borders {
						if bb.outer {
							continue;
						}
						if bb.to == second.id || bb.to == TO_ALL {
							return Some(bb);
						}
					}
					None
				} else {
					None
				}
			}
			(Some(first), None) => {
				if first.has_inner_zilch() {
					for bb in &first.borders {
						if !bb.outer && bb.to == TO_NONE {
							return Some(bb);
						}
					}
				}
				None
			}
			(None, Some(second)) => {
				if second.has_outer_zilch() {
					for bb in &second.borders {
						if bb.outer && bb.to == TO_NONE {
							return Some(bb);
						}
					}
				}
				None
			}
			(None, None) => None,
		}
	}

	pub fn calculate_borders(&self, own: u32, neighbours: &[u32; 8], optional: bool) -> BorderResult {
		let border_brush = self.brush(own);
		let mut visited = [false; 8];
		let neigh_brush: [Option<&GroundBrush>; 8] = std::array::from_fn(|i| self.brush(neighbours[i]));

		let mut clusters: Vec<Cluster> = Vec::new();
		let mut specifics: Vec<SpecificCase> = Vec::new();

		let mut push_cluster = |clusters: &mut Vec<Cluster>, bb: &BorderBlock, tiledata: u32, z: i32, raise: bool| {
			specifics.extend(bb.specifics.iter().cloned());
			let border_id = bb.border_id;
			if let Some(c) = clusters.iter_mut().find(|c| c.border_id == border_id) {
				c.alignment |= tiledata;
				if raise && c.z < z {
					c.z = z;
				} else if !raise {
					c.z = z;
				}
			} else {
				clusters.push(Cluster { alignment: tiledata, z, border_id });
			}
		};

		for i in 0..8 {
			if visited[i] {
				continue;
			}

			if let Some(border_brush) = border_brush {
				if let Some(other) = neigh_brush[i] {
					if other.id == border_brush.id {
						continue;
					}

					if other.has_outer_border() || border_brush.has_inner_border() {
						let are_friends = other.friend_of(border_brush) || border_brush.friend_of(other);
						let skip_normal = are_friends && !other.has_optional();
						let mut only_mountain = are_friends && other.has_optional();

						let mut tiledata = 0u32;
						for j in i..8 {
							if !visited[j] && neigh_brush[j].is_some_and(|b| b.id == other.id) {
								visited[j] = true;
								tiledata |= 1 << j;
							}
						}
						if tiledata != 0 {
							if optional && other.has_optional() {
								clusters.push(Cluster { alignment: tiledata, z: i32::MAX, border_id: other.optional_border_id });
								if other.use_only_optional {
									only_mountain = true;
								}
							}
							if !skip_normal && !only_mountain {
								if let Some(bb) = self.get_brush_to(Some(border_brush), Some(other)) {
									push_cluster(&mut clusters, bb, tiledata, other.z_order, true);
								}
							}
						}
					}

					let mut tiledata = 0u32;
					for j in i..8 {
						if !visited[j] && neigh_brush[j].is_none() {
							visited[j] = true;
							tiledata |= 1 << j;
						}
					}
					if tiledata != 0 {
						if let Some(bb) = self.get_brush_to(Some(border_brush), None) {
							push_cluster(&mut clusters, bb, tiledata, -1000, false);
						}
					}
					continue;
				} else {
					let mut tiledata = 0u32;
					for j in i..8 {
						if !visited[j] && neigh_brush[j].is_none() {
							visited[j] = true;
							tiledata |= 1 << j;
						}
					}
					if tiledata != 0 {
						if let Some(bb) = self.get_brush_to(Some(border_brush), None) {
							push_cluster(&mut clusters, bb, tiledata, -1000, false);
						}
					}
					continue;
				}
			} else if let Some(other) = neigh_brush[i] {
				if other.has_outer_zilch() {
					let mut tiledata = 0u32;
					for j in i..8 {
						if !visited[j] && neigh_brush[j].is_some_and(|b| b.id == other.id) {
							visited[j] = true;
							tiledata |= 1 << j;
						}
					}
					if tiledata != 0 {
						if let Some(bb) = self.get_brush_to(None, Some(other)) {
							push_cluster(&mut clusters, bb, tiledata, other.z_order, true);
						}
						if optional && other.has_optional() {
							clusters.push(Cluster { alignment: tiledata, z: i32::MAX, border_id: other.optional_border_id });
						}
					}
				}
			}
			visited[i] = true;
		}

		clusters.sort_by(|a, b| a.z.cmp(&b.z));

		let mut out = Vec::new();
		for cluster in &clusters {
			let Some(border) = self.borders.get(&cluster.border_id) else {
				continue;
			};
			let mask = (cluster.alignment & 0xFF) as u8;
			let packed = crate::scripting::border_type(mask).unwrap_or(self.border_types[mask as usize]);
			for shift in 0..4 {
				let direction = ((packed >> (shift * 8)) & 0xFF) as u8;
				if direction == BORDER_NONE {
					break;
				}
				let sid = border.tiles[direction as usize];
				if sid != 0 {
					out.push(sid);
				} else if let Some((h1, h2)) = diagonal_components(direction) {
					if border.tiles[h1 as usize] != 0 && border.tiles[h2 as usize] != 0 {
						out.push(border.tiles[h1 as usize]);
						out.push(border.tiles[h2 as usize]);
					}
				}
			}
		}
		BorderResult { items: out, specifics }
	}
}

#[cfg(test)]
mod tests {
	use super::GroundBrush;

	fn brush(chances: &[(u16, i32)]) -> GroundBrush {
		let mut items = Vec::new();
		let mut total = 0;
		for &(id, chance) in chances {
			total += chance;
			items.push((id, total));
		}
		GroundBrush { items, total_chance: total, ..Default::default() }
	}

	#[test]
	fn pick_item_follows_declared_weights() {
		let b = brush(&[(10, 70), (20, 20), (30, 10)]);
		let mut counts = [0usize; 3];
		for roll in 0..b.total_chance as u32 {
			match b.pick_item(roll).unwrap() {
				10 => counts[0] += 1,
				20 => counts[1] += 1,
				30 => counts[2] += 1,
				other => panic!("unexpected id {}", other),
			}
		}
		assert_eq!(counts, [70, 20, 10]);
	}

	#[test]
	fn pick_item_skips_zero_chance_and_survives_empty_totals() {
		let b = brush(&[(10, 0), (20, 5)]);
		assert!((0..5).all(|roll| b.pick_item(roll) == Some(20)));

		let flat = brush(&[(10, 0), (20, 0)]);
		assert_eq!(flat.pick_item(0), Some(10));
		assert_eq!(GroundBrush::default().pick_item(0), None);
	}
}
