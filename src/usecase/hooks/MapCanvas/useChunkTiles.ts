import React from 'react';

import { ChunkTiles } from '~/domain/map';
import { CHUNK, TILE_CACHE_MAX, TILE_CACHE_LOW } from '~/components/MapCanvas/constants';

export interface ChunkTilesCache {
  data: React.MutableRefObject<Map<string, ChunkTiles | null>>;
  lastUsed: React.MutableRefObject<Map<string, number>>;
  requested: React.MutableRefObject<Set<string>>;
  pending: React.MutableRefObject<Set<string>>;
  get: (cx: number, cy: number, z: number, tick: number) => ChunkTiles | null | undefined;
  request: (cx: number, cy: number, z: number) => void;
  queueRefetch: (x: number, y: number, z: number) => void;
  store: (key: string, tiles: ChunkTiles | null, tick: number) => void;
  evict: () => void;
  clear: () => void;
}

export function useChunkTiles(): ChunkTilesCache {
  const data = React.useRef(new Map<string, ChunkTiles | null>());
  const lastUsed = React.useRef(new Map<string, number>());
  const requested = React.useRef(new Set<string>());
  const pending = React.useRef(new Set<string>());

  function get(cx: number, cy: number, z: number, tick: number): ChunkTiles | null | undefined {
    const k = `${z},${cx},${cy}`;
    const t = data.current.get(k);
    if (t !== undefined) lastUsed.current.set(k, tick);
    return t;
  }

  function request(cx: number, cy: number, z: number) {
    const k = `${z},${cx},${cy}`;
    if (requested.current.has(k)) return;
    requested.current.add(k);
    pending.current.add(k);
  }

  function queueRefetch(x: number, y: number, z: number) {
    const key = `${z},${Math.floor(x / CHUNK)},${Math.floor(y / CHUNK)}`;
    requested.current.add(key);
    pending.current.add(key);
  }

  function store(key: string, tiles: ChunkTiles | null, tick: number) {
    data.current.set(key, tiles);
    lastUsed.current.set(key, tick);
    requested.current.add(key);
  }

  function evict() {
    if (data.current.size <= TILE_CACHE_MAX) return;
    const keys = [...data.current.keys()].sort((a, b) => (lastUsed.current.get(a) ?? 0) - (lastUsed.current.get(b) ?? 0));
    const toRemove = data.current.size - TILE_CACHE_LOW;
    for (let i = 0; i < toRemove; i++) {
      const k = keys[i];
      data.current.delete(k);
      lastUsed.current.delete(k);
      requested.current.delete(k);
    }
  }

  function clear() {
    data.current.clear();
    lastUsed.current.clear();
    requested.current.clear();
    pending.current.clear();
  }

  return { data, lastUsed, requested, pending, get, request, queueRefetch, store, evict, clear };
}
