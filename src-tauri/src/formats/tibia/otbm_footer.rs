use crate::map_model::Town;

const FOOTER_MAGIC: u32 = 0x4E46_4C52;
const FOOTER_VERSION: u16 = 7;

pub struct ChunkEntry {
	pub z: u8,
	pub cx: u16,
	pub cy: u16,
	pub start: u64,
	pub end: u64,
	pub count: u32,
}

pub struct MapIndex {
	pub chunks: Vec<ChunkEntry>,
	pub min_x: u16,
	pub min_y: u16,
	pub max_x: u16,
	pub max_y: u16,
	pub teleports: Vec<u8>,
	pub teleport_count: u32,
	pub description: String,
	pub spawn_file: String,
	pub house_file: String,
	pub otbm_version: u32,
	pub items_major: u32,
	pub items_minor: u32,
	pub towns: Vec<Town>,
	pub house_tile_count: u32,
}

impl MapIndex {
	pub fn encode(&self) -> Vec<u8> {
		let mut body: Vec<u8> = Vec::with_capacity(4 + self.chunks.len() * 25 + 12 + self.teleports.len());
		body.extend_from_slice(&(self.chunks.len() as u32).to_le_bytes());
		for c in &self.chunks {
			body.push(c.z);
			body.extend_from_slice(&c.cx.to_le_bytes());
			body.extend_from_slice(&c.cy.to_le_bytes());
			body.extend_from_slice(&c.start.to_le_bytes());
			body.extend_from_slice(&c.end.to_le_bytes());
			body.extend_from_slice(&c.count.to_le_bytes());
		}
		body.extend_from_slice(&self.min_x.to_le_bytes());
		body.extend_from_slice(&self.min_y.to_le_bytes());
		body.extend_from_slice(&self.max_x.to_le_bytes());
		body.extend_from_slice(&self.max_y.to_le_bytes());
		body.extend_from_slice(&self.teleport_count.to_le_bytes());
		body.extend_from_slice(&self.teleports);

		body.extend_from_slice(&self.otbm_version.to_le_bytes());
		body.extend_from_slice(&self.items_major.to_le_bytes());
		body.extend_from_slice(&self.items_minor.to_le_bytes());
		body.extend_from_slice(&self.house_tile_count.to_le_bytes());
		put_string(&mut body, &self.description);
		put_string(&mut body, &self.spawn_file);
		put_string(&mut body, &self.house_file);
		body.extend_from_slice(&(self.towns.len() as u32).to_le_bytes());
		for t in &self.towns {
			body.extend_from_slice(&t.id.to_le_bytes());
			put_string(&mut body, &t.name);
			body.extend_from_slice(&t.x.to_le_bytes());
			body.extend_from_slice(&t.y.to_le_bytes());
			body.push(t.z);
		}

		body.extend_from_slice(&FOOTER_VERSION.to_le_bytes());

		let len = body.len() as u32;
		body.extend_from_slice(&len.to_le_bytes());
		body.extend_from_slice(&FOOTER_MAGIC.to_le_bytes());
		body
	}

	pub fn decode(file: &[u8]) -> Option<MapIndex> {
		let n = file.len();
		if n < 8 {
			return None;
		}
		let magic = u32::from_le_bytes(file[n - 4..n].try_into().ok()?);
		if magic != FOOTER_MAGIC {
			return None;
		}
		let body_len = u32::from_le_bytes(file[n - 8..n - 4].try_into().ok()?) as usize;
		if body_len + 8 > n {
			return None;
		}
		let body = &file[n - 8 - body_len..n - 8];

		let mut r = Cur { b: body, p: 0 };
		let chunk_count = r.u32()? as usize;
		let mut chunks = Vec::with_capacity(chunk_count);
		for _ in 0..chunk_count {
			chunks.push(ChunkEntry {
				z: r.u8()?,
				cx: r.u16()?,
				cy: r.u16()?,
				start: r.u64()?,
				end: r.u64()?,
				count: r.u32()?,
			});
		}
		let min_x = r.u16()?;
		let min_y = r.u16()?;
		let max_x = r.u16()?;
		let max_y = r.u16()?;
		let teleport_count = r.u32()?;
		let teleports = r.take(teleport_count as usize * 10)?.to_vec();

		let otbm_version = r.u32()?;
		let items_major = r.u32()?;
		let items_minor = r.u32()?;
		let house_tile_count = r.u32()?;
		let description = r.string()?;
		let spawn_file = r.string()?;
		let house_file = r.string()?;
		let town_count = r.u32()? as usize;
		let mut towns = Vec::with_capacity(town_count);
		for _ in 0..town_count {
			let id = r.u32()?;
			let name = r.string()?;
			let x = r.u16()?;
			let y = r.u16()?;
			let z = r.u8()?;
			towns.push(Town { id, name, x, y, z });
		}

		let version = r.u16()?;
		if version != FOOTER_VERSION {
			return None;
		}
		Some(MapIndex {
			chunks,
			min_x,
			min_y,
			max_x,
			max_y,
			teleports,
			teleport_count,
			description,
			spawn_file,
			house_file,
			otbm_version,
			items_major,
			items_minor,
			towns,
			house_tile_count,
		})
	}
}

fn put_string(out: &mut Vec<u8>, s: &str) {
	out.extend_from_slice(&(s.len() as u32).to_le_bytes());
	out.extend_from_slice(s.as_bytes());
}

struct Cur<'a> {
	b: &'a [u8],
	p: usize,
}

impl<'a> Cur<'a> {
	fn take(&mut self, n: usize) -> Option<&'a [u8]> {
		let s = self.b.get(self.p..self.p + n)?;
		self.p += n;
		Some(s)
	}
	fn u8(&mut self) -> Option<u8> {
		Some(self.take(1)?[0])
	}
	fn u16(&mut self) -> Option<u16> {
		Some(u16::from_le_bytes(self.take(2)?.try_into().ok()?))
	}
	fn u32(&mut self) -> Option<u32> {
		Some(u32::from_le_bytes(self.take(4)?.try_into().ok()?))
	}
	fn string(&mut self) -> Option<String> {
		let len = self.u32()? as usize;
		let bytes = self.take(len)?;
		Some(String::from_utf8_lossy(bytes).into_owned())
	}
	fn u64(&mut self) -> Option<u64> {
		Some(u64::from_le_bytes(self.take(8)?.try_into().ok()?))
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn footer_round_trips_through_tail() {
		let idx = MapIndex {
			chunks: vec![
				ChunkEntry { z: 7, cx: 10, cy: 20, start: 100, end: 5000, count: 42 },
				ChunkEntry { z: 7, cx: 11, cy: 20, start: 5000, end: 9000, count: 17 },
				ChunkEntry { z: 8, cx: 10, cy: 20, start: 9000, end: 9500, count: 3 },
			],
			min_x: 1000,
			min_y: 2000,
			max_x: 1200,
			max_y: 2200,
			teleports: vec![1, 0, 2, 0, 7, 3, 0, 4, 0, 8],
			teleport_count: 1,
			description: "Test Map".to_string(),
			spawn_file: "world-spawn.xml".to_string(),
			house_file: "world-house.xml".to_string(),
			otbm_version: 2,
			items_major: 3,
			items_minor: 860,
			towns: vec![Town { id: 1, name: "Thais".to_string(), x: 100, y: 200, z: 7 }],
			house_tile_count: 12,
		};
		let mut file = vec![0xAAu8; 64];
		file.extend_from_slice(&idx.encode());

		let got = MapIndex::decode(&file).expect("footer decodes");
		assert_eq!(got.chunks.len(), 3);
		assert_eq!(got.description, "Test Map");
		assert_eq!(got.towns.len(), 1);
		assert_eq!(got.towns[0].name, "Thais");
		assert_eq!(got.house_tile_count, 12);
		assert_eq!(got.chunks[0].cx, 10);
		assert_eq!(got.chunks[1].end, 9000);
		assert_eq!(got.chunks[2].z, 8);
		assert_eq!((got.min_x, got.min_y, got.max_x, got.max_y), (1000, 2000, 1200, 2200));
		assert_eq!(got.teleport_count, 1);
		assert_eq!(got.teleports.len(), 10);
	}

	#[test]
	fn decode_rejects_files_without_magic() {
		assert!(MapIndex::decode(&[0u8; 100]).is_none());
		assert!(MapIndex::decode(&[]).is_none());
	}
}
