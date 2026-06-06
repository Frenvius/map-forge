import React from 'react';

import { stepZoom } from '~/usecase/zoom';
import { LoadedSprite } from '~/domain/sprite';
import { getSpriteIndex } from '~/domain/tibia';
import { loadSprites } from '~/adapter/sprites';
import { DRAW_CURSOR } from '~/usecase/cursors';
import { Position, ChunkTiles } from '~/domain/map';
import { visibleFloorRange } from '~/usecase/floors';
import { slotUV, GLRenderer, ATLAS_SLOTS } from '~/usecase/glRenderer';
import { moveItem, deleteItem, paintTiles, packChunkKey, fetchMapChunks } from '~/adapter/map';

import { HoverInfo, HoverItem, MapCanvasProps } from './types';

const TILE = 32;
const MAX_ELEVATION = 24;
const LOWER_FLOOR_DIM = 0.5;
const CHUNK = 32;
const CHUNK_WORLD = CHUNK * TILE;
const SPRITE_CACHE_MAX = 12288;
const SPRITE_CACHE_LOW = 9216;
const TILE_CACHE_MAX = 8192;
const TILE_CACHE_LOW = 6144;
const MESH_CACHE_MAX = 4096;
const MESH_CACHE_LOW = 3072;
const BUILD_BUDGET_MS = 12;
const BUILD_BUDGET_MAX = 256;
const MOVE_THRESHOLD_SQ = 16;

interface Camera {
  x: number;
  y: number;
}

interface MeshInfo {
  count: number;
  version: number;
  epoch: number;
  complete: boolean;
  lastUsed: number;
}

const MapCanvas = ({
  map,
  items,
  itemNames,
  sprPath,
  transparency,
  floorZ,
  zoom,
  minZoom,
  maxZoom,
  onZoomChange,
  onFloorChange,
  onHover,
  onSelect,
  onSelectBrush,
  activeBrush
}: MapCanvasProps) => {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const fpsRef = React.useRef<HTMLSpanElement>(null);
  const stallRef = React.useRef<HTMLSpanElement>(null);
  const maxRef = React.useRef<HTMLSpanElement>(null);
  const jsRef = React.useRef<HTMLSpanElement>(null);
  const chunkRef = React.useRef<HTMLSpanElement>(null);

  const camera = React.useRef<Camera>({ x: 0, y: 0 });
  const drag = React.useRef<null | { startX: number; startY: number; camX: number; camY: number }>(null);
  const appliedZoom = React.useRef(zoom);
  const zoomRef = React.useRef(zoom);

  const gl = React.useRef<GLRenderer | null>(null);

  const spriteData = React.useRef(new Map<number, LoadedSprite>());
  const spriteLastUsed = React.useRef(new Map<number, number>());
  const requested = React.useRef(new Set<number>());
  const loading = React.useRef(false);
  const spriteVersion = React.useRef(0);
  const spriteEpoch = React.useRef(0);
  const frameTick = React.useRef(0);

  const spriteSlot = React.useRef(new Map<number, number>());
  const freeSlots = React.useRef<number[]>([]);
  const nextSlot = React.useRef(0);

  const chunkMesh = React.useRef(new Map<string, MeshInfo>());
  const lastChunksDrawn = React.useRef(0);

  const chunkTiles = React.useRef(new Map<string, ChunkTiles | null>());
  const tilesLastUsed = React.useRef(new Map<string, number>());
  const requestedChunks = React.useRef(new Set<string>());
  const pendingChunks = React.useRef(new Set<string>());

  const inputs = React.useRef({
    map,
    items,
    itemNames,
    sprPath,
    transparency,
    zoom,
    minZoom,
    maxZoom,
    onZoomChange,
    onFloorChange,
    onHover,
    onSelect,
    onSelectBrush,
    floorZ,
    activeBrush
  });
  inputs.current = {
    map,
    items,
    itemNames,
    sprPath,
    transparency,
    zoom,
    minZoom,
    maxZoom,
    onZoomChange,
    onFloorChange,
    onHover,
    onSelect,
    onSelectBrush,
    floorZ,
    activeBrush
  };

  const lastHoverKey = React.useRef<string | null>(null);
  const painting = React.useRef(false);
  const lastPaintKey = React.useRef<string | null>(null);
  const hoveredTile = React.useRef<Position | null>(null);
  const ghostRef = React.useRef<HTMLImageElement>(null);
  const highlightRef = React.useRef<HTMLDivElement>(null);
  const selected = React.useRef<Position | null>(null);
  const highlightedPos = React.useRef<Position | null>(null);
  const moveDrag = React.useRef<null | { from: Position; startX: number; startY: number; active: boolean }>(null);
  const moveDest = React.useRef<Position | null>(null);
  const pendingMove = React.useRef<Float32Array | null>(null);
  const [panning, setPanning] = React.useState(false);
  const [moving, setMoving] = React.useState(false);

  const paintable = activeBrush != null && activeBrush.serverId != null;
  const canvasCursor = paintable ? DRAW_CURSOR : panning ? 'grabbing' : moving ? 'grabbing' : 'default';

  const [menu, setMenu] = React.useState<null | {
    clientX: number;
    clientY: number;
    tile: Position;
    dest: Position | null;
    item: HoverItem | null;
  }>(null);
  const [gotoForm, setGotoForm] = React.useState<null | Position>(null);
  const [glError, setGlError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer: GLRenderer | null = null;
    try {
      renderer = new GLRenderer(canvas);
      gl.current = renderer;
    } catch (e) {
      console.error('WebGL init failed', e);
      setGlError(String(e));
    }
    return () => {
      gl.current = null;
      renderer?.dispose();
    };
  }, []);

  React.useEffect(() => {
    for (const key of chunkMesh.current.keys()) gl.current?.deleteChunkMesh(key);
    chunkMesh.current.clear();
    chunkTiles.current.clear();
    tilesLastUsed.current.clear();
    requestedChunks.current.clear();
    pendingChunks.current.clear();
  }, [map]);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cx = ((map.bounds.minX + map.bounds.maxX) / 2) * TILE;
    const cy = ((map.bounds.minY + map.bounds.maxY) / 2) * TILE;
    camera.current = { x: cx - canvas.clientWidth / (2 * zoom), y: cy - canvas.clientHeight / (2 * zoom) };
  }, [map]);

  React.useEffect(() => {
    if (zoom === appliedZoom.current) return;
    const canvas = canvasRef.current;
    if (canvas) {
      const sx = canvas.clientWidth / 2;
      const sy = canvas.clientHeight / 2;
      const wx = camera.current.x + sx / zoomRef.current;
      const wy = camera.current.y + sy / zoomRef.current;
      camera.current = { x: wx - sx / zoom, y: wy - sy / zoom };
    }
    appliedZoom.current = zoom;
    zoomRef.current = zoom;
  }, [zoom]);

  function spriteSlotFor(id: number, data: LoadedSprite): number {
    let slot = spriteSlot.current.get(id);
    if (slot === undefined) {
      if (freeSlots.current.length > 0) slot = freeSlots.current.pop()!;
      else if (nextSlot.current < ATLAS_SLOTS) slot = nextSlot.current++;
      else return -1;
      gl.current!.uploadSprite(slot, data.rgba);
      spriteSlot.current.set(id, slot);
    }
    return slot;
  }

  function getTiles(cx: number, cy: number, z: number): ChunkTiles | null | undefined {
    const k = `${z},${cx},${cy}`;
    const t = chunkTiles.current.get(k);
    if (t !== undefined) tilesLastUsed.current.set(k, frameTick.current);
    return t;
  }

  function requestTiles(cx: number, cy: number, z: number) {
    const k = `${z},${cx},${cy}`;
    if (requestedChunks.current.has(k)) return;
    requestedChunks.current.add(k);
    pendingChunks.current.add(k);
  }

  function flushTileRequests() {
    if (pendingChunks.current.size === 0) return;
    const byZ = new Map<number, number[]>();
    for (const k of pendingChunks.current) {
      const [z, cx, cy] = k.split(',').map(Number);
      let arr = byZ.get(z);
      if (!arr) {
        arr = [];
        byZ.set(z, arr);
      }
      arr.push(packChunkKey(cx, cy));
    }
    pendingChunks.current.clear();
    for (const [z, keys] of byZ) {
      fetchMapChunks(inputs.current.map.id, z, keys)
        .then((res) => {
          for (const packed of keys) {
            const cx = packed >>> 16;
            const cy = packed & 0xffff;
            const key = `${z},${cx},${cy}`;
            chunkTiles.current.set(key, res.get(`${cx},${cy}`) ?? null);
            tilesLastUsed.current.set(key, frameTick.current);
            chunkMesh.current.delete(key);
          }
          spriteVersion.current++;
        })
        .catch((err) => console.error('Failed to fetch chunks', err));
    }
  }

  function buildChunkMesh(cx: number, cy: number, z: number, missing: Set<number>) {
    const { items } = inputs.current;
    const key = `${z},${cx},${cy}`;
    const ct = chunkTiles.current.get(key) as ChunkTiles | null | undefined;
    const sel = selected.current;
    const selHere = sel != null && sel.z === z;
    const inst: number[] = [];
    let complete = true;

    if (ct) {
      for (let i = 0; i < ct.tileX.length; i++) {
        const tx = ct.tileX[i];
        const ty = ct.tileY[i];
        const end = ct.itemOffset[i + 1];
        const top = end - 1;
        const tintTile = selHere && sel!.x === tx && sel!.y === ty;
        let drawElevation = 0;
        for (let ii = ct.itemOffset[i]; ii < end; ii++) {
          const thing = items.get(ct.clientIds[ii]);
          if (!thing || thing.spriteIndex.length === 0) continue;
          const px = thing.patternX > 0 ? tx % thing.patternX : 0;
          const py = thing.patternY > 0 ? ty % thing.patternY : 0;
          const ox = (thing.offsetX || 0) + drawElevation;
          const oy = (thing.offsetY || 0) + drawElevation;
          const tint = tintTile && ii === top ? 1 : 0;

          for (let l = 0; l < thing.layers; l++) {
            for (let h = 0; h < thing.height; h++) {
              for (let w = 0; w < thing.width; w++) {
                const sid = thing.spriteIndex[getSpriteIndex(thing, w, h, l, px, py, 0, 0)];
                if (!sid) continue;
                const data = spriteData.current.get(sid);
                if (!data) {
                  missing.add(sid);
                  complete = false;
                  continue;
                }
                spriteLastUsed.current.set(sid, frameTick.current);
                if (data.empty) continue;
                const slot = spriteSlotFor(sid, data);
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

    gl.current!.setChunkMesh(key, new Float32Array(inst));
    chunkMesh.current.set(key, {
      count: inst.length / 5,
      version: spriteVersion.current,
      epoch: spriteEpoch.current,
      complete,
      lastUsed: frameTick.current
    });
  }

  function evictSprites() {
    if (spriteData.current.size <= SPRITE_CACHE_MAX) return;
    const ids = [...spriteData.current.keys()].sort(
      (a, b) => (spriteLastUsed.current.get(a) ?? 0) - (spriteLastUsed.current.get(b) ?? 0)
    );
    const toRemove = spriteData.current.size - SPRITE_CACHE_LOW;
    for (let i = 0; i < toRemove; i++) {
      const id = ids[i];
      spriteData.current.delete(id);
      spriteLastUsed.current.delete(id);
      requested.current.delete(id);
      const slot = spriteSlot.current.get(id);
      if (slot !== undefined) {
        spriteSlot.current.delete(id);
        freeSlots.current.push(slot);
      }
    }
    spriteEpoch.current++;
  }

  function evictTiles() {
    if (chunkTiles.current.size <= TILE_CACHE_MAX) return;
    const keys = [...chunkTiles.current.keys()].sort(
      (a, b) => (tilesLastUsed.current.get(a) ?? 0) - (tilesLastUsed.current.get(b) ?? 0)
    );
    const toRemove = chunkTiles.current.size - TILE_CACHE_LOW;
    for (let i = 0; i < toRemove; i++) {
      const k = keys[i];
      chunkTiles.current.delete(k);
      tilesLastUsed.current.delete(k);
      requestedChunks.current.delete(k);
    }
  }

  function evictMeshes() {
    if (chunkMesh.current.size <= MESH_CACHE_MAX) return;
    const keys = [...chunkMesh.current.keys()].sort(
      (a, b) => chunkMesh.current.get(a)!.lastUsed - chunkMesh.current.get(b)!.lastUsed
    );
    const toRemove = chunkMesh.current.size - MESH_CACHE_LOW;
    for (let i = 0; i < toRemove; i++) {
      const k = keys[i];
      gl.current?.deleteChunkMesh(k);
      chunkMesh.current.delete(k);
    }
  }

  function draw() {
    const canvas = canvasRef.current;
    const renderer = gl.current;
    if (!canvas || !renderer) return;

    const { sprPath, transparency, floorZ } = inputs.current;
    const zoom = zoomRef.current;
    frameTick.current++;

    const sel = selected.current;
    const prev = highlightedPos.current;
    if (sel?.x !== prev?.x || sel?.y !== prev?.y || sel?.z !== prev?.z) {
      if (prev) invalidateChunkMesh(prev.x, prev.y, prev.z);
      if (sel) invalidateChunkMesh(sel.x, sel.y, sel.z);
      highlightedPos.current = sel ? { x: sel.x, y: sel.y, z: sel.z } : null;
    }

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

    const { x: camX, y: camY } = camera.current;
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
          const ct = getTiles(cx, cy, z);
          if (ct === undefined) {
            requestTiles(cx, cy, z);
            continue;
          }
          if (ct === null) continue;
          const key = `${z},${cx},${cy}`;
          const m = chunkMesh.current.get(key);
          const fresh = m && m.epoch === spriteEpoch.current && (m.complete || m.version === spriteVersion.current);
          if (!fresh && builds < BUILD_BUDGET_MAX && performance.now() < deadline) {
            buildChunkMesh(cx, cy, z, missing);
            builds++;
          }
          const mm = chunkMesh.current.get(key);
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
    const md = moveDrag.current;
    if (md && md.active && moveDest.current) {
      const ghost = buildTopItemMesh(md.from, moveDest.current.x - md.from.x, moveDest.current.y - md.from.y);
      if (ghost) renderer.drawGhost(ghost, camX, camY, scale, 0.55);
    } else if (pendingMove.current) {
      renderer.drawGhost(pendingMove.current, camX, camY, scale, 0.55);
    }

    renderer.endFrame();
    lastChunksDrawn.current = drawn;

    updateGhost(camX, camY, zoom);

    flushTileRequests();

    const toFetch = [...missing].filter((id) => !requested.current.has(id));
    if (toFetch.length > 0 && !loading.current) {
      loading.current = true;
      toFetch.forEach((id) => requested.current.add(id));
      loadSprites(sprPath, toFetch, transparency, spriteData.current)
        .catch((err) => console.error('Failed to load sprites', err))
        .finally(() => {
          loading.current = false;
          spriteVersion.current++;
        });
    }

    evictSprites();
    evictTiles();
    evictMeshes();
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
        if (fpsRef.current) fpsRef.current.textContent = String(Math.round(fps));
        if (stallRef.current) stallRef.current.textContent = String(s.stalls);
        if (maxRef.current) maxRef.current.textContent = `${Math.round(s.maxFrame)}ms`;
        if (jsRef.current) jsRef.current.textContent = `~${(s.jsSum / Math.max(1, s.frames)).toFixed(1)}ms`;
        if (chunkRef.current) chunkRef.current.textContent = String(lastChunksDrawn.current);
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

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { onZoomChange } = inputs.current;
      const z = zoomRef.current;
      const newZoom = stepZoom(z, -e.deltaY);
      if (newZoom === z) return;

      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const wx = camera.current.x + sx / z;
      const wy = camera.current.y + sy / z;
      camera.current = { x: wx - sx / newZoom, y: wy - sy / newZoom };

      zoomRef.current = newZoom;
      appliedZoom.current = newZoom;
      onZoomChange(newZoom);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  function paintAt(pos: Position) {
    const brush = inputs.current.activeBrush;
    if (!brush || brush.serverId == null) return;
    const key = `${pos.x},${pos.y},${pos.z}`;
    if (key === lastPaintKey.current) return;
    lastPaintKey.current = key;
    paintTiles(inputs.current.map.id, pos.z, [pos.x], [pos.y], brush.serverId, brush.isGround)
      .then(() => refetchChunk(pos.x, pos.y, pos.z))
      .catch((err) => console.error('Failed to paint tile', err));
  }

  function refetchChunk(x: number, y: number, z: number) {
    const cx = Math.floor(x / CHUNK);
    const cy = Math.floor(y / CHUNK);
    const key = `${z},${cx},${cy}`;
    requestedChunks.current.add(key);
    pendingChunks.current.add(key);
  }

  function updateGhost(camX: number, camY: number, zoom: number) {
    const ghost = ghostRef.current;
    const outline = highlightRef.current;
    if (!ghost || !outline) return;

    const brush = inputs.current.activeBrush;
    const tile = hoveredTile.current;
    if (!brush || brush.serverId == null || !tile) {
      ghost.style.display = 'none';
      outline.style.display = 'none';
      return;
    }

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

  function buildTopItemMesh(tile: Position, shiftTilesX: number, shiftTilesY: number): Float32Array | null {
    const { items, floorZ } = inputs.current;
    if (tile.z !== floorZ) return null;

    const tx = tile.x;
    const ty = tile.y;
    const ct = getTiles(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK), floorZ);
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
              const data = spriteData.current.get(sid);
              if (!data || data.empty) continue;
              const slot = spriteSlotFor(sid, data);
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

  function onMouseDown(e: React.MouseEvent) {
    if (e.button === 1) {
      e.preventDefault();
      drag.current = { startX: e.clientX, startY: e.clientY, camX: camera.current.x, camY: camera.current.y };
      setPanning(true);
      return;
    }
    if (e.button !== 0) return;

    const brush = inputs.current.activeBrush;
    if (brush && brush.serverId != null) {
      painting.current = true;
      lastPaintKey.current = null;
      paintAt(tileUnderCursor(e));
      return;
    }

    const pos = tileUnderCursor(e);
    selected.current = pos;
    moveDest.current = pos;
    moveDrag.current = { from: pos, startX: e.clientX, startY: e.clientY, active: false };
    inputs.current.onSelect(hoverAt(pos).item);
  }
  function onMouseMove(e: React.MouseEvent) {
    if (painting.current) {
      paintAt(tileUnderCursor(e));
    } else if (drag.current) {
      const z = zoomRef.current;
      camera.current = {
        x: drag.current.camX - (e.clientX - drag.current.startX) / z,
        y: drag.current.camY - (e.clientY - drag.current.startY) / z
      };
    } else if (moveDrag.current) {
      const md = moveDrag.current;
      if (!md.active) {
        const dx = e.clientX - md.startX;
        const dy = e.clientY - md.startY;
        if (dx * dx + dy * dy > MOVE_THRESHOLD_SQ) {
          md.active = true;
          setMoving(true);
        }
      }
      if (md.active) moveDest.current = tileUnderCursor(e);
    }
    const pos = tileUnderCursor(e);
    hoveredTile.current = pos;
    const key = `${pos.x},${pos.y},${pos.z}`;
    if (key !== lastHoverKey.current) {
      lastHoverKey.current = key;
      inputs.current.onHover(hoverAt(pos));
    }
  }
  function onMouseUp() {
    finishMove();
    drag.current = null;
    painting.current = false;
    lastPaintKey.current = null;
    setPanning(false);
  }
  function onMouseLeave() {
    finishMove();
    drag.current = null;
    painting.current = false;
    lastPaintKey.current = null;
    lastHoverKey.current = null;
    hoveredTile.current = null;
    setPanning(false);
    inputs.current.onHover(null);
  }

  function finishMove() {
    const md = moveDrag.current;
    moveDrag.current = null;
    if (!md) return;
    setMoving(false);
    const dest = moveDest.current;
    moveDest.current = null;
    if (!md.active || !dest || (dest.x === md.from.x && dest.y === md.from.y)) return;

    const from = md.from;
    pendingMove.current = buildTopItemMesh(from, dest.x - from.x, dest.y - from.y);
    moveItem(inputs.current.map.id, from.z, from.x, from.y, dest.x, dest.y)
      .then(() => Promise.all([refetchChunkNow(from.x, from.y, from.z), refetchChunkNow(dest.x, dest.y, dest.z)]))
      .then(() => {
        selected.current = dest;
        spriteVersion.current++;
        inputs.current.onSelect(hoverAt(dest).item);
      })
      .catch((err) => console.error('Failed to move item', err))
      .finally(() => {
        pendingMove.current = null;
      });
  }

  function deleteSelected() {
    const pos = selected.current;
    if (!pos) return;
    deleteItem(inputs.current.map.id, pos.z, pos.x, pos.y)
      .then(() => refetchChunkNow(pos.x, pos.y, pos.z))
      .then(() => {
        spriteVersion.current++;
        inputs.current.onSelect(hoverAt(pos).item);
      })
      .catch((err) => console.error('Failed to delete item', err));
  }

  function invalidateChunkMesh(x: number, y: number, z: number) {
    const key = `${z},${Math.floor(x / CHUNK)},${Math.floor(y / CHUNK)}`;
    gl.current?.deleteChunkMesh(key);
    chunkMesh.current.delete(key);
  }

  async function refetchChunkNow(x: number, y: number, z: number) {
    const cx = Math.floor(x / CHUNK);
    const cy = Math.floor(y / CHUNK);
    const key = `${z},${cx},${cy}`;
    const res = await fetchMapChunks(inputs.current.map.id, z, [packChunkKey(cx, cy)]);
    chunkTiles.current.set(key, res.get(`${cx},${cy}`) ?? null);
    tilesLastUsed.current.set(key, frameTick.current);
    requestedChunks.current.add(key);
    chunkMesh.current.delete(key);
  }

  function hoverAt(pos: Position): HoverInfo {
    const { items, itemNames } = inputs.current;
    const ct = getTiles(Math.floor(pos.x / CHUNK), Math.floor(pos.y / CHUNK), pos.z);
    if (ct === undefined) requestTiles(Math.floor(pos.x / CHUNK), Math.floor(pos.y / CHUNK), pos.z);
    let found = -1;
    if (ct) {
      for (let i = 0; i < ct.tileX.length; i++) {
        if (ct.tileX[i] === pos.x && ct.tileY[i] === pos.y) {
          found = i;
          break;
        }
      }
    }
    let item: HoverItem | null = null;
    if (ct && found >= 0) {
      const start = ct.itemOffset[found];
      const end = ct.itemOffset[found + 1];
      const count = end - start;
      if (count > 0) {
        const top = end - 1;
        const clientId = ct.clientIds[top];
        const serverId = ct.serverIds[top];
        const thing = items.get(clientId);
        item = { serverId, clientId, name: itemNames.get(serverId) ?? thing?.marketName ?? '', count };
      }
    }
    return { x: pos.x, y: pos.y, z: pos.z, hasTile: found >= 0, item };
  }

  function goTo(pos: Position) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const z = zoomRef.current;
    camera.current = {
      x: (pos.x + 0.5) * TILE - canvas.clientWidth / (2 * z),
      y: (pos.y + 0.5) * TILE - canvas.clientHeight / (2 * z)
    };
    inputs.current.onFloorChange(pos.z);
    setMenu(null);
    setGotoForm(null);
  }

  function tileUnderCursor(e: React.MouseEvent): Position {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const z = zoomRef.current;
    const wx = camera.current.x + (e.clientX - rect.left) / z;
    const wy = camera.current.y + (e.clientY - rect.top) / z;
    return { x: Math.floor(wx / TILE), y: Math.floor(wy / TILE), z: inputs.current.floorZ };
  }

  function onContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    if (!canvasRef.current) return;
    if (inputs.current.activeBrush) inputs.current.onSelectBrush(null);
    const tile = tileUnderCursor(e);
    const info = hoverAt(tile);
    selected.current = tile;
    inputs.current.onSelect(info.item);
    const dest = inputs.current.map.teleports.get(`${tile.x},${tile.y},${tile.z}`) ?? null;
    setMenu({ clientX: e.clientX, clientY: e.clientY, tile, dest, item: info.item });
  }

  function buildItemPreview(clientId: number): string | undefined {
    const thing = inputs.current.items.get(clientId);
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
          const data = spriteData.current.get(sid);
          if (!data || data.empty) continue;
          ctx.putImageData(new ImageData(new Uint8ClampedArray(data.rgba), TILE, TILE), (w - 1 - ww) * TILE, (h - 1 - hh) * TILE);
          drew = true;
        }
      }
    }
    return drew ? canvas.toDataURL() : undefined;
  }

  function selectRaw(item: HoverItem) {
    const thing = inputs.current.items.get(item.clientId);
    inputs.current.onSelectBrush({
      key: `raw-${item.serverId}`,
      name: item.name || `Item ${item.serverId}`,
      kind: 'rawItem',
      serverId: item.serverId,
      isGround: thing?.isGround ?? false,
      cols: thing?.width ?? 1,
      rows: thing?.height ?? 1,
      preview: buildItemPreview(item.clientId)
    });
    setMenu(null);
  }

  React.useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('blur', close);
    };
  }, [menu]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (e.key === 'Delete' && selected.current) {
        e.preventDefault();
        deleteSelected();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="relative h-full w-full">
      <canvas
        ref={canvasRef}
        onMouseUp={onMouseUp}
        className="h-full w-full"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        onContextMenu={onContextMenu}
        style={{ cursor: canvasCursor, display: 'block' }}
      />
      <img
        alt=""
        aria-hidden
        ref={ghostRef}
        className="pointer-events-none absolute left-0 top-0 hidden"
        style={{ opacity: 0.6, imageRendering: 'pixelated', transformOrigin: 'top left' }}
      />
      <div
        ref={highlightRef}
        style={{ transformOrigin: 'top left' }}
        className="pointer-events-none absolute left-0 top-0 hidden rounded-[2px] border border-primary/70 bg-primary/5"
      />
      {glError && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-destructive">
          WebGL unavailable: {glError}
        </div>
      )}
      <div className="pointer-events-none absolute bottom-3 right-3 select-none rounded-md border border-emerald-500/30 bg-black/70 px-3 py-2 font-mono text-[11px] leading-tight text-emerald-400 shadow-island">
        <div className="mb-1 font-semibold tracking-wider text-emerald-300">RENDER STATS</div>
        <div>
          FPS: <span ref={fpsRef}>-</span>
        </div>
        <div>
          Stalls (&gt;25ms): <span ref={stallRef}>0</span>
        </div>
        <div>
          Max frame: <span ref={maxRef}>0ms</span> | JS: <span ref={jsRef}>0ms</span>
        </div>
        <div>
          Chunks drawn: <span ref={chunkRef}>0</span>
        </div>
      </div>

      {menu && (
        <div
          onMouseDown={(e) => e.stopPropagation()}
          style={{ left: menu.clientX, top: menu.clientY }}
          className="fixed z-50 min-w-[200px] overflow-hidden rounded-md border border-border bg-popover py-1 text-sm text-popover-foreground shadow-island-lg"
        >
          {menu.item && (
            <>
              <button
                onClick={() => selectRaw(menu.item!)}
                className="flex w-full items-center px-3 py-1.5 text-left hover:bg-accent"
              >
                Select RAW{menu.item.name ? ` "${menu.item.name}"` : ''}
              </button>
              <div className="my-1 h-px bg-border" />
            </>
          )}
          {menu.dest ? (
            <button onClick={() => goTo(menu.dest!)} className="flex w-full items-center px-3 py-1.5 text-left hover:bg-accent">
              Go to destination ({menu.dest.x}, {menu.dest.y}, {menu.dest.z})
            </button>
          ) : (
            <div className="px-3 py-1.5 text-muted-foreground">No portal here</div>
          )}
          <div className="my-1 h-px bg-border" />
          <button
            className="flex w-full items-center px-3 py-1.5 text-left hover:bg-accent"
            onClick={() => {
              setGotoForm(menu.tile);
              setMenu(null);
            }}
          >
            Go to position...
          </button>
          <div className="px-3 py-1 text-xs text-muted-foreground">
            Here: {menu.tile.x}, {menu.tile.y}, {menu.tile.z}
          </div>
        </div>
      )}

      {gotoForm && (
        <div onMouseDown={() => setGotoForm(null)} className="absolute inset-0 z-50 flex items-center justify-center bg-black/40">
          <form
            onMouseDown={(e) => e.stopPropagation()}
            className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-island-lg"
            onSubmit={(e) => {
              e.preventDefault();
              goTo(gotoForm);
            }}
          >
            <div className="text-sm font-medium">Go to position</div>
            <div className="flex gap-2">
              {(['x', 'y', 'z'] as const).map((axis) => (
                <label key={axis} className="flex flex-col gap-1 text-xs text-muted-foreground">
                  {axis.toUpperCase()}
                  <input
                    type="number"
                    value={gotoForm[axis]}
                    onChange={(e) => setGotoForm({ ...gotoForm, [axis]: Number(e.target.value) })}
                    className="w-24 rounded border border-input bg-background px-2 py-1 text-sm text-foreground outline-none focus:border-ring"
                  />
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setGotoForm(null)}
                className="rounded border border-border px-3 py-1.5 text-sm hover:bg-accent"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/85"
              >
                Go
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default MapCanvas;
