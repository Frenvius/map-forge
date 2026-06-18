const NODE_START: u8 = 0xFE;
const NODE_END: u8 = 0xFF;
const ESCAPE_CHAR: u8 = 0xFD;

pub struct NodeWriter {
	buf: Vec<u8>,
}

impl NodeWriter {
	pub fn with_capacity(cap: usize) -> Self {
		NodeWriter { buf: Vec::with_capacity(cap) }
	}

	pub fn pos(&self) -> usize {
		self.buf.len()
	}

	pub fn into_bytes(self) -> Vec<u8> {
		self.buf
	}

	pub fn identifier(&mut self, id: &[u8]) {
		self.buf.extend_from_slice(id);
	}

	pub fn node_start(&mut self, node_type: u8) {
		self.buf.push(NODE_START);
		self.buf.push(node_type);
	}

	pub fn node_end(&mut self) {
		self.buf.push(NODE_END);
	}

	fn escaped(&mut self, b: u8) {
		if b == NODE_START || b == NODE_END || b == ESCAPE_CHAR {
			self.buf.push(ESCAPE_CHAR);
		}
		self.buf.push(b);
	}

	pub fn u8(&mut self, v: u8) {
		self.escaped(v);
	}

	pub fn u16(&mut self, v: u16) {
		for b in v.to_le_bytes() {
			self.escaped(b);
		}
	}

	pub fn u32(&mut self, v: u32) {
		for b in v.to_le_bytes() {
			self.escaped(b);
		}
	}

	pub fn string(&mut self, s: &str) {
		self.u16(s.len() as u16);
		for &b in s.as_bytes() {
			self.escaped(b);
		}
	}

	pub fn raw_escaped(&mut self, bytes: &[u8]) {
		self.buf.extend_from_slice(bytes);
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn escapes_structural_bytes_in_values() {
		let mut w = NodeWriter::with_capacity(16);
		w.u16(0xFEFD);
		assert_eq!(w.into_bytes(), vec![ESCAPE_CHAR, 0xFD, ESCAPE_CHAR, 0xFE]);
	}

	#[test]
	fn node_markers_and_type_are_raw() {
		let mut w = NodeWriter::with_capacity(8);
		w.node_start(5);
		w.u8(0x10);
		w.node_end();
		assert_eq!(w.into_bytes(), vec![NODE_START, 5, 0x10, NODE_END]);
	}
}
