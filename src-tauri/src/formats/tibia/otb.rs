use std::collections::HashMap;

use super::nodefile::{parse_node_file, Cursor};

const ROOT_ATTR_VERSION: u8 = 0x01;
const ITEM_ATTR_SERVERID: u8 = 0x10;
const ITEM_ATTR_CLIENTID: u8 = 0x11;

#[derive(Default)]
pub struct OtbItems {
	pub server_to_client: HashMap<u16, u16>,
	pub server_to_group: HashMap<u16, u8>,
	pub server_to_type: HashMap<u16, String>,
}

pub const OTB_GROUP_GROUND: u8 = 1;
pub const OTB_GROUP_CONTAINER: u8 = 2;
pub const OTB_GROUP_TELEPORT: u8 = 7;
pub const OTB_GROUP_MAGICFIELD: u8 = 8;
pub const OTB_GROUP_WRITEABLE: u8 = 9;
pub const OTB_GROUP_DOOR: u8 = 13;

impl OtbItems {
	pub fn client_id(&self, server_id: u16) -> Option<u16> {
		self.server_to_client.get(&server_id).copied()
	}

	pub fn group(&self, server_id: u16) -> u8 {
		self.server_to_group.get(&server_id).copied().unwrap_or(0)
	}

	pub fn kind(&self, server_id: u16) -> &str {
		self.server_to_type.get(&server_id).map(String::as_str).unwrap_or("")
	}
}

pub fn parse_item_types(xml: &str) -> HashMap<u16, String> {
	let mut out = HashMap::new();
	let Ok(doc) = roxmltree::Document::parse(xml) else {
		return out;
	};
	for item in doc.descendants().filter(|n| n.has_tag_name("item")) {
		let kind = item
			.children()
			.filter(|c| c.has_tag_name("attribute"))
			.find(|c| c.attribute("key").is_some_and(|k| k.eq_ignore_ascii_case("type")))
			.and_then(|c| c.attribute("value"));
		let Some(kind) = kind else { continue };
		if let Some(id) = item.attribute("id").and_then(|v| v.parse::<u16>().ok()) {
			out.insert(id, kind.to_string());
		} else if let (Some(from), Some(to)) = (
			item.attribute("fromid").and_then(|v| v.parse::<u16>().ok()),
			item.attribute("toid").and_then(|v| v.parse::<u16>().ok()),
		) {
			for id in from..=to {
				out.insert(id, kind.to_string());
			}
		}
	}
	out
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
	let mut server_to_group: HashMap<u16, u8> = HashMap::new();

	for item in &root.children {
		let group = item.kind;
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
				server_to_group.insert(s, group);
			}
		}
	}

	if server_to_client.is_empty() {
		return Err("otb: no item definitions parsed".into());
	}

	Ok(OtbItems { server_to_client, server_to_group, server_to_type: HashMap::new() })
}
