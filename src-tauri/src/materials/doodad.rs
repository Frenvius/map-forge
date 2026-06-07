use super::Materials;

#[derive(Clone)]
pub(crate) struct DoodadComposite {
	pub(crate) chance: i32,
	pub(crate) tiles: Vec<(i32, i32, Vec<u16>)>,
}

#[derive(Clone)]
#[allow(dead_code)]
pub struct DoodadBrush {
	pub id: u32,
	pub name: String,
	pub(crate) singles: Vec<(u16, i32)>,
	pub(crate) composites: Vec<DoodadComposite>,
}

impl Materials {
	pub fn doodad_brush_for(&self, server_id: u16) -> Option<u32> {
		self.server_to_doodad.get(&server_id).copied()
	}

	pub fn doodad_placement(&self, own: u32, seed: u32) -> Vec<(i32, i32, u16)> {
		let Some(d) = self.doodads.get(own.checked_sub(1).unwrap_or(u32::MAX) as usize) else {
			return Vec::new();
		};
		let singles_total: i32 = d.singles.iter().map(|(_, c)| (*c).max(0)).sum();
		let composites_total: i32 = d.composites.iter().map(|c| c.chance.max(0)).sum();
		let total = singles_total + composites_total;
		if total <= 0 {
			return d.singles.first().map(|&(id, _)| vec![(0, 0, id)]).unwrap_or_default();
		}

		let mut roll = (seed % total as u32) as i32;
		for &(id, chance) in &d.singles {
			let chance = chance.max(0);
			if roll < chance {
				return vec![(0, 0, id)];
			}
			roll -= chance;
		}
		for comp in &d.composites {
			let chance = comp.chance.max(0);
			if roll < chance {
				return comp.tiles.iter().flat_map(|(dx, dy, items)| items.iter().map(move |&id| (*dx, *dy, id))).collect();
			}
			roll -= chance;
		}
		Vec::new()
	}
}
