import { PaletteBrush } from '~/domain/palette';
import { ThingType, getSpriteIndex, SPRITE_SIZE } from '~/domain/tibia';
import { Thing } from '~/domain/thing';
import { isColorized, OutfitColors } from '~/domain/outfit';

export interface SpriteCell {
  dx: number;
  dy: number;
  spriteId: number;
  maskSpriteId?: number;
}

export interface BrushSpriteLayout {
  cols: number;
  rows: number;
  exactSize: number;
  cells: SpriteCell[];
  colors?: OutfitColors;
}

export function resolveBrushThing(
  brush: PaletteBrush,
  items: Map<number, Thing>,
  outfits: Map<number, ThingType>,
  serverToClient: Map<number, number>
): Thing | null {
  if (brush.kind === 'creature') {
    if (brush.lookType == null) return null;
    return outfits.get(brush.lookType) ?? null;
  }
  if (brush.lookServerId == null) return null;
  const clientId = serverToClient.get(brush.lookServerId);
  if (!clientId) return null;
  return items.get(clientId) ?? null;
}

export function brushSpriteLayout(thing: Thing, isCreature: boolean, colors?: OutfitColors, tileSize = SPRITE_SIZE): BrushSpriteLayout {
  const cols = Math.max(1, thing.width);
  const rows = Math.max(1, thing.height);
  const patternX = isCreature ? Math.min(2, Math.max(0, thing.patternX - 1)) : 0;
  const hasMask = isCreature && thing.layers >= 2 && colors != null && isColorized(colors);
  const cells: SpriteCell[] = [];

  for (let h = 0; h < rows; h++) {
    for (let w = 0; w < cols; w++) {
      const index = getSpriteIndex(thing, w, h, 0, patternX, 0, 0, 0);
      const spriteId = thing.spriteIndex[index];
      if (spriteId == null || spriteId === 0) continue;
      const cell: SpriteCell = { dx: (cols - 1 - w) * tileSize, dy: (rows - 1 - h) * tileSize, spriteId };
      if (hasMask) {
        const maskIndex = getSpriteIndex(thing, w, h, 1, patternX, 0, 0, 0);
        const maskId = thing.spriteIndex[maskIndex];
        if (maskId != null && maskId !== 0) cell.maskSpriteId = maskId;
      }
      cells.push(cell);
    }
  }

  const exactSize = thing.exactSize > 0 ? thing.exactSize : Math.max(cols, rows) * tileSize;
  return { cols, rows, exactSize, cells, colors: hasMask ? colors : undefined };
}
