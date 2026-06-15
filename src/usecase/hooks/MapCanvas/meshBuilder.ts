import { Position } from '~/domain/map';
import { slotUV } from '~/usecase/glRenderer';
import { SpawnArea, CreaturePlacement } from '~/domain/creature';
import { TILE, CHUNK, MAX_ELEVATION } from '~/components/MapCanvas/constants';
import { ThingType, isCountStack, getSpriteIndex, stackSpriteIndex } from '~/domain/tibia';

import { SpriteAtlas } from './useSpriteAtlas';
import { ChunkTilesCache } from './useChunkTiles';

const SPAWN_FACTORS = [179, 125, 88, 61, 43, 30, 21, 15, 10];

export const spawnTileKey = (x: number, y: number) => x * 100000 + y;

export function spawnFactor(count: number): number {
  return SPAWN_FACTORS[Math.min(count, 9) - 1] / 256;
}

export function spawnCountsForChunk(areas: SpawnArea[], cx: number, cy: number): Map<number, number> {
  const counts = new Map<number, number>();
  const minX = cx * CHUNK;
  const minY = cy * CHUNK;
  const maxX = minX + CHUNK - 1;
  const maxY = minY + CHUNK - 1;
  for (const a of areas) {
    const x0 = Math.max(minX, a.x - a.radius);
    const x1 = Math.min(maxX, a.x + a.radius);
    const y0 = Math.max(minY, a.y - a.radius);
    const y1 = Math.min(maxY, a.y + a.radius);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const k = spawnTileKey(x, y);
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
    }
  }
  return counts;
}

export interface MeshContext {
  items: Map<number, ThingType>;
  tiles: ChunkTilesCache;
  atlas: SpriteAtlas;
}

export function appendCreatures(
  inst: number[],
  placements: CreaturePlacement[],
  outfits: Map<number, ThingType>,
  atlas: SpriteAtlas,
  tick: number,
  missing: Set<number>,
  selected = false
): boolean {
  const tint = selected ? 1 : 0;
  let complete = true;
  for (const c of placements) {
    if (!c.lookType) continue;
    const thing = outfits.get(c.lookType);
    if (!thing || thing.spriteIndex.length === 0) continue;
    const dir = Math.min(Math.max(0, c.direction), Math.max(0, thing.patternX - 1));
    const ox = thing.offsetX || 0;
    const oy = thing.offsetY || 0;
    for (let h = 0; h < thing.height; h++) {
      for (let w = 0; w < thing.width; w++) {
        const sid = thing.spriteIndex[getSpriteIndex(thing, w, h, 0, dir, 0, 0, 0)];
        if (!sid) continue;
        const data = atlas.data.current.get(sid);
        if (!data) {
          missing.add(sid);
          complete = false;
          continue;
        }
        atlas.lastUsed.current.set(sid, tick);
        if (data.empty) continue;
        const slot = atlas.slotFor(sid, data);
        if (slot < 0) {
          complete = false;
          continue;
        }
        const { u0, v0 } = slotUV(slot);
        inst.push((c.x - w) * TILE - ox, (c.y - h) * TILE - oy, u0, v0, tint, 1);
      }
    }
  }
  return complete;
}

export function buildCreatureGhost(
  lookType: number,
  x: number,
  y: number,
  z: number,
  outfits: Map<number, ThingType>,
  atlas: SpriteAtlas,
  tick: number,
  missing: Set<number>
): Float32Array | null {
  if (!lookType) return null;
  const inst: number[] = [];
  appendCreatures(
    inst,
    [{ x, y, z, name: '', isNpc: false, lookType, spawntime: 0, direction: 2 }],
    outfits,
    atlas,
    tick,
    missing
  );
  return inst.length > 0 ? new Float32Array(inst) : null;
}

export function buildSpawnAreaGhost(
  ctx: MeshContext,
  centerX: number,
  centerY: number,
  z: number,
  radius: number,
  tick: number,
  missing: Set<number>
): Float32Array | null {
  const { items, tiles, atlas } = ctx;
  const factor = spawnFactor(1);
  const inst: number[] = [];
  for (let ty = centerY - radius; ty <= centerY + radius; ty++) {
    for (let tx = centerX - radius; tx <= centerX + radius; tx++) {
      const ct = tiles.get(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK), z, tick);
      if (!ct) continue;
      let found = -1;
      for (let i = 0; i < ct.tileX.length; i++) {
        if (ct.tileX[i] === tx && ct.tileY[i] === ty) {
          found = i;
          break;
        }
      }
      if (found < 0) continue;
      const end = ct.itemOffset[found + 1];
      for (let ii = ct.itemOffset[found]; ii < end; ii++) {
        const thing = items.get(ct.clientIds[ii]);
        if (!thing || thing.spriteIndex.length === 0 || (!thing.isGround && !thing.isGroundBorder)) continue;
        const px = thing.patternX > 0 ? tx % thing.patternX : 0;
        const py = thing.patternY > 0 ? ty % thing.patternY : 0;
        const ox = thing.offsetX || 0;
        const oy = thing.offsetY || 0;
        for (let l = 0; l < thing.layers; l++) {
          for (let h = 0; h < thing.height; h++) {
            for (let w = 0; w < thing.width; w++) {
              const sid = thing.spriteIndex[getSpriteIndex(thing, w, h, l, px, py, 0, 0)];
              if (!sid) continue;
              const data = atlas.data.current.get(sid);
              if (!data) {
                missing.add(sid);
                continue;
              }
              atlas.lastUsed.current.set(sid, tick);
              if (data.empty) continue;
              const slot = atlas.slotFor(sid, data);
              if (slot < 0) continue;
              const { u0, v0 } = slotUV(slot);
              inst.push((tx - w) * TILE - ox, (ty - h) * TILE - oy, u0, v0, 0, factor);
            }
          }
        }
      }
    }
  }
  return inst.length > 0 ? new Float32Array(inst) : null;
}

export function buildThingGhost(
  thing: ThingType,
  x: number,
  y: number,
  atlas: SpriteAtlas,
  tick: number,
  missing: Set<number>
): Float32Array | null {
  const inst: number[] = [];
  for (let l = 0; l < thing.layers; l++) {
    for (let h = 0; h < thing.height; h++) {
      for (let w = 0; w < thing.width; w++) {
        const sid = thing.spriteIndex[getSpriteIndex(thing, w, h, l, 0, 0, 0, 0)];
        if (!sid) continue;
        const data = atlas.data.current.get(sid);
        if (!data) {
          missing.add(sid);
          continue;
        }
        atlas.lastUsed.current.set(sid, tick);
        if (data.empty) continue;
        const slot = atlas.slotFor(sid, data);
        if (slot < 0) continue;
        const { u0, v0 } = slotUV(slot);
        inst.push((x - w) * TILE, (y - h) * TILE, u0, v0, 0, 1);
      }
    }
  }
  return inst.length > 0 ? new Float32Array(inst) : null;
}

export function buildTopItemMesh(
  ctx: MeshContext,
  tick: number,
  floorZ: number,
  tile: Position,
  shiftTilesX: number,
  shiftTilesY: number
): Float32Array | null {
  const { items, tiles, atlas } = ctx;
  if (tile.z !== floorZ) return null;

  const tx = tile.x;
  const ty = tile.y;
  const ct = tiles.get(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK), floorZ, tick);
  if (!ct) return null;
  let found = -1;
  for (let i = 0; i < ct.tileX.length; i++) {
    if (ct.tileX[i] === tx && ct.tileY[i] === ty) {
      found = i;
      break;
    }
  }
  if (found < 0) return null;

  const start = ct.itemOffset[found];
  const end = ct.itemOffset[found + 1];
  const top = end - 1;
  const sx = shiftTilesX * TILE;
  const sy = shiftTilesY * TILE;
  const inst: number[] = [];
  let drawElevation = 0;
  for (let ii = start; ii < end; ii++) {
    const thing = items.get(ct.clientIds[ii]);
    if (!thing || thing.spriteIndex.length === 0) continue;

    if (ii === top) {
      const px = thing.patternX > 0 ? tx % thing.patternX : 0;
      const py = thing.patternY > 0 ? ty % thing.patternY : 0;
      const countStack = isCountStack(thing);
      const stackIdx = countStack ? stackSpriteIndex(thing, ct.counts[ii]) : 0;
      const ox = (thing.offsetX || 0) + drawElevation;
      const oy = (thing.offsetY || 0) + drawElevation;

      for (let l = 0; l < thing.layers; l++) {
        for (let h = 0; h < thing.height; h++) {
          for (let w = 0; w < thing.width; w++) {
            const sid = thing.spriteIndex[countStack ? stackIdx : getSpriteIndex(thing, w, h, l, px, py, 0, 0)];
            if (!sid) continue;
            const data = atlas.data.current.get(sid);
            if (!data || data.empty) continue;
            const slot = atlas.slotFor(sid, data);
            if (slot < 0) continue;
            const { u0, v0 } = slotUV(slot);
            inst.push((tx - w) * TILE - ox + sx, (ty - h) * TILE - oy + sy, u0, v0, 0, 1);
          }
        }
      }
    }

    if (thing.hasElevation) drawElevation = Math.min(drawElevation + thing.elevation, MAX_ELEVATION);
  }

  return inst.length > 0 ? new Float32Array(inst) : null;
}
