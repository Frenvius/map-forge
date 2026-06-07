import { Position } from '~/domain/map';
import { slotUV } from '~/usecase/glRenderer';
import { ThingType, getSpriteIndex } from '~/domain/tibia';
import { TILE, CHUNK, MAX_ELEVATION } from '~/components/MapCanvas/constants';

import { SpriteAtlas } from './useSpriteAtlas';
import { ChunkTilesCache } from './useChunkTiles';

export interface MeshContext {
  items: Map<number, ThingType>;
  tiles: ChunkTilesCache;
  atlas: SpriteAtlas;
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
      const ox = (thing.offsetX || 0) + drawElevation;
      const oy = (thing.offsetY || 0) + drawElevation;

      for (let l = 0; l < thing.layers; l++) {
        for (let h = 0; h < thing.height; h++) {
          for (let w = 0; w < thing.width; w++) {
            const sid = thing.spriteIndex[getSpriteIndex(thing, w, h, l, px, py, 0, 0)];
            if (!sid) continue;
            const data = atlas.data.current.get(sid);
            if (!data || data.empty) continue;
            const slot = atlas.slotFor(sid, data);
            if (slot < 0) continue;
            const { u0, v0 } = slotUV(slot);
            inst.push((tx - w) * TILE - ox + sx, (ty - h) * TILE - oy + sy, u0, v0, 0);
          }
        }
      }
    }

    if (thing.hasElevation) drawElevation = Math.min(drawElevation + thing.elevation, MAX_ELEVATION);
  }

  return inst.length > 0 ? new Float32Array(inst) : null;
}
