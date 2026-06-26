import React from 'react';

import { LoadedSprite } from '~/domain/sprite';
import { loadSprites } from '~/adapter/sprites';
import { mapClientIds } from '~/adapter/assets';
import { useAssetsBundle } from '~/usecase/context/AssetsContext';
import { brushSpriteLayout, BrushSpriteLayout } from '~/usecase/brushSprite';

export type SpriteLayouts = Map<number, BrushSpriteLayout | null>;

export const ITEM_SPRITE_CACHE = new Map<number, LoadedSprite>();
const SERVER_TO_CLIENT = new Map<number, number>();

export function useItemSprites(serverIds: number[]): {
  layouts: Map<number, BrushSpriteLayout | null>;
  version: number;
} {
  const { assets } = useAssetsBundle();
  const items = assets?.items ?? null;
  const sprPath = assets?.sprPath ?? '';
  const transparency = assets?.transparency ?? false;

  const [layouts, setLayouts] = React.useState<Map<number, BrushSpriteLayout | null>>(new Map());
  const [version, setVersion] = React.useState(0);
  const keyStr = [...new Set(serverIds.filter(Boolean))].sort((a, b) => a - b).join(',');

  React.useEffect(() => {
    if (!items || !sprPath) return;
    let cancelled = false;
    (async () => {
      const ids = keyStr ? keyStr.split(',').map(Number) : [];
      const need = ids.filter((id) => {
        const c = SERVER_TO_CLIENT.get(id);
        return c === undefined || c === 0;
      });
      if (need.length) {
        const cids = await mapClientIds(need);
        need.forEach((sid, i) => {
          const c = cids[i] ?? 0;
          if (c) SERVER_TO_CLIENT.set(sid, c);
        });
      }
      if (cancelled) return;
      const map = new Map<number, BrushSpriteLayout | null>();
      const spriteIds: number[] = [];
      for (const id of ids) {
        const cid = SERVER_TO_CLIENT.get(id);
        const thing = cid ? (items.get(cid) ?? null) : null;
        const layout = thing ? brushSpriteLayout(thing, false) : null;
        map.set(id, layout);
        if (layout) for (const cell of layout.cells) spriteIds.push(cell.spriteId);
      }
      setLayouts(map);
      await loadSprites(sprPath, spriteIds, transparency, ITEM_SPRITE_CACHE);
      if (!cancelled) setVersion((v) => v + 1);
    })().catch((err) => console.error('Failed to load item sprites', err));
    return () => {
      cancelled = true;
    };
  }, [keyStr, items, sprPath, transparency]);

  return { layouts, version };
}
