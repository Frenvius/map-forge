import { LoadedSprite } from '~/domain/sprite';
import { getSpriteIndex, SPRITE_SIZE } from '~/domain/tibia';
import { Thing } from '~/domain/thing';

export function buildItemPreview(thing: Thing | undefined, spriteData: Map<number, LoadedSprite>, tileSize = SPRITE_SIZE): string | undefined {
  if (!thing || thing.spriteIndex.length === 0) return undefined;
  const w = Math.max(1, thing.width);
  const h = Math.max(1, thing.height);
  const canvas = document.createElement('canvas');
  canvas.width = w * tileSize;
  canvas.height = h * tileSize;
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
        ctx.putImageData(new ImageData(new Uint8ClampedArray(data.rgba), tileSize, tileSize), (w - 1 - ww) * tileSize, (h - 1 - hh) * tileSize);
        drew = true;
      }
    }
  }
  return drew ? canvas.toDataURL() : undefined;
}
