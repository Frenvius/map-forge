use crate::formats::{DatOverrides, MetadataProvider, MetadataResult, ItemDatabaseProvider};
use super::dat_reader::{encode_dat_to_binary, DatReader};
use super::otb::{parse_otb, OtbItems};

pub struct TibiaMetadataProvider;

impl MetadataProvider for TibiaMetadataProvider {
    fn read_metadata(&mut self, path: &str, version: u32, overrides: DatOverrides) -> Result<MetadataResult, String> {
        let mut reader = DatReader::open(path)?;
        reader.set_version(version);
        reader.apply_overrides(overrides.extended, overrides.frame_durations, overrides.frame_groups);
        let (signature, items, outfits, effects, missiles) =
            reader.read_dat().map_err(|e| format!("DAT parse error (version {}): {}", version, e))?;

        let mut placement = Vec::with_capacity(items.len());
        for it in &items {
            let top_order = if it.is_ground_border {
                1
            } else if it.is_on_bottom {
                2
            } else if it.is_on_top {
                3
            } else {
                0
            };
            if it.is_ground || top_order != 0 || it.is_unpassable {
                placement.push((it.id as u16, it.is_ground, top_order, it.is_unpassable));
            }
        }

        let encoded = encode_dat_to_binary(signature, &items, &outfits, &effects, &missiles);
        Ok(MetadataResult { encoded, placement })
    }
}

pub struct TibiaItemDatabase {
    items: Option<OtbItems>,
}

impl TibiaItemDatabase {
    pub fn new() -> Self {
        Self { items: None }
    }

    pub fn otb(&self) -> Option<&OtbItems> {
        self.items.as_ref()
    }
}

impl ItemDatabaseProvider for TibiaItemDatabase {
    fn load(&mut self, bytes: &[u8]) -> Result<usize, String> {
        let items = parse_otb(bytes)?;
        let count = items.server_to_client.len();
        self.items = Some(items);
        Ok(count)
    }

    fn client_id(&self, server_id: u16) -> Option<u16> {
        self.items.as_ref().and_then(|i| i.client_id(server_id))
    }

    fn all_server_ids(&self) -> Vec<u16> {
        match &self.items {
            Some(items) => {
                let mut ids: Vec<u16> = items.server_to_client.keys().copied().collect();
                ids.sort_unstable();
                ids
            }
            None => Vec::new(),
        }
    }
}
