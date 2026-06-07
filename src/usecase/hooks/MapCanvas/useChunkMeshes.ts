import React from 'react';

import { GLRenderer } from '~/usecase/glRenderer';
import { MeshInfo } from '~/components/MapCanvas/types';
import { CHUNK, MESH_CACHE_MAX, MESH_CACHE_LOW } from '~/components/MapCanvas/constants';

export interface ChunkMeshCache {
  data: React.MutableRefObject<Map<string, MeshInfo>>;
  store: (key: string, mesh: Float32Array, info: MeshInfo) => void;
  forget: (key: string) => void;
  discardAt: (x: number, y: number, z: number) => void;
  discardTiles: (tiles: Iterable<{ x: number; y: number; z: number }>) => void;
  evict: () => void;
  clear: () => void;
}

export function useChunkMeshes(gl: React.MutableRefObject<GLRenderer | null>): ChunkMeshCache {
  const data = React.useRef(new Map<string, MeshInfo>());

  function store(key: string, mesh: Float32Array, info: MeshInfo) {
    gl.current!.setChunkMesh(key, mesh);
    data.current.set(key, info);
  }

  function forget(key: string) {
    data.current.delete(key);
  }

  function discard(key: string) {
    gl.current?.deleteChunkMesh(key);
    data.current.delete(key);
  }

  function discardAt(x: number, y: number, z: number) {
    discard(`${z},${Math.floor(x / CHUNK)},${Math.floor(y / CHUNK)}`);
  }

  function discardTiles(tiles: Iterable<{ x: number; y: number; z: number }>) {
    const keys = new Set<string>();
    for (const t of tiles) keys.add(`${t.z},${Math.floor(t.x / CHUNK)},${Math.floor(t.y / CHUNK)}`);
    for (const key of keys) discard(key);
  }

  function evict() {
    if (data.current.size <= MESH_CACHE_MAX) return;
    const keys = [...data.current.keys()].sort((a, b) => data.current.get(a)!.lastUsed - data.current.get(b)!.lastUsed);
    const toRemove = data.current.size - MESH_CACHE_LOW;
    for (let i = 0; i < toRemove; i++) discard(keys[i]);
  }

  function clear() {
    for (const key of data.current.keys()) gl.current?.deleteChunkMesh(key);
    data.current.clear();
  }

  return { data, store, forget, discardAt, discardTiles, evict, clear };
}
