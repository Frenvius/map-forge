use std::collections::HashMap;

use super::nodefile::{parse_node_file, Cursor};

const ROOT_ATTR_VERSION: u8 = 0x01;
const ITEM_ATTR_SERVERID: u8 = 0x10;
const ITEM_ATTR_CLIENTID: u8 = 0x11;

#[derive(Default)]
pub struct OtbItems {
	pub server_to_client: HashMap<u16, u16>,
}

impl OtbItems {
	pub fn client_id(&self, server_id: u16) -> Option<u16> {
		self.server_to_client.get(&server_id).copied()
	}
}

pub fn parse_otb(bytes: &[u8]) -> Result<OtbItems, String> {
	let root = parse_node_file(bytes)?;

	// Root payload (type byte already consumed as node kind):
	// [flags u32][ROOT_ATTR_VERSION u8][version_len u16][major u32][minor u32][build u32][tail...]
	let mut c = Cursor::new(&root.data);
	c.u32().ok_or("otb: missing root flags")?;
	let attr = c.u8().ok_or("otb: missing root version attribute")?;
	if attr != ROOT_ATTR_VERSION {
		return Err("otb: expected ROOT_ATTR_VERSION".into());
	}
	let version_len = c.u16().ok_or("otb: missing version length")? as usize;
	c.u32().ok_or("otb: missing major version")?;
	c.u32().ok_or("otb: missing minor version")?;
	c.u32().ok_or("otb: missing build number")?;
	// Skip the remainder of the version payload (12 bytes already read of version_len).
	if version_len > 12 {
		c.skip(version_len - 12);
	}

	let mut server_to_client: HashMap<u16, u16> = HashMap::new();

	for item in &root.children {
		// Item node payload (group byte already consumed as node kind):
		// [flags u32][ (u8 attr)(u16 len)(payload) ... ]
		let mut ic = Cursor::new(&item.data);
		if ic.u32().is_none() {
			continue;
		}

		let mut server_id: Option<u16> = None;
		let mut client_id: Option<u16> = None;

		while let Some(a) = ic.u8() {
			let len = match ic.u16() {
				Some(l) => l as usize,
				None => break,
			};
			match a {
				ITEM_ATTR_SERVERID => {
					if len == 2 {
						server_id = ic.u16();
					} else {
						ic.skip(len);
					}
				}
				ITEM_ATTR_CLIENTID => {
					if len == 2 {
						client_id = ic.u16();
					} else {
						ic.skip(len);
					}
				}
				_ => {
					ic.skip(len);
				}
			}
		}

		if let (Some(s), Some(cid)) = (server_id, client_id) {
			if s != 0 {
				server_to_client.insert(s, cid);
			}
		}
	}

	if server_to_client.is_empty() {
		return Err("otb: no item definitions parsed".into());
	}

	Ok(OtbItems { server_to_client })
}
