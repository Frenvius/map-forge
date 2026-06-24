#[cfg(feature = "tibia")]
pub mod tibia;

use std::sync::{Arc, Mutex};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct SpriteHeader {
    pub signature: u32,
    pub sprite_count: u32,
    pub extended: bool,
    pub sprite_size: u32,
}

pub trait SpriteProvider: Send + Sync {
    fn sprite_size(&self) -> u32;
    fn open(&mut self, path: &str, extended: bool) -> Result<SpriteHeader, String>;
    fn close(&mut self, path: &str) -> Result<(), String>;
    fn read_sprites_rgba(&mut self, path: &str, ids: &[u32], transparent: bool) -> Result<Vec<u8>, String>;
    fn read_sprites_batch_rgba(&mut self, path: &str, start_id: u32, count: u32, transparent: bool) -> Result<Vec<u8>, String>;
    fn read_sprites_rgba_lz4(&mut self, path: &str, ids: &[u32], transparent: bool) -> Result<Vec<u8>, String>;
}

pub struct MetadataResult {
    pub encoded: Vec<u8>,
    pub placement: Vec<(u16, bool, u8)>,
}

pub trait MetadataProvider: Send + Sync {
    fn read_metadata(&mut self, path: &str, version: u32) -> Result<MetadataResult, String>;
}

pub trait ItemDatabaseProvider: Send + Sync {
    fn load(&mut self, bytes: &[u8]) -> Result<usize, String>;
    fn client_id(&self, server_id: u16) -> Option<u16>;
    fn all_server_ids(&self) -> Vec<u16>;
}

pub struct FormatManager {
    sprite: Box<dyn SpriteProvider>,
    metadata: Box<dyn MetadataProvider>,
    item_db: Box<dyn ItemDatabaseProvider>,
}

impl FormatManager {
    pub fn new(
        sprite: Box<dyn SpriteProvider>,
        metadata: Box<dyn MetadataProvider>,
        item_db: Box<dyn ItemDatabaseProvider>,
    ) -> Self {
        Self { sprite, metadata, item_db }
    }

    pub fn sprite(&mut self) -> &mut dyn SpriteProvider {
        &mut *self.sprite
    }

    pub fn set_sprite(&mut self, sprite: Box<dyn SpriteProvider>) {
        self.sprite = sprite;
    }

    pub fn metadata(&mut self) -> &mut dyn MetadataProvider {
        &mut *self.metadata
    }

    pub fn item_db(&self) -> &dyn ItemDatabaseProvider {
        &*self.item_db
    }

    pub fn item_db_mut(&mut self) -> &mut dyn ItemDatabaseProvider {
        &mut *self.item_db
    }
}

pub type FormatManagerState = Arc<Mutex<FormatManager>>;
