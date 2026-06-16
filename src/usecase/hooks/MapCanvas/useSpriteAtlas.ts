import React from 'react';

import { LoadedSprite } from '~/domain/sprite';
import { loadSprites } from '~/adapter/sprites';
import { GLRenderer, ATLAS_SLOTS } from '~/usecase/glRenderer';
import { SPRITE_CACHE_MAX, SPRITE_CACHE_LOW } from '~/components/MapCanvas/constants';

export interface SpriteAtlas {
  data: React.MutableRefObject<Map<number, LoadedSprite>>;
  lastUsed: React.MutableRefObject<Map<number, number>>;
  version: React.MutableRefObject<number>;
  epoch: React.MutableRefObject<number>;
  slotFor: (id: number, data: LoadedSprite) => number;
  compositeId: (key: string) => number;
  loadMissing: (sprPath: string, missing: Iterable<number>, transparency: boolean) => void;
  evict: (tick: number) => void;
  clear: () => void;
}

const COMPOSITE_BASE = 0x40000000;

export function useSpriteAtlas(gl: React.MutableRefObject<GLRenderer | null>): SpriteAtlas {
  const data = React.useRef(new Map<number, LoadedSprite>());
  const lastUsed = React.useRef(new Map<number, number>());
  const requested = React.useRef(new Set<number>());
  const loading = React.useRef(false);
  const version = React.useRef(0);
  const epoch = React.useRef(0);
  const slot = React.useRef(new Map<number, number>());
  const freeSlots = React.useRef<number[]>([]);
  const nextSlot = React.useRef(0);
  const composites = React.useRef(new Map<string, number>());
  const nextComposite = React.useRef(COMPOSITE_BASE);

  function compositeId(key: string): number {
    let id = composites.current.get(key);
    if (id === undefined) {
      id = nextComposite.current++;
      composites.current.set(key, id);
    }
    return id;
  }

  function slotFor(id: number, sprite: LoadedSprite): number {
    let s = slot.current.get(id);
    if (s === undefined) {
      if (freeSlots.current.length > 0) s = freeSlots.current.pop()!;
      else if (nextSlot.current < ATLAS_SLOTS) s = nextSlot.current++;
      else return -1;
      gl.current!.uploadSprite(s, sprite.rgba);
      slot.current.set(id, s);
    }
    return s;
  }

  function loadMissing(sprPath: string, missing: Iterable<number>, transparency: boolean) {
    const toFetch = [...missing].filter((id) => !requested.current.has(id));
    if (toFetch.length === 0 || loading.current) return;
    loading.current = true;
    toFetch.forEach((id) => requested.current.add(id));
    loadSprites(sprPath, toFetch, transparency, data.current)
      .catch((err) => console.error('Failed to load sprites', err))
      .finally(() => {
        loading.current = false;
        version.current++;
      });
  }

  function evict(tick: number) {
    if (data.current.size <= SPRITE_CACHE_MAX) return;
    const ids = [...data.current.keys()].sort((a, b) => (lastUsed.current.get(a) ?? 0) - (lastUsed.current.get(b) ?? 0));
    const toRemove = data.current.size - SPRITE_CACHE_LOW;
    let removed = 0;
    for (let i = 0; i < ids.length && removed < toRemove; i++) {
      const id = ids[i];
      if (lastUsed.current.get(id) === tick) break;
      data.current.delete(id);
      lastUsed.current.delete(id);
      requested.current.delete(id);
      const s = slot.current.get(id);
      if (s !== undefined) {
        slot.current.delete(id);
        freeSlots.current.push(s);
      }
      removed++;
    }
    if (removed > 0) epoch.current++;
  }

  function clear() {
    data.current = new Map();
    lastUsed.current = new Map();
    requested.current = new Set();
    loading.current = false;
    slot.current = new Map();
    freeSlots.current = [];
    nextSlot.current = 0;
    composites.current = new Map();
    nextComposite.current = COMPOSITE_BASE;
    epoch.current++;
    version.current++;
  }

  return { data, lastUsed, version, epoch, slotFor, compositeId, loadMissing, evict, clear };
}
