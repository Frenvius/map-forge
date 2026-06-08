import React from 'react';

import { getSpriteIndex } from '~/domain/tibia';
import { visibleFloorRange } from '~/usecase/floors';
import { ChunkTiles, PreviewTile } from '~/domain/map';
import { slotUV, GLRenderer } from '~/usecase/glRenderer';
import { packChunkKey, fetchMapChunks } from '~/adapter/map';
import { MapCanvasProps } from '~/components/MapCanvas/types';
import {
  TILE,
  CHUNK,
  CHUNK_WORLD,
  MAX_ELEVATION,
  LOWER_FLOOR_DIM,
  BUILD_BUDGET_MS,
  BUILD_BUDGET_MAX
} from '~/components/MapCanvas/constants';

import { MapScene } from './useMapScene';
import { Selection } from './useSelection';
import { MapCamera } from './useMapCamera';
import { SpriteAtlas } from './useSpriteAtlas';
import { buildTopItemMesh } from './meshBuilder';
import { ChunkTilesCache } from './useChunkTiles';
import { ChunkMeshCache } from './useChunkMeshes';

export interface StatRefs {
  fpsRef: React.RefObject<HTMLSpanElement>;
  stallRef: React.RefObject<HTMLSpanElement>;
  maxRef: React.RefObject<HTMLSpanElement>;
  jsRef: React.RefObject<HTMLSpanElement>;
  chunkRef: React.RefObject<HTMLSpanElement>;
}

export interface RendererDeps {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  gl: React.MutableRefObject<GLRenderer | null>;
  camera: MapCamera;
  inputs: React.MutableRefObject<MapCanvasProps>;
  atlas: SpriteAtlas;
  tiles: ChunkTilesCache;
  meshes: ChunkMeshCache;
  selection: Selection;
  scene: MapScene;
  stats: StatRefs;
}

export function useMapRenderer(deps: RendererDeps) {
  const { canvasRef, gl, camera, inputs, atlas, tiles, meshes, selection, scene, stats } = deps;
  const { frameTick, lastChunksDrawn } = scene;

  function flushTileRequests() {
    if (tiles.pending.current.size === 0) return;
    const byZ = new Map<number, number[]>();
    for (const k of tiles.pending.current) {
      const [z, cx, cy] = k.split(',').map(Number);
      let arr = byZ.get(z);
      if (!arr) {
        arr = [];
        byZ.set(z, arr);
      }
      arr.push(packChunkKey(cx, cy));
    }
    tiles.pending.current.clear();
    for (const [z, keys] of byZ) {
      fetchMapChunks(inputs.current.map.id, z, keys)
        .then((res) => {
          for (const packed of keys) {
            const cx = packed >>> 16;
            const cy = packed & 0xffff;
            const key = `${z},${cx},${cy}`;
            tiles.store(key, res.get(`${cx},${cy}`) ?? null, frameTick.current);
            meshes.forget(key);
          }
          atlas.version.current++;
        })
        .catch((err) => console.error('Failed to fetch chunks', err));
    }
  }

  function buildChunkMesh(cx: number, cy: number, z: number, missing: Set<number>) {
    const { items } = inputs.current;
    const key = `${z},${cx},${cy}`;
    const ct = tiles.data.current.get(key) as ChunkTiles | null | undefined;
    const sel = selection.entries.current;
    const useSel = sel.size > 0;
    const inst: number[] = [];
    let complete = true;

    if (ct) {
      for (let i = 0; i < ct.tileX.length; i++) {
        const tx = ct.tileX[i];
        const ty = ct.tileY[i];
        const end = ct.itemOffset[i + 1];
        const top = end - 1;
        const selEntry = useSel ? sel.get(`${z},${tx},${ty}`) : undefined;
        let drawElevation = 0;
        for (let ii = ct.itemOffset[i]; ii < end; ii++) {
          const thing = items.get(ct.clientIds[ii]);
          if (!thing || thing.spriteIndex.length === 0) continue;
          const px = thing.patternX > 0 ? tx % thing.patternX : 0;
          const py = thing.patternY > 0 ? ty % thing.patternY : 0;
          const ox = (thing.offsetX || 0) + drawElevation;
          const oy = (thing.offsetY || 0) + drawElevation;
          const tint = selEntry ? (selEntry.all || ii === top ? 1 : 0) : 0;

          for (let l = 0; l < thing.layers; l++) {
            for (let h = 0; h < thing.height; h++) {
              for (let w = 0; w < thing.width; w++) {
                const sid = thing.spriteIndex[getSpriteIndex(thing, w, h, l, px, py, 0, 0)];
                if (!sid) continue;
                const data = atlas.data.current.get(sid);
                if (!data) {
                  missing.add(sid);
                  complete = false;
                  continue;
                }
                atlas.lastUsed.current.set(sid, frameTick.current);
                if (data.empty) continue;
                const slot = atlas.slotFor(sid, data);
                if (slot < 0) {
                  complete = false;
                  continue;
                }
                const { u0, v0 } = slotUV(slot);
                inst.push((tx - w) * TILE - ox, (ty - h) * TILE - oy, u0, v0, tint);
              }
            }
          }

          if (thing.hasElevation) drawElevation = Math.min(drawElevation + thing.elevation, MAX_ELEVATION);
        }
      }
    }

    meshes.store(key, new Float32Array(inst), {
      count: inst.length / 5,
      version: atlas.version.current,
      epoch: atlas.epoch.current,
      complete,
      lastUsed: frameTick.current
    });
  }

  function buildPreviewGhost(previewTiles: PreviewTile[], missing: Set<number>): Float32Array {
    const { items } = inputs.current;
    const inst: number[] = [];
    for (const t of previewTiles) {
      const tx = t.x;
      const ty = t.y;
      let drawElevation = 0;
      for (let ii = 0; ii < t.clientIds.length; ii++) {
        const thing = items.get(t.clientIds[ii]);
        if (!thing || thing.spriteIndex.length === 0) continue;
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
              if (!data) {
                missing.add(sid);
                continue;
              }
              atlas.lastUsed.current.set(sid, frameTick.current);
              if (data.empty) continue;
              const slot = atlas.slotFor(sid, data);
              if (slot < 0) continue;
              const { u0, v0 } = slotUV(slot);
              inst.push((tx - w) * TILE - ox, (ty - h) * TILE - oy, u0, v0, 0);
            }
          }
        }

        if (thing.hasElevation) drawElevation = Math.min(drawElevation + thing.elevation, MAX_ELEVATION);
      }
    }
    return new Float32Array(inst);
  }

  function updateGhost(camX: number, camY: number, zoom: number) {
    const ghost = scene.ghostRef.current;
    const outline = scene.highlightRef.current;
    if (!ghost || !outline) return;

    const tool = inputs.current.activeTool;
    const brush = inputs.current.activeBrush;
    const tile = scene.hoveredTile.current;
    const showBrush = tool === 'brush' && brush != null && brush.serverId != null;
    const showEraser = tool === 'eraser';

    if (selection.box.current || !tile || (!showBrush && !showEraser)) {
      ghost.style.display = 'none';
      outline.style.display = 'none';
      return;
    }

    if (showEraser) {
      const s = TILE * zoom;
      ghost.style.display = 'none';
      outline.style.display = 'block';
      outline.style.width = `${s}px`;
      outline.style.height = `${s}px`;
      outline.style.transform = `translate(${(tile.x * TILE - camX) * zoom}px, ${(tile.y * TILE - camY) * zoom}px)`;
      outline.style.borderColor = 'rgb(248, 113, 113)';
      outline.style.backgroundColor = 'rgba(239, 68, 68, 0.18)';
      return;
    }

    if (!brush) return;
    outline.style.borderColor = '';
    outline.style.backgroundColor = '';
    const cols = brush.cols ?? 1;
    const rows = brush.rows ?? 1;
    const screenX = ((tile.x + 1 - cols) * TILE - camX) * zoom;
    const screenY = ((tile.y + 1 - rows) * TILE - camY) * zoom;
    const w = cols * TILE * zoom;
    const h = rows * TILE * zoom;
    const transform = `translate(${screenX}px, ${screenY}px)`;

    if (brush.preview) {
      if (ghost.getAttribute('src') !== brush.preview) ghost.src = brush.preview;
      ghost.style.display = 'block';
      ghost.style.width = `${w}px`;
      ghost.style.height = `${h}px`;
      ghost.style.transform = transform;
    } else {
      ghost.style.display = 'none';
    }

    outline.style.display = 'block';
    outline.style.width = `${w}px`;
    outline.style.height = `${h}px`;
    outline.style.transform = transform;
  }

  function updateSelectionBox(camX: number, camY: number, zoom: number) {
    const el = scene.selectionBoxRef.current;
    const ghost = scene.boxGhostRef.current;
    const bs = selection.box.current;
    if (!bs) {
      if (el) el.style.display = 'none';
      if (ghost) ghost.style.display = 'none';
      return;
    }
    const minX = Math.min(bs.startTile.x, bs.curTile.x);
    const minY = Math.min(bs.startTile.y, bs.curTile.y);
    const maxX = Math.max(bs.startTile.x, bs.curTile.x);
    const maxY = Math.max(bs.startTile.y, bs.curTile.y);
    const screenX = (minX * TILE - camX) * zoom;
    const screenY = (minY * TILE - camY) * zoom;
    const w = (maxX - minX + 1) * TILE * zoom;
    const h = (maxY - minY + 1) * TILE * zoom;
    const transform = `translate(${screenX}px, ${screenY}px)`;

    if (el) {
      el.style.display = 'block';
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
      el.style.transform = transform;
    }

    if (!ghost) return;
    const tool = inputs.current.activeTool;
    const brush = inputs.current.activeBrush;
    if (tool === 'brush' && brush && brush.serverId != null && brush.preview && !inputs.current.automagic) {
      const cols = brush.cols ?? 1;
      const rows = brush.rows ?? 1;
      ghost.style.display = 'block';
      ghost.style.transform = transform;
      ghost.style.width = `${w}px`;
      ghost.style.height = `${h}px`;
      ghost.style.opacity = '0.5';
      ghost.style.backgroundColor = 'transparent';
      ghost.style.backgroundImage = `url(${brush.preview})`;
      ghost.style.backgroundRepeat = 'repeat';
      ghost.style.backgroundSize = `${cols * TILE * zoom}px ${rows * TILE * zoom}px`;
    } else if (tool === 'eraser') {
      ghost.style.display = 'block';
      ghost.style.transform = transform;
      ghost.style.width = `${w}px`;
      ghost.style.height = `${h}px`;
      ghost.style.opacity = '1';
      ghost.style.backgroundImage = 'none';
      ghost.style.backgroundColor = 'rgba(239, 68, 68, 0.28)';
    } else {
      ghost.style.display = 'none';
    }
  }

  function draw() {
    const canvas = canvasRef.current;
    const renderer = gl.current;
    if (!canvas || !renderer) return;

    const { sprPath, transparency, floorZ } = inputs.current;
    const zoom = camera.zoomRef.current;
    frameTick.current++;

    const dpr = window.devicePixelRatio || 1;
    const vw = canvas.clientWidth;
    const vh = canvas.clientHeight;

    const screenScale = zoom * dpr;
    const inv = 1 / screenScale;
    const crisp = screenScale >= 1 || Math.abs(inv - Math.round(inv)) < 0.01;

    let bufW: number;
    let bufH: number;
    let scale: number;
    if (crisp) {
      scale = screenScale;
      bufW = Math.round(vw * dpr);
      bufH = Math.round(vh * dpr);
    } else {
      const intDpr = Math.max(1, Math.round(dpr));
      scale = intDpr;
      bufW = Math.ceil((vw / zoom) * intDpr);
      bufH = Math.ceil((vh / zoom) * intDpr);
    }
    if (canvas.width !== bufW || canvas.height !== bufH) {
      canvas.width = bufW;
      canvas.height = bufH;
    }

    const { x: camX, y: camY } = camera.ref.current;
    renderer.beginFrame(bufW, bufH, camX, camY, scale, 1);

    const { minX, minY, maxX, maxY } = inputs.current.map.bounds;
    const minCx = Math.floor(minX / CHUNK);
    const minCy = Math.floor(minY / CHUNK);
    const maxCx = Math.floor(maxX / CHUNK);
    const maxCy = Math.floor(maxY / CHUNK);

    const { startZ, endZ } = visibleFloorRange(floorZ);
    const dimLowerFloors = startZ !== endZ;

    const missing = new Set<number>();
    const deadline = performance.now() + BUILD_BUDGET_MS;
    let builds = 0;
    let drawn = 0;

    for (let z = startZ; z >= endZ; z--) {
      if (dimLowerFloors && z === endZ) renderer.dimViewport(LOWER_FLOOR_DIM);

      const shift = (z - endZ) * TILE;
      renderer.setFloorOffset(shift, shift);

      const fCamX = camX - shift;
      const fCamY = camY - shift;
      const startCx = Math.max(minCx, Math.floor(fCamX / CHUNK_WORLD));
      const endCx = Math.min(maxCx, Math.floor((fCamX + vw / zoom) / CHUNK_WORLD));
      const startCy = Math.max(minCy, Math.floor(fCamY / CHUNK_WORLD));
      const endCy = Math.min(maxCy, Math.floor((fCamY + vh / zoom) / CHUNK_WORLD));

      for (let cy = startCy; cy <= endCy; cy++) {
        for (let cx = startCx; cx <= endCx; cx++) {
          const ct = tiles.get(cx, cy, z, frameTick.current);
          if (ct === undefined) {
            tiles.request(cx, cy, z);
            continue;
          }
          if (ct === null) continue;
          const key = `${z},${cx},${cy}`;
          const m = meshes.data.current.get(key);
          const fresh = m && m.epoch === atlas.epoch.current && (m.complete || m.version === atlas.version.current);
          if (!fresh && builds < BUILD_BUDGET_MAX && performance.now() < deadline) {
            buildChunkMesh(cx, cy, z, missing);
            builds++;
          }
          const mm = meshes.data.current.get(key);
          if (mm) {
            mm.lastUsed = frameTick.current;
            if (mm.count > 0) {
              renderer.drawChunkMesh(key);
              drawn++;
            }
          }
        }
      }
    }
    const md = scene.moveDrag.current;
    if (md && md.active && scene.moveDest.current) {
      const ctx = { items: inputs.current.items, tiles, atlas };
      const ghost = buildTopItemMesh(
        ctx,
        frameTick.current,
        floorZ,
        md.from,
        scene.moveDest.current.x - md.from.x,
        scene.moveDest.current.y - md.from.y
      );
      if (ghost) renderer.drawGhost(ghost, camX, camY, scale, 0.55);
    } else if (scene.pendingMove.current) {
      renderer.drawGhost(scene.pendingMove.current, camX, camY, scale, 0.55);
    }

    const previewTiles = scene.boxGhostTiles.current;
    if (previewTiles && previewTiles.length > 0 && selection.box.current) {
      const ghost = buildPreviewGhost(previewTiles, missing);
      if (ghost.length > 0) renderer.drawGhost(ghost, camX, camY, scale, 0.6);
    }

    renderer.endFrame();
    lastChunksDrawn.current = drawn;

    updateGhost(camX, camY, zoom);
    updateSelectionBox(camX, camY, zoom);

    flushTileRequests();
    atlas.loadMissing(sprPath, missing, transparency);

    atlas.evict(frameTick.current);
    tiles.evict(frameTick.current);
    meshes.evict(frameTick.current);
  }

  React.useEffect(() => {
    let raf = 0;
    const s = { frames: 0, lastUpdate: 0, lastFrame: 0, jsSum: 0, maxFrame: 0, stalls: 0, started: false };

    const frame = (now: number) => {
      if (!s.started) {
        s.started = true;
        s.lastFrame = now;
        s.lastUpdate = now;
      }
      const frameTime = now - s.lastFrame;
      s.lastFrame = now;

      const jsStart = performance.now();
      draw();
      const jsTime = performance.now() - jsStart;

      s.frames++;
      s.jsSum += jsTime;
      if (frameTime > s.maxFrame) s.maxFrame = frameTime;
      if (frameTime > 25) s.stalls++;

      if (now - s.lastUpdate >= 250) {
        const fps = (s.frames * 1000) / (now - s.lastUpdate);
        if (stats.fpsRef.current) stats.fpsRef.current.textContent = String(Math.round(fps));
        if (stats.stallRef.current) stats.stallRef.current.textContent = String(s.stalls);
        if (stats.maxRef.current) stats.maxRef.current.textContent = `${Math.round(s.maxFrame)}ms`;
        if (stats.jsRef.current) stats.jsRef.current.textContent = `~${(s.jsSum / Math.max(1, s.frames)).toFixed(1)}ms`;
        if (stats.chunkRef.current) stats.chunkRef.current.textContent = String(lastChunksDrawn.current);
        s.frames = 0;
        s.jsSum = 0;
        s.maxFrame = 0;
        s.stalls = 0;
        s.lastUpdate = now;
      }

      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);
}
