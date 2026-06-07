import { LoadedSprite } from '~/domain/sprite';
import { ThingType, getSpriteIndex } from '~/domain/tibia';

const TILE = 32;

export function buildItemPreview(thing: ThingType | undefined, spriteData: Map<number, LoadedSprite>): string | undefined {
  if (!thing || thing.spriteIndex.length === 0) return undefined;
  const w = Math.max(1, thing.width);
  const h = Math.max(1, thing.height);
  const canvas = document.createElement('canvas');
  canvas.width = w * TILE;
  canvas.height = h * TILE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;
  let drew = false;
  for (let l = 0; l < thing.layers; l++) {
    for (let hh = 0; hh < h; hh++) {
      for (let ww = 0; ww < w; ww++) {
        const sid = thing.spriteIndex[getSpriteIndex(thing, ww, hh, l, 0, 0, 0, 0)];
        if (!sid) continue;
        const data = spriteData.get(sid);
        if (!data || data.empty) continue;
        ctx.putImageData(new ImageData(new Uint8ClampedArray(data.rgba), TILE, TILE), (w - 1 - ww) * TILE, (h - 1 - hh) * TILE);
        drew = true;
      }
    }
  }
  return drew ? canvas.toDataURL() : undefined;
}
