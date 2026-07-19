use std::cell::{Cell, RefCell};
use std::collections::HashMap;

use crate::lua_host::LuaHost;

thread_local! {
	static CTX: Cell<*const LuaHost> = const { Cell::new(std::ptr::null()) };
	static CLASS_CACHE: RefCell<HashMap<(bool, bool, u8), i32>> = RefCell::new(HashMap::new());
	static WALL_CACHE: RefCell<HashMap<(u8, bool), Option<u8>>> = RefCell::new(HashMap::new());
	static BORDER_CACHE: RefCell<HashMap<u8, Option<u32>>> = RefCell::new(HashMap::new());
	static ALLOW_CACHE: RefCell<HashMap<(u16, bool), bool>> = RefCell::new(HashMap::new());
}

pub struct ScopedLua;

impl ScopedLua {
	pub fn enter(host: &LuaHost) -> Self {
		CTX.with(|c| c.set(host as *const LuaHost));
		CLASS_CACHE.with(|c| c.borrow_mut().clear());
		WALL_CACHE.with(|c| c.borrow_mut().clear());
		BORDER_CACHE.with(|c| c.borrow_mut().clear());
		ALLOW_CACHE.with(|c| c.borrow_mut().clear());
		ScopedLua
	}
}

impl Drop for ScopedLua {
	fn drop(&mut self) {
		CTX.with(|c| c.set(std::ptr::null()));
		CLASS_CACHE.with(|c| c.borrow_mut().clear());
		WALL_CACHE.with(|c| c.borrow_mut().clear());
		BORDER_CACHE.with(|c| c.borrow_mut().clear());
		ALLOW_CACHE.with(|c| c.borrow_mut().clear());
	}
}

fn host() -> Option<&'static LuaHost> {
	CTX.with(|c| {
		let p = c.get();
		if p.is_null() {
			None
		} else {
			Some(unsafe { &*p })
		}
	})
}

fn native_stack_class(is_ground: bool, is_border: bool, top_order: u8) -> i32 {
	if is_ground {
		-1
	} else if is_border {
		0
	} else {
		match top_order {
			1 => 1,
			2 => 2,
			3 => 3,
			_ => 1000,
		}
	}
}

fn lua_stack_class(h: &LuaHost, is_ground: bool, is_border: bool, top_order: u8) -> Option<i32> {
	let forge: mlua::Table = h.lua.globals().get("forge").ok()?;
	let f: mlua::Function = forge.get("stack_class").ok()?;
	f.call::<i32>((is_ground, is_border, top_order)).ok()
}

pub fn stack_class(is_ground: bool, is_border: bool, top_order: u8) -> i32 {
	let key = (is_ground, is_border, top_order);
	if let Some(v) = CLASS_CACHE.with(|c| c.borrow().get(&key).copied()) {
		return v;
	}
	let v = host()
		.and_then(|h| lua_stack_class(h, is_ground, is_border, top_order))
		.unwrap_or_else(|| native_stack_class(is_ground, is_border, top_order));
	CLASS_CACHE.with(|c| c.borrow_mut().insert(key, v));
	v
}

pub fn ground_class() -> i32 {
	stack_class(true, false, 0)
}

pub fn border_class() -> i32 {
	stack_class(false, true, 0)
}

fn lua_wall_segment(h: &LuaHost, mask: u8, half: bool) -> Option<u8> {
	let forge: mlua::Table = h.lua.globals().get("forge").ok()?;
	let f: mlua::Function = forge.get("wall_segment").ok()?;
	f.call::<Option<u8>>((mask, half)).ok().flatten()
}

pub fn wall_segment(mask: u8, half: bool) -> Option<u8> {
	let key = (mask, half);
	if let Some(v) = WALL_CACHE.with(|c| c.borrow().get(&key).copied()) {
		return v;
	}
	let v = host().and_then(|h| lua_wall_segment(h, mask, half));
	WALL_CACHE.with(|c| c.borrow_mut().insert(key, v));
	v
}

fn lua_border_type(h: &LuaHost, mask: u8) -> Option<u32> {
	let forge: mlua::Table = h.lua.globals().get("forge").ok()?;
	let f: mlua::Function = forge.get("border_type").ok()?;
	f.call::<Option<u32>>(mask).ok().flatten()
}

pub fn border_type(mask: u8) -> Option<u32> {
	if let Some(v) = BORDER_CACHE.with(|c| c.borrow().get(&mask).copied()) {
		return v;
	}
	let v = host().and_then(|h| lua_border_type(h, mask));
	BORDER_CACHE.with(|c| c.borrow_mut().insert(mask, v));
	v
}

fn lua_allow_place(h: &LuaHost, server: u16, has_ground: bool) -> Option<bool> {
	let forge: mlua::Table = h.lua.globals().get("forge").ok()?;
	let f: mlua::Function = forge.get("allow_place").ok()?;
	f.call::<bool>((server, has_ground)).ok()
}

pub fn allow_place(server: u16, has_ground: bool) -> bool {
	let key = (server, has_ground);
	if let Some(v) = ALLOW_CACHE.with(|c| c.borrow().get(&key).copied()) {
		return v;
	}
	let v = host().and_then(|h| lua_allow_place(h, server, has_ground)).unwrap_or(true);
	ALLOW_CACHE.with(|c| c.borrow_mut().insert(key, v));
	v
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::lua_host::LuaHost;
	use std::path::PathBuf;

	#[test]
	fn native_fallback_without_scope() {
		assert_eq!(stack_class(true, false, 0), -1);
		assert_eq!(stack_class(false, true, 0), 0);
		assert_eq!(stack_class(false, false, 2), 2);
		assert_eq!(stack_class(false, false, 0), 1000);
	}

	#[test]
	fn lua_override_is_consulted() {
		let host = LuaHost::new(PathBuf::from("."));
		host.lua
			.load("forge = {}\nfunction forge.stack_class(g, b, t) return 777 end")
			.exec()
			.unwrap();
		let _s = ScopedLua::enter(&host);
		assert_eq!(stack_class(false, false, 0), 777, "lua hook must drive class");
	}

	#[test]
	fn ffi_bulk_read_and_write() {
		use mlua::{Function, LightUserData, Table};
		use std::ffi::c_void;
		let host = LuaHost::new(PathBuf::from("."));
		host.lua
			.load(
				"forge = {}\n\
				 local ffi = require('ffi')\n\
				 function forge.count_nonzero(src, n)\n\
				   local p = ffi.cast('const uint16_t*', src)\n\
				   local c = 0\n\
				   for i = 0, n - 1 do if p[i] ~= 0 then c = c + 1 end end\n\
				   return c\n\
				 end\n\
				 function forge.scale_u16(src, dst, n, k)\n\
				   local s = ffi.cast('const uint16_t*', src)\n\
				   local d = ffi.cast('uint16_t*', dst)\n\
				   for i = 0, n - 1 do d[i] = s[i] * k end\n\
				 end",
			)
			.exec()
			.unwrap();
		let forge: Table = host.lua.globals().get("forge").unwrap();

		let src: Vec<u16> = vec![0, 1, 2, 0, 7];
		let count: u32 = forge
			.get::<Function>("count_nonzero")
			.unwrap()
			.call((LightUserData(src.as_ptr() as *mut c_void), src.len()))
			.unwrap();
		assert_eq!(count, 3, "ffi read loop counts nonzero u16 over a rust-owned array");

		let mut dst: Vec<u16> = vec![0; src.len()];
		forge
			.get::<Function>("scale_u16")
			.unwrap()
			.call::<()>((
				LightUserData(src.as_ptr() as *mut c_void),
				LightUserData(dst.as_mut_ptr() as *mut c_void),
				src.len(),
				3u16,
			))
			.unwrap();
		assert_eq!(dst, vec![0, 3, 6, 0, 21], "ffi write loop scales into a rust staging buffer");
	}

	#[test]
	fn scoped_host_without_hooks_stays_native() {
		let host = LuaHost::new(PathBuf::from("."));
		host.lua.load("forge = {}").exec().unwrap();
		let _s = ScopedLua::enter(&host);
		assert_eq!(stack_class(true, false, 0), -1);
		assert_eq!(stack_class(false, true, 0), 0);
		assert_eq!(stack_class(false, false, 3), 3);
		assert_eq!(stack_class(false, false, 9), 1000);
	}
}
