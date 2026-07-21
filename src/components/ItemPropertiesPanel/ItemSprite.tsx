import React from 'react';

import { Thing } from '~/domain/thing';
import { LoadedSprite } from '~/domain/sprite';
import { TILE } from '~/components/MapCanvas/constants';
import { brushSpriteLayout, fluidSpriteLayout } from '~/usecase/brushSprite';

const THUMB = 32;

interface ItemSpriteProps {
  version: number;
  clientId: number;
  subtype?: number;
  items: Map<number, Thing>;
  cache: Map<number, LoadedSprite>;
}

const ItemSprite = ({ cache, items, version, clientId, subtype }: ItemSpriteProps) => {
  const ref = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, THUMB, THUMB);
    const thing = items.get(clientId);
    if (!thing) return;
    const layout = subtype != null ? fluidSpriteLayout(thing, subtype) : brushSpriteLayout(thing, false);
    if (!layout || layout.cells.length === 0) return;
    const offW = layout.cols * TILE;
    const offH = layout.rows * TILE;
    const off = document.createElement('canvas');
    off.width = offW;
    off.height = offH;
    const octx = off.getContext('2d');
    if (!octx) return;
    let drew = false;
    for (const cell of layout.cells) {
      const sprite = cache.get(cell.spriteId);
      if (!sprite || sprite.empty) continue;
      octx.putImageData(new ImageData(new Uint8ClampedArray(sprite.rgba), TILE, TILE), cell.dx, cell.dy);
      drew = true;
    }
    if (!drew) return;
    const scale = Math.min(THUMB / offW, THUMB / offH);
    const dw = offW * scale;
    const dh = offH * scale;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, (THUMB - dw) / 2, (THUMB - dh) / 2, dw, dh);
  }, [clientId, items, cache, version, subtype]);

  return (
    <canvas ref={ref} width={THUMB} height={THUMB} className="h-8 w-8 flex-shrink-0" style={{ imageRendering: 'pixelated' }} />
  );
};

export default ItemSprite;
