const NODE_START: u8 = 0xFE;
const NODE_END: u8 = 0xFF;
const ESCAPE_CHAR: u8 = 0xFD;

pub struct Node {
	pub kind: u8,
	pub data: Vec<u8>,
	pub children: Vec<Node>,
}

pub fn parse_node_file(bytes: &[u8]) -> Result<Node, String> {
	if bytes.len() < 5 {
		return Err("file too small to be a node-tree".into());
	}
	let mut pos = 4;
	if bytes[pos] != NODE_START {
		return Err("missing root node start byte".into());
	}
	pos += 1;
	let (root, _) = read_node(bytes, pos, 0)?;
	Ok(root)
}

fn read_node(bytes: &[u8], mut pos: usize, depth: u32) -> Result<(Node, usize), String> {
	if depth > 512 {
		return Err("node nesting too deep".into());
	}

	let mut kind = 0u8;
	let mut first = true;
	let mut data: Vec<u8> = Vec::new();
	let mut children: Vec<Node> = Vec::new();

	loop {
		let b = *bytes.get(pos).ok_or("premature end of node-tree")?;
		pos += 1;

		match b {
			ESCAPE_CHAR => {
				let lit = *bytes.get(pos).ok_or("premature end after escape")?;
				pos += 1;
				if first {
					kind = lit;
					first = false;
				} else {
					data.push(lit);
				}
			}
			NODE_START => {
				let (child, next) = read_node(bytes, pos, depth + 1)?;
				pos = next;
				children.push(child);
			}
			NODE_END => break,
			_ => {
				if first {
					kind = b;
					first = false;
				} else {
					data.push(b);
				}
			}
		}
	}

	Ok((Node { kind, data, children }, pos))
}

pub struct Cursor<'a> {
	data: &'a [u8],
	pos: usize,
}

impl<'a> Cursor<'a> {
	pub fn new(data: &'a [u8]) -> Self {
		Cursor { data, pos: 0 }
	}

	pub fn u8(&mut self) -> Option<u8> {
		let v = *self.data.get(self.pos)?;
		self.pos += 1;
		Some(v)
	}

	pub fn u16(&mut self) -> Option<u16> {
		if self.pos + 2 > self.data.len() {
			return None;
		}
		let v = u16::from_le_bytes([self.data[self.pos], self.data[self.pos + 1]]);
		self.pos += 2;
		Some(v)
	}

	pub fn u32(&mut self) -> Option<u32> {
		if self.pos + 4 > self.data.len() {
			return None;
		}
		let v = u32::from_le_bytes([
			self.data[self.pos],
			self.data[self.pos + 1],
			self.data[self.pos + 2],
			self.data[self.pos + 3],
		]);
		self.pos += 4;
		Some(v)
	}

	pub fn skip(&mut self, n: usize) -> bool {
		if self.pos + n > self.data.len() {
			self.pos = self.data.len();
			return false;
		}
		self.pos += n;
		true
	}
}
