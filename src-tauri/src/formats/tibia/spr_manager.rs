use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom, BufReader};
use std::sync::{Arc, Mutex};
use serde::Serialize;
use rayon::prelude::*;

const DEFAULT_SPRITE_SIZE: usize = 32;

pub use crate::formats::SpriteHeader as SprHeader;

/// Sprite data returned to frontend
#[derive(Debug, Clone, Serialize)]
pub struct SpriteData {
    pub id: u32,
    pub is_empty: bool,
    #[serde(with = "serde_bytes")]
    pub compressed_pixels: Vec<u8>,
}

/// SPR file reader that keeps file handle open
pub struct SprFileReader {
    file: BufReader<File>,
    header: SprHeader,
    header_size: u64,
}

impl SprFileReader {
    /// Open and read SPR file header
    pub fn open(path: &str, extended: bool) -> Result<Self, String> {
        let file = File::open(path)
            .map_err(|e| format!("Failed to open SPR file: {}", e))?;
        
        let mut reader = BufReader::new(file);

        // Read signature (4 bytes)
        let mut sig_buf = [0u8; 4];
        reader.read_exact(&mut sig_buf)
            .map_err(|e| format!("Failed to read signature: {}", e))?;
        let signature = u32::from_le_bytes(sig_buf);

        // Read sprite count (2 or 4 bytes depending on extended)
        let sprite_count = if extended {
            let mut count_buf = [0u8; 4];
            reader.read_exact(&mut count_buf)
                .map_err(|e| format!("Failed to read sprite count: {}", e))?;
            u32::from_le_bytes(count_buf)
        } else {
            let mut count_buf = [0u8; 2];
            reader.read_exact(&mut count_buf)
                .map_err(|e| format!("Failed to read sprite count: {}", e))?;
            u16::from_le_bytes(count_buf) as u32
        };

        let header_size = if extended { 8 } else { 6 };

        let header = SprHeader {
            signature,
            sprite_count,
            extended,
            sprite_size: DEFAULT_SPRITE_SIZE as u32,
        };

        Ok(Self {
            file: reader,
            header,
            header_size,
        })
    }

    /// Read a specific sprite by ID (1-indexed)
    pub fn read_sprite(&mut self, id: u32) -> Result<SpriteData, String> {
        if id == 0 || id > self.header.sprite_count {
            return Err(format!(
                "Invalid sprite ID: {} (valid range: 1-{})",
                id, self.header.sprite_count
            ));
        }

        // Calculate address position (4 bytes per sprite address)
        let address_pos = self.header_size + ((id - 1) * 4) as u64;

        // Seek to address position
        self.file.seek(SeekFrom::Start(address_pos))
            .map_err(|e| format!("Failed to seek to address: {}", e))?;

        // Read sprite data address (4 bytes)
        let mut addr_buf = [0u8; 4];
        self.file.read_exact(&mut addr_buf)
            .map_err(|e| format!("Failed to read sprite address: {}", e))?;
        let address = u32::from_le_bytes(addr_buf);

        // If address is 0, sprite is empty
        if address == 0 {
            return Ok(SpriteData {
                id,
                is_empty: true,
                compressed_pixels: Vec::new(),
            });
        }

        // Seek to sprite data (skip 3 bytes RGB header)
        let data_start = address as u64 + 3;
        self.file.seek(SeekFrom::Start(data_start))
            .map_err(|e| format!("Failed to seek to sprite data: {}", e))?;

        // Read compressed data length (2 bytes)
        let mut len_buf = [0u8; 2];
        self.file.read_exact(&mut len_buf)
            .map_err(|e| format!("Failed to read data length: {}", e))?;
        let length = u16::from_le_bytes(len_buf);

        // If length is 0, sprite is empty
        if length == 0 {
            return Ok(SpriteData {
                id,
                is_empty: true,
                compressed_pixels: Vec::new(),
            });
        }

        // Read compressed pixel data
        let mut compressed_pixels = vec![0u8; length as usize];
        self.file.read_exact(&mut compressed_pixels)
            .map_err(|e| format!("Failed to read sprite data: {}", e))?;

        Ok(SpriteData {
            id,
            is_empty: false,
            compressed_pixels,
        })
    }

    pub fn get_header(&self) -> &SprHeader {
        &self.header
    }
}

pub struct SprManager {
    pub sprite_size: usize,
    readers: HashMap<String, SprFileReader>,
    overrides: HashMap<String, HashMap<u32, SpriteData>>,
}

impl SprManager {
    pub fn new() -> Self {
        Self::with_sprite_size(DEFAULT_SPRITE_SIZE)
    }

    pub fn with_sprite_size(sprite_size: usize) -> Self {
        Self {
            sprite_size,
            readers: HashMap::new(),
            overrides: HashMap::new(),
        }
    }

    fn sprite_data_size(&self) -> usize {
        self.sprite_size * self.sprite_size * 4
    }

    pub fn open_file(&mut self, path: String, extended: bool) -> Result<SprHeader, String> {
        let reader = SprFileReader::open(&path, extended)?;
        let header = reader.get_header().clone();
        self.readers.insert(path.clone(), reader);
        self.overrides.entry(path).or_default();
        Ok(header)
    }

    pub fn close_file(&mut self, path: &str) -> Result<(), String> {
        // Remove the reader if it exists, silently succeed if not
        // This allows cleanup to be called safely even if file wasn't opened
        self.readers.remove(path);
        Ok(())
    }

    /// Read multiple sprites at once (batch operation).
    pub fn read_sprites_batch(&mut self, path: &str, start_id: u32, count: u32) -> Result<Vec<SpriteData>, String> {
        if count == 0 {
            return Ok(Vec::new());
        }
        let ids: Vec<u32> = (start_id..start_id + count).collect();
        self.read_sprites_list(path, ids)
    }

    /// Read a list of specific sprite IDs efficiently
    pub fn read_sprites_list(&mut self, path: &str, ids: Vec<u32>) -> Result<Vec<SpriteData>, String> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }

        // Remove duplicates and sort
        let mut sorted_ids = ids.clone();
        sorted_ids.sort_unstable();
        sorted_ids.dedup();

        let reader = self.readers.get_mut(path)
            .ok_or_else(|| format!("SPR file not open: {}", path))?;
        let max_id = reader.get_header().sprite_count;

        // Split IDs into file_ids and overridden_sprites
        // Note: New sprites from import will have IDs > max_id, so we must check overrides BEFORE validating against max_id.
        let mut file_ids = Vec::new();
        let mut result_sprites = Vec::new();
        
        let path_overrides = self.overrides.get(path);

        for id in sorted_ids {
            // 1. Check overrides first (covers both replaced existing sprites and new appended sprites)
            if let Some(overrides) = path_overrides {
                if let Some(sprite) = overrides.get(&id) {
                    result_sprites.push(sprite.clone());
                    continue;
                }
            }

            // 2. If not overridden, check if it's a valid file ID
            if id > 0 && id <= max_id {
                file_ids.push(id);
            }
            // Else: ID is out of range and not overridden -> invalid, ignored
        }

        if file_ids.is_empty() {
             return Ok(result_sprites);
        }

        // Use reader to get remaining sprites
        let reader = self.readers.get_mut(path).unwrap(); // valid

        let mut sprites = Vec::with_capacity(file_ids.len());

        // OPTIMIZATION: Read all addresses for the requested IDs
        // Group IDs into chunks where gaps are small (< 100 IDs)
        let mut chunks: Vec<Vec<u32>> = Vec::new();
        let mut current_chunk: Vec<u32> = Vec::new();
        
        for &id in &file_ids {
            if current_chunk.is_empty() {
                current_chunk.push(id);
            } else {
                let last_id = *current_chunk.last().unwrap();
                if id - last_id < 100 {
                    current_chunk.push(id);
                } else {
                    chunks.push(current_chunk);
                    current_chunk = vec![id];
                }
            }
        }
        if !current_chunk.is_empty() {
            chunks.push(current_chunk);
        }

        // Process each chunk
        for chunk in chunks {
            if chunk.is_empty() { continue; }
            
            let start_id = chunk[0];
            let end_id = *chunk.last().unwrap();
            let count = end_id - start_id + 1;

            // Read addresses for this chunk
            let start_offset = reader.header_size + ((start_id - 1) as u64 * 4);
            
            reader.file.seek(SeekFrom::Start(start_offset))
                .map_err(|e| format!("Failed to seek to address table: {}", e))?;

            let mut addresses_buf = vec![0u8; (count * 4) as usize];
            reader.file.read_exact(&mut addresses_buf)
                .map_err(|e| format!("Failed to read address table: {}", e))?;

            // Collect valid file positions
            let mut valid_sprites = Vec::with_capacity(chunk.len());
            
            for &id in &chunk {
                let offset_idx = (id - start_id) as usize;
                let offset = offset_idx * 4;
                
                let address = u32::from_le_bytes([
                    addresses_buf[offset],
                    addresses_buf[offset + 1],
                    addresses_buf[offset + 2],
                    addresses_buf[offset + 3],
                ]);

                if address != 0 {
                    valid_sprites.push((id, address as u64));
                } else {
                    sprites.push(SpriteData {
                        id,
                        is_empty: true,
                        compressed_pixels: Vec::new(),
                    });
                }
            }

            if valid_sprites.is_empty() {
                continue;
            }

            // Sort by file position
            valid_sprites.sort_by_key(|k| k.1);

            // Read sprite data
            // Use the same logic as batch read: if dense, read block; if sparse, read individually
            let min_pos = valid_sprites.first().unwrap().1;
            let max_pos = valid_sprites.last().unwrap().1;
            
            // Estimate span size (max_pos + ~8KB - min_pos)
            let span_size = (max_pos + 8192) - min_pos;

            // If span is reasonable (< 5MB) and density is high enough, read bulk
            // Density check: if we are reading > 20% of the span, it's worth reading the whole thing
            // to avoid seeks.
            // Average sprite size ~500 bytes.
            let estimated_data_size = valid_sprites.len() as u64 * 500;
            
            if span_size < 5 * 1024 * 1024 && (estimated_data_size * 5 > span_size || valid_sprites.len() > 50) {
                 // BULK READ
                reader.file.seek(SeekFrom::Start(min_pos))
                    .map_err(|e| format!("Failed to seek to data block: {}", e))?;

                let mut file_buf = vec![0u8; span_size as usize];
                let bytes_read = reader.file.read(&mut file_buf)
                    .map_err(|e| format!("Failed to read data block: {}", e))?;

                for (id, pos) in valid_sprites {
                    let local_offset = (pos - min_pos) as usize;
                    
                    if local_offset + 5 > bytes_read { continue; }

                    let len_offset = local_offset + 3; // Skip RGB
                    let length = u16::from_le_bytes([
                        file_buf[len_offset],
                        file_buf[len_offset + 1]
                    ]);

                    if length == 0 {
                        sprites.push(SpriteData { id, is_empty: true, compressed_pixels: Vec::new() });
                        continue;
                    }

                    let data_offset = len_offset + 2;
                    let data_end = data_offset + length as usize;

                    if data_end <= bytes_read {
                        sprites.push(SpriteData {
                            id,
                            is_empty: false,
                            compressed_pixels: file_buf[data_offset..data_end].to_vec(),
                        });
                    }
                }
            } else {
                // SEQUENTIAL READ
                let mut current_pos = reader.file.stream_position()
                    .map_err(|e| format!("Failed to get stream pos: {}", e))?;

                for (id, pos) in valid_sprites {
                    let target_pos = pos + 3; // Skip RGB
                    
                    if current_pos != target_pos {
                        reader.file.seek(SeekFrom::Start(target_pos))
                            .map_err(|e| format!("Failed to seek: {}", e))?;
                        current_pos = target_pos;
                    }

                    let mut len_buf = [0u8; 2];
                    reader.file.read_exact(&mut len_buf)
                        .map_err(|e| format!("Failed to read length: {}", e))?;
                    current_pos += 2;
                    
                    let length = u16::from_le_bytes(len_buf);

                    if length == 0 {
                        sprites.push(SpriteData { id, is_empty: true, compressed_pixels: Vec::new() });
                        continue;
                    }

                    let mut pixels = vec![0u8; length as usize];
                    reader.file.read_exact(&mut pixels)
                        .map_err(|e| format!("Failed to read pixels: {}", e))?;
                    current_pos += length as u64;

                    sprites.push(SpriteData {
                        id,
                        is_empty: false,
                        compressed_pixels: pixels,
                    });
                }
            }
        }

        // Combine results
        result_sprites.extend(sprites);
        Ok(result_sprites)
    }

    /// Update sprite data in memory (override)
    pub fn update_sprite(&mut self, path: &str, id: u32, sprite: SpriteData) -> Result<(), String> {
        if id == 0 { return Err("Invalid sprite ID 0".to_string()); }
        
        self.overrides.entry(path.to_string())
            .or_insert_with(HashMap::new)
            .insert(id, sprite);
        Ok(())
    }

    /// Read sprites and return decompressed RGBA pixels
    /// Format: [Count: u32] -> ([ID: u32][IsEmpty: u8][RGBA pixels: 4096 bytes])*
    /// Each sprite is exactly 4096 bytes (32x32x4 RGBA)
    pub fn read_sprites_rgba(&mut self, path: &str, ids: Vec<u32>, transparent: bool) -> Result<Vec<u8>, String> {
        let sprites = self.read_sprites_list(path, ids)?;
        Ok(Self::pack_sprites_rgba(sprites, transparent, self.sprite_data_size()))
    }

    pub fn read_sprites_batch_rgba(&mut self, path: &str, start_id: u32, count: u32, transparent: bool) -> Result<Vec<u8>, String> {
        let sprites = self.read_sprites_batch(path, start_id, count)?;
        Ok(Self::pack_sprites_rgba(sprites, transparent, self.sprite_data_size()))
    }

    pub fn read_sprites_rgba_lz4(&mut self, path: &str, ids: Vec<u32>, transparent: bool) -> Result<Vec<u8>, String> {
        let sprites = self.read_sprites_list(path, ids)?;
        Ok(Self::pack_sprites_rgba_lz4(sprites, transparent, self.sprite_data_size()))
    }

    pub fn compose_atlas_png(
        &mut self,
        path: &str,
        start_id: u32,
        count: u32,
        cols: u32,
        transparent: bool,
    ) -> Result<Vec<u8>, String> {
        use std::io::Cursor;

        let ss = self.sprite_size;
        let cols = cols.max(1);
        let rows = (count + cols - 1) / cols;
        let atlas_w = cols * ss as u32;
        let atlas_h = rows.max(1) * ss as u32;

        let sprites = self.read_sprites_batch(path, start_id, count)?;

        let row_bytes = ss * 4;
        let sds = self.sprite_data_size();
        let mut atlas = vec![0u8; (atlas_w * atlas_h * 4) as usize];

        for sprite in sprites {
            if sprite.is_empty || sprite.id < start_id {
                continue;
            }
            let idx = sprite.id - start_id;
            if idx >= count {
                continue;
            }
            let dst_x = (idx % cols) * ss as u32;
            let dst_y = (idx / cols) * ss as u32;
            let rgba = decompress_to_rgba(&sprite.compressed_pixels, transparent, sds);

            for y in 0..ss as u32 {
                let src_off = (y as usize) * row_bytes;
                let dst_off = (((dst_y + y) * atlas_w + dst_x) as usize) * 4;
                atlas[dst_off..dst_off + row_bytes].copy_from_slice(&rgba[src_off..src_off + row_bytes]);
            }
        }

        let img = image::RgbaImage::from_raw(atlas_w, atlas_h, atlas)
            .ok_or_else(|| "Failed to build atlas image".to_string())?;
        let mut out = Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(img)
            .write_to(&mut out, image::ImageOutputFormat::Png)
            .map_err(|e| format!("PNG encode failed: {}", e))?;
        Ok(out.into_inner())
    }

    /// Pack sprites with RGBA pixels and then LZ4 compress for fast IPC transfer
    /// LZ4 is very fast to decompress (~2GB/s) while providing ~5x compression on RGBA data
    /// Uses LZ4 frame format which is compatible with lz4js on the frontend
    pub fn pack_sprites_rgba_lz4(sprites: Vec<SpriteData>, transparent: bool, sprite_data_size: usize) -> Vec<u8> {
        let uncompressed = Self::pack_sprites_rgba(sprites, transparent, sprite_data_size);

        // Then compress with LZ4 frame format (compatible with lz4js which expects frame format)
        use lz4_flex::frame::FrameEncoder;
        use std::io::Write;

        let mut encoder = FrameEncoder::new(Vec::new());
        encoder.write_all(&uncompressed).expect("LZ4 encoding failed");
        encoder.finish().expect("LZ4 finish failed")
    }

    /// Helper to pack sprites with decompressed RGBA pixels
    /// Format: [Count: u32] -> ([ID: u32][IsEmpty: u8][CompressedLen: u32][CompressedData...][RGBA pixels: 4096 bytes])*
    ///
    /// We include both compressed data (for saving) and RGBA pixels (for rendering)
    /// Uses parallel processing with rayon for faster decompression
    fn pack_sprites_rgba(sprites: Vec<SpriteData>, transparent: bool, sprite_data_size: usize) -> Vec<u8> {
        let decompressed: Vec<(SpriteData, Vec<u8>)> = sprites
            .into_par_iter()
            .map(|sprite| {
                let rgba = decompress_to_rgba(&sprite.compressed_pixels, transparent, sprite_data_size);
                (sprite, rgba)
            })
            .collect();

        let header_bytes = 4;
        let total_compressed: usize = decompressed.iter()
            .map(|(s, _)| s.compressed_pixels.len())
            .sum();
        let total_size = header_bytes
            + decompressed.len() * (4 + 1 + 4 + sprite_data_size)
            + total_compressed;

        let mut buffer = Vec::with_capacity(total_size);

        // Step 3: Write header
        buffer.extend_from_slice(&(decompressed.len() as u32).to_le_bytes());

        // Step 4: Write all sprite data sequentially (fast memory copy)
        for (sprite, rgba) in decompressed {
            // Write ID
            buffer.extend_from_slice(&sprite.id.to_le_bytes());

            // Write IsEmpty
            buffer.push(if sprite.is_empty { 1 } else { 0 });

            // Write Compressed Pixels Length
            buffer.extend_from_slice(&(sprite.compressed_pixels.len() as u32).to_le_bytes());

            // Write Compressed Pixels Data (for saving back to file)
            buffer.extend_from_slice(&sprite.compressed_pixels);

            // Write RGBA pixels (already decompressed in parallel)
            buffer.extend_from_slice(&rgba);
        }
        buffer
    }
}

/// Decompress Tibia's RLE-compressed sprite data directly to RGBA format
///
/// Format:
/// - Alternates between transparent and colored pixel chunks
/// - Each chunk has a 2-byte count (little-endian u16)
/// - Transparent pixels: just count (no data)
/// - Colored pixels: RGB or RGBA bytes follow (depending on transparent flag)
///
/// Output: 4096 bytes of RGBA data (32x32 pixels, 4 bytes per pixel)
pub fn decompress_to_rgba(compressed: &[u8], transparent: bool, sprite_data_size: usize) -> Vec<u8> {
    let mut pixels = vec![0u8; sprite_data_size];
    let mut write_pos = 0;
    let mut read_pos = 0;
    let channels = if transparent { 4 } else { 3 };

    while read_pos + 4 <= compressed.len() && write_pos < sprite_data_size {
        // Read transparent pixels count (2 bytes, little-endian)
        let transparent_count = u16::from_le_bytes([
            compressed[read_pos],
            compressed[read_pos + 1]
        ]) as usize;
        read_pos += 2;

        // Read colored pixels count (2 bytes, little-endian)
        let colored_count = u16::from_le_bytes([
            compressed[read_pos],
            compressed[read_pos + 1]
        ]) as usize;
        read_pos += 2;

        // Determine actual channels to read (fallback to 3 if not enough data for 4)
        let mut current_channels = channels;
        let bytes_needed = colored_count * current_channels;

        if read_pos + bytes_needed > compressed.len() {
            // Fallback: if we expected 4 channels but don't have enough data, try 3
            if transparent && read_pos + colored_count * 3 <= compressed.len() {
                current_channels = 3;
            } else {
                // Not enough data, stop processing
                break;
            }
        }

        // Write transparent pixels (RGBA = 0x00000000)
        for _ in 0..transparent_count {
            if write_pos >= sprite_data_size {
                break;
            }
            pixels[write_pos] = 0;     // R
            pixels[write_pos + 1] = 0; // G
            pixels[write_pos + 2] = 0; // B
            pixels[write_pos + 3] = 0; // A
            write_pos += 4;
        }

        // Write colored pixels (convert from RGB/RGBA to RGBA)
        for _ in 0..colored_count {
            if write_pos >= sprite_data_size {
                break;
            }

            let red = compressed[read_pos];
            let green = compressed[read_pos + 1];
            let blue = compressed[read_pos + 2];
            read_pos += 3;

            let alpha = if current_channels == 4 {
                let a = compressed[read_pos];
                read_pos += 1;
                a
            } else {
                0xFF
            };

            // Write as RGBA (canvas native format)
            pixels[write_pos] = red;       // R
            pixels[write_pos + 1] = green; // G
            pixels[write_pos + 2] = blue;  // B
            pixels[write_pos + 3] = alpha; // A
            write_pos += 4;
        }
    }

    // Remaining pixels are already initialized to 0 (transparent black)
    pixels
}

/// Compress RGBA pixels to Tibia's RLE format
/// This is the inverse of decompress_to_rgba
///
/// Input: 4096 bytes of RGBA data (32x32 pixels, 4 bytes per pixel)
/// Output: RLE compressed data
///
/// Format:
/// - Alternates between transparent and colored pixel chunks
/// - Each chunk has a 2-byte count (little-endian u16)
/// - Transparent pixels: just count (no data)
/// - Colored pixels: RGB or RGBA bytes follow (depending on transparent flag)
pub fn compress_to_rle(pixels: &[u8], transparent: bool, sprite_data_size: usize) -> Vec<u8> {
    if pixels.len() != sprite_data_size {
        return Vec::new();
    }

    let mut compressed = Vec::new();
    let mut index = 0;
    let pixel_count = sprite_data_size / 4;

    while index < pixel_count {
        // Count transparent pixels (RGBA = 0,0,0,0)
        let mut transparent_count = 0u16;
        while index < pixel_count {
            let offset = index * 4;
            let r = pixels[offset];
            let g = pixels[offset + 1];
            let b = pixels[offset + 2];
            let a = pixels[offset + 3];

            let is_transparent = r == 0 && g == 0 && b == 0 && a == 0;
            if !is_transparent {
                break;
            }

            transparent_count += 1;
            index += 1;
        }

        // Write transparent count (2 bytes, little-endian)
        compressed.extend_from_slice(&transparent_count.to_le_bytes());

        // Save position for colored count
        let colored_count_pos = compressed.len();
        compressed.push(0); // Placeholder for colored count low byte
        compressed.push(0); // Placeholder for colored count high byte

        // Count and write colored pixels
        let mut colored_count = 0u16;
        while index < pixel_count {
            let offset = index * 4;
            let r = pixels[offset];
            let g = pixels[offset + 1];
            let b = pixels[offset + 2];
            let a = pixels[offset + 3];

            let is_transparent = r == 0 && g == 0 && b == 0 && a == 0;
            if is_transparent {
                break;
            }

            // Write RGB(A) data
            compressed.push(r);
            compressed.push(g);
            compressed.push(b);
            if transparent {
                compressed.push(a);
            }

            colored_count += 1;
            index += 1;
        }

        // Update colored count
        let count_bytes = colored_count.to_le_bytes();
        compressed[colored_count_pos] = count_bytes[0];
        compressed[colored_count_pos + 1] = count_bytes[1];
    }

    compressed
}

pub type SprManagerState = Arc<Mutex<SprManager>>;

impl crate::formats::SpriteProvider for SprManager {
    fn sprite_size(&self) -> u32 {
        self.sprite_size as u32
    }

    fn open(&mut self, path: &str, extended: bool) -> Result<SprHeader, String> {
        self.open_file(path.to_string(), extended)
    }

    fn close(&mut self, path: &str) -> Result<(), String> {
        self.close_file(path)
    }

    fn read_sprites_rgba(&mut self, path: &str, ids: &[u32], transparent: bool) -> Result<Vec<u8>, String> {
        SprManager::read_sprites_rgba(self, path, ids.to_vec(), transparent)
    }

    fn read_sprites_batch_rgba(&mut self, path: &str, start_id: u32, count: u32, transparent: bool) -> Result<Vec<u8>, String> {
        SprManager::read_sprites_batch_rgba(self, path, start_id, count, transparent)
    }

    fn read_sprites_rgba_lz4(&mut self, path: &str, ids: &[u32], transparent: bool) -> Result<Vec<u8>, String> {
        SprManager::read_sprites_rgba_lz4(self, path, ids.to_vec(), transparent)
    }
}
