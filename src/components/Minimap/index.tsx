import React from 'react';
import { X, Plus, Minus } from 'lucide-react';

import { cn } from '~/usecase/classNames';
import { fetchMinimap } from '~/adapter/minimap';
import { miniMapRgb } from '~/usecase/minimapColor';
import { MapView, MinimapImage } from '~/domain/map';
import { DragHandleProps } from '~/components/Dock/DockablePanel';

const TILE = 32;
const EDIT_DEBOUNCE_MS = 150;
const FETCH_DEBOUNCE_MS = 60;
const MIN_CELL_PX = 1;
const MAX_CELL_PX = 32;
const DEFAULT_CELL_PX = 4;
const WINDOW_MARGIN = 3;
const MAX_WINDOW = 2048;

interface Meta {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

interface Mapping {
  scale: number;
  ox: number;
  oy: number;
}

interface Window {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MinimapApi {
  markDirty: (z: number) => void;
}

interface MinimapProps {
  mapId: number;
  floorZ: number;
  paletteReady: boolean;
  onClose?: () => void;
  headerMenu?: React.ReactNode;
  dragHandle?: DragHandleProps;
  viewRef: React.MutableRefObject<MapView | null>;
  apiRef: React.MutableRefObject<MinimapApi | null>;
  centerRef: React.MutableRefObject<((x: number, y: number) => void) | null>;
}

const Minimap = ({ mapId, floorZ, paletteReady, onClose, headerMenu, dragHandle, viewRef, apiRef, centerRef }: MinimapProps) => {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const offscreenRef = React.useRef<HTMLCanvasElement | null>(null);
  const metaRef = React.useRef<Meta>({ minX: 0, minY: 0, width: 0, height: 0 });
  const mappingRef = React.useRef<Mapping | null>(null);
  const floorRef = React.useRef(floorZ);
  const seqRef = React.useRef(0);
  const timerRef = React.useRef<number | null>(null);
  const offVersionRef = React.useRef(0);
  const reqWinRef = React.useRef<Window | null>(null);
  const fetchTimerRef = React.useRef<number | null>(null);
  const dragPtrRef = React.useRef<{ x: number; y: number } | null>(null);
  const [cellPx, setCellPx] = React.useState(DEFAULT_CELL_PX);
  const cellPxRef = React.useRef(cellPx);

  floorRef.current = floorZ;
  cellPxRef.current = cellPx;

  const zoomBy = React.useCallback((delta: number) => {
    setCellPx((prev) => Math.min(MAX_CELL_PX, Math.max(MIN_CELL_PX, prev + delta)));
  }, []);

  const desiredWindow = React.useCallback((): Window | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const cell = cellPxRef.current;
    const w = Math.max(16, Math.min(MAX_WINDOW, Math.ceil((canvas.clientWidth / cell) * WINDOW_MARGIN)));
    const h = Math.max(16, Math.min(MAX_WINDOW, Math.ceil((canvas.clientHeight / cell) * WINDOW_MARGIN)));
    const v = viewRef.current;
    let cx = 0;
    let cy = 0;
    if (v && v.zoom > 0) {
      cx = (v.camX + v.vw / (2 * v.zoom)) / TILE;
      cy = (v.camY + v.vh / (2 * v.zoom)) / TILE;
    }
    return { x: Math.max(0, Math.round(cx - w / 2)), y: Math.max(0, Math.round(cy - h / 2)), w, h };
  }, [viewRef]);

  const buildOffscreen = React.useCallback((img: MinimapImage) => {
    let off = offscreenRef.current;
    if (!off) {
      off = document.createElement('canvas');
      offscreenRef.current = off;
    }
    if (img.width === 0 || img.height === 0) {
      metaRef.current = { minX: img.minX, minY: img.minY, width: 0, height: 0 };
      offVersionRef.current++;
      return;
    }
    off.width = img.width;
    off.height = img.height;
    const ctx = off.getContext('2d');
    if (!ctx) return;
    const id = ctx.createImageData(img.width, img.height);
    const out = id.data;
    const px = img.width * img.height;
    for (let i = 0; i < px; i++) {
      const c = img.data[i];
      const o = i * 4;
      if (!c) {
        out[o + 3] = 0;
        continue;
      }
      const [r, g, b] = miniMapRgb(c);
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = 255;
    }
    ctx.putImageData(id, 0, 0);
    metaRef.current = { minX: img.minX, minY: img.minY, width: img.width, height: img.height };
    offVersionRef.current++;
  }, []);

  const recompute = React.useCallback(() => {
    if (!paletteReady) return;
    const win = desiredWindow();
    if (!win) return;
    reqWinRef.current = win;
    const seq = ++seqRef.current;
    fetchMinimap(mapId, floorRef.current, win.x, win.y, win.w, win.h)
      .then((img) => {
        if (seq === seqRef.current) buildOffscreen(img);
      })
      .catch((err) => console.error('Failed to build minimap', err));
  }, [mapId, paletteReady, desiredWindow, buildOffscreen]);

  const scheduleFetch = React.useCallback(() => {
    if (fetchTimerRef.current) window.clearTimeout(fetchTimerRef.current);
    fetchTimerRef.current = window.setTimeout(() => {
      fetchTimerRef.current = null;
      recompute();
    }, FETCH_DEBOUNCE_MS);
  }, [recompute]);

  React.useEffect(() => {
    reqWinRef.current = null;
    recompute();
  }, [recompute, floorZ]);

  React.useEffect(() => {
    apiRef.current = {
      markDirty: (z: number) => {
        if (z !== floorRef.current) return;
        if (timerRef.current) window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => {
          timerRef.current = null;
          recompute();
        }, EDIT_DEBOUNCE_MS);
      }
    };
    return () => {
      apiRef.current = null;
      if (timerRef.current) window.clearTimeout(timerRef.current);
      if (fetchTimerRef.current) window.clearTimeout(fetchTimerRef.current);
    };
  }, [apiRef, recompute]);

  React.useEffect(() => {
    let raf = 0;
    let lastSig = '';
    const draw = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        const dpr = window.devicePixelRatio || 1;
        const cw = Math.round(canvas.clientWidth * dpr);
        const ch = Math.round(canvas.clientHeight * dpr);
        if (cw > 0 && ch > 0) {
          const v = viewRef.current;
          const sig = `${cw}x${ch}:${offVersionRef.current}:${cellPxRef.current}:${v ? `${v.camX},${v.camY},${v.zoom},${v.vw},${v.vh}` : 'none'}`;
          if (sig === lastSig && canvas.width === cw && canvas.height === ch) {
            raf = requestAnimationFrame(draw);
            return;
          }
          lastSig = sig;
          if (canvas.width !== cw || canvas.height !== ch) {
            canvas.width = cw;
            canvas.height = ch;
          }
          const ctx = canvas.getContext('2d');
          const off = offscreenRef.current;
          const meta = metaRef.current;
          if (ctx) {
            ctx.clearRect(0, 0, cw, ch);
            const scale = cellPxRef.current * dpr;
            let centerTileX = meta.minX + meta.width / 2;
            let centerTileY = meta.minY + meta.height / 2;
            if (v && v.zoom > 0) {
              centerTileX = (v.camX + v.vw / (2 * v.zoom)) / TILE;
              centerTileY = (v.camY + v.vh / (2 * v.zoom)) / TILE;
            }
            if (off && meta.width > 0) {
              const ox = cw / 2 - (centerTileX - meta.minX) * scale;
              const oy = ch / 2 - (centerTileY - meta.minY) * scale;
              ctx.imageSmoothingEnabled = false;
              ctx.drawImage(off, ox, oy, meta.width * scale, meta.height * scale);
              mappingRef.current = { scale, ox, oy };

              if (v && v.zoom > 0) {
                const left = ox + (v.camX / TILE - meta.minX) * scale;
                const top = oy + (v.camY / TILE - meta.minY) * scale;
                const w = (v.vw / v.zoom / TILE) * scale;
                const h = (v.vh / v.zoom / TILE) * scale;
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
                ctx.lineWidth = Math.max(1, dpr);
                ctx.strokeRect(left, top, w, h);
              }
            } else {
              mappingRef.current = null;
            }

            const want = desiredWindow();
            const req = reqWinRef.current;
            if (want) {
              const driftX = Math.max(8, want.w * 0.2);
              const driftY = Math.max(8, want.h * 0.2);
              const sizeChanged = !req || want.w !== req.w || want.h !== req.h;
              if (sizeChanged || Math.abs(want.x - req.x) > driftX || Math.abs(want.y - req.y) > driftY) {
                reqWinRef.current = want;
                scheduleFetch();
              }
            }
          }
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [viewRef, desiredWindow, scheduleFetch]);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 1 : -1);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [zoomBy]);

  const jumpTo = (e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    const m = mappingRef.current;
    const meta = metaRef.current;
    if (!canvas || !m || meta.width === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const dx = (e.clientX - rect.left) * dpr;
    const dy = (e.clientY - rect.top) * dpr;
    const tx = meta.minX + (dx - m.ox) / m.scale;
    const ty = meta.minY + (dy - m.oy) / m.scale;
    centerRef.current?.(tx, ty);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragPtrRef.current = { x: e.clientX, y: e.clientY };
    jumpTo(e);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!(e.buttons & 1) || !dragPtrRef.current) return;
    const m = mappingRef.current;
    const v = viewRef.current;
    if (!m || !v || v.zoom <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    const dtx = ((e.clientX - dragPtrRef.current.x) * dpr) / m.scale;
    const dty = ((e.clientY - dragPtrRef.current.y) * dpr) / m.scale;
    dragPtrRef.current = { x: e.clientX, y: e.clientY };
    const cx = (v.camX + v.vw / (2 * v.zoom)) / TILE + dtx;
    const cy = (v.camY + v.vh / (2 * v.zoom)) / TILE + dty;
    centerRef.current?.(cx, cy);
  };

  const onPointerUp = () => {
    dragPtrRef.current = null;
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-lg bg-card shadow-island">
      <div
        ref={dragHandle?.ref}
        {...dragHandle?.attributes}
        {...dragHandle?.listeners}
        className={cn(
          'flex h-7 flex-shrink-0 items-center border-b border-border/50 bg-secondary/80 px-3',
          dragHandle?.className
        )}
      >
        <h2 className="text-xs font-semibold uppercase tracking-wide text-foreground">Minimap</h2>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">z {floorZ}</span>
        {headerMenu && <div className="ml-1">{headerMenu}</div>}
        {onClose && (
          <button
            onClick={onClose}
            title="Close minimap"
            onPointerDown={(e) => e.stopPropagation()}
            className="ml-0.5 flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-item-hover hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="relative min-h-0 flex-1 bg-[#11151c] p-1">
        <canvas
          ref={canvasRef}
          onPointerUp={onPointerUp}
          onPointerMove={onPointerMove}
          onPointerDown={onPointerDown}
          onPointerCancel={onPointerUp}
          className="h-full w-full cursor-pointer"
          style={{ display: 'block', imageRendering: 'pixelated' }}
        />
        <div
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute right-2 top-2 flex flex-col items-center overflow-hidden rounded-md border border-border/60 bg-card/90 shadow-island backdrop-blur-sm"
        >
          <button
            title="Zoom in"
            onClick={() => zoomBy(1)}
            className="flex h-6 w-6 items-center justify-center text-muted-foreground hover:bg-item-hover hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <span className="w-6 text-center font-mono text-[10px] text-foreground">{cellPx}</span>
          <button
            title="Zoom out"
            onClick={() => zoomBy(-1)}
            className="flex h-6 w-6 items-center justify-center text-muted-foreground hover:bg-item-hover hover:text-foreground"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default Minimap;
