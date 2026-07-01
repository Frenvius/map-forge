import React from 'react';
import { LogicalPosition } from '@tauri-apps/api/dpi';
import { getCurrentWindow } from '@tauri-apps/api/window';

import { stepZoom } from '~/usecase/zoom';
import { MapMeta, Position } from '~/domain/map';
import { Camera } from '~/components/MapCanvas/types';
import { TILE } from '~/components/MapCanvas/constants';
import { MAP_MIN_LAYER, MAP_MAX_LAYER } from '~/usecase/floors';

const EDGE = 2;
const LAND_TOL = 80;

function warpCursor(x: number, y: number) {
  try {
    void getCurrentWindow()
      .setCursorPosition(new LogicalPosition(x, y))
      .catch(() => undefined);
  } catch {
    /* not running under tauri */
  }
}

export interface MapCamera {
  ref: React.MutableRefObject<Camera>;
  zoomRef: React.MutableRefObject<number>;
  panning: boolean;
  beginPan: (e: React.MouseEvent) => void;
  panMove: (e: React.MouseEvent) => boolean;
  endPan: () => void;
  tileUnderCursor: (e: React.MouseEvent, floorZ: number) => Position;
  worldUnderCursor: (e: React.MouseEvent) => { x: number; y: number };
  centerOn: (pos: Position) => void;
}

export function useMapCamera(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  map: MapMeta,
  zoom: number,
  onZoomChange: (zoom: number) => void,
  initialCenter: { x: number; y: number },
  floorInput: React.RefObject<{ floorZ: number; onFloorChange: (z: number) => void }>,
  onViewChange?: (cx: number, cy: number) => void,
  infiniteMouse = true
): MapCamera {
  const ref = React.useRef<Camera>({ x: 0, y: 0 });
  const zoomRef = React.useRef(zoom);
  const appliedZoom = React.useRef(zoom);
  const drag = React.useRef<null | { lastX: number; lastY: number; warp: { x: number; y: number } | null }>(null);
  const infiniteRef = React.useRef(infiniteMouse);
  infiniteRef.current = infiniteMouse;
  const [panning, setPanning] = React.useState(false);

  const onZoomChangeRef = React.useRef(onZoomChange);
  onZoomChangeRef.current = onZoomChange;

  const onViewChangeRef = React.useRef(onViewChange);
  onViewChangeRef.current = onViewChange;

  const initialRef = React.useRef(initialCenter);
  const saveTimer = React.useRef(0);

  const scheduleSave = React.useCallback(() => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const z = zoomRef.current;
      const cx = (ref.current.x + canvas.clientWidth / (2 * z)) / TILE - 0.5;
      const cy = (ref.current.y + canvas.clientHeight / (2 * z)) / TILE - 0.5;
      onViewChangeRef.current?.(cx, cy);
    }, 500);
  }, [canvasRef]);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const z = zoomRef.current;
    ref.current = {
      x: (initialRef.current.x + 0.5) * TILE - canvas.clientWidth / (2 * z),
      y: (initialRef.current.y + 0.5) * TILE - canvas.clientHeight / (2 * z)
    };
  }, [map, canvasRef]);

  React.useEffect(() => {
    if (zoom === appliedZoom.current) return;
    const canvas = canvasRef.current;
    if (canvas) {
      const sx = canvas.clientWidth / 2;
      const sy = canvas.clientHeight / 2;
      const wx = ref.current.x + sx / zoomRef.current;
      const wy = ref.current.y + sy / zoomRef.current;
      ref.current = { x: wx - sx / zoom, y: wy - sy / zoom };
    }
    appliedZoom.current = zoom;
    zoomRef.current = zoom;
  }, [zoom]);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();

      if (e.ctrlKey || e.metaKey) {
        const fi = floorInput.current;
        if (!fi) return;
        const next = e.deltaY < 0 ? fi.floorZ - 1 : fi.floorZ + 1;
        const clamped = Math.min(MAP_MAX_LAYER, Math.max(MAP_MIN_LAYER, next));
        if (clamped !== fi.floorZ) fi.onFloorChange(clamped);
        return;
      }

      const z = zoomRef.current;
      const newZoom = stepZoom(z, -e.deltaY);
      if (newZoom === z) return;

      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const wx = ref.current.x + sx / z;
      const wy = ref.current.y + sy / z;
      ref.current = { x: wx - sx / newZoom, y: wy - sy / newZoom };

      zoomRef.current = newZoom;
      appliedZoom.current = newZoom;
      onZoomChangeRef.current(newZoom);
      scheduleSave();
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [canvasRef, scheduleSave]);

  React.useEffect(() => {
    const dirs: Record<string, [number, number]> = {
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      w: [0, -1],
      s: [0, 1],
      a: [-1, 0],
      d: [1, 0]
    };
    const normalize = (key: string) => (key.length === 1 ? key.toLowerCase() : key);
    const held = new Set<string>();
    const speed = 900;
    let raf = 0;
    let last = 0;

    const step = (now: number) => {
      if (held.size === 0) {
        raf = 0;
        return;
      }
      const dt = last ? (now - last) / 1000 : 0;
      last = now;
      let dx = 0;
      let dy = 0;
      for (const k of held) {
        dx += dirs[k][0];
        dy += dirs[k][1];
      }
      if (dx || dy) {
        const z = zoomRef.current;
        ref.current = { x: ref.current.x + (dx * speed * dt) / z, y: ref.current.y + (dy * speed * dt) / z };
        scheduleSave();
      }
      raf = requestAnimationFrame(step);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      const key = normalize(e.key);
      if (!(key in dirs)) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      e.preventDefault();
      if (!held.has(key)) {
        held.add(key);
        if (!raf) {
          last = 0;
          raf = requestAnimationFrame(step);
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => held.delete(normalize(e.key));
    const onBlur = () => held.clear();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [scheduleSave]);

  const applyPan = React.useCallback(
    (clientX: number, clientY: number) => {
      const d = drag.current;
      if (!d) return;

      if (d.warp) {
        if (Math.abs(clientX - d.warp.x) < LAND_TOL && Math.abs(clientY - d.warp.y) < LAND_TOL) {
          drag.current = { lastX: clientX, lastY: clientY, warp: null };
          return;
        }
      }

      const z = zoomRef.current;
      ref.current = { x: ref.current.x - (clientX - d.lastX) / z, y: ref.current.y - (clientY - d.lastY) / z };

      if (infiniteRef.current) {
        const canvas = canvasRef.current;
        let nx = clientX;
        let ny = clientY;
        let wrapped = false;
        if (canvas && !d.warp) {
          const r = canvas.getBoundingClientRect();
          if (clientX <= r.left + EDGE) {
            nx = r.right - EDGE - 1;
            wrapped = true;
          } else if (clientX >= r.right - EDGE) {
            nx = r.left + EDGE + 1;
            wrapped = true;
          }
          if (clientY <= r.top + EDGE) {
            ny = r.bottom - EDGE - 1;
            wrapped = true;
          } else if (clientY >= r.bottom - EDGE) {
            ny = r.top + EDGE + 1;
            wrapped = true;
          }
        }
        if (wrapped) {
          warpCursor(nx, ny);
          drag.current = { lastX: clientX, lastY: clientY, warp: { x: nx, y: ny } };
        } else {
          drag.current = { lastX: clientX, lastY: clientY, warp: d.warp };
        }
      } else {
        drag.current = { lastX: clientX, lastY: clientY, warp: null };
      }
    },
    [canvasRef]
  );

  const winMove = React.useRef<((e: MouseEvent) => void) | null>(null);
  const winUp = React.useRef<(() => void) | null>(null);

  const endPan = React.useCallback(() => {
    if (!drag.current) return;
    drag.current = null;
    setPanning(false);
    if (winMove.current) window.removeEventListener('mousemove', winMove.current);
    if (winUp.current) window.removeEventListener('mouseup', winUp.current);
    winMove.current = null;
    winUp.current = null;
    scheduleSave();
  }, [scheduleSave]);

  function beginPan(e: React.MouseEvent) {
    drag.current = { lastX: e.clientX, lastY: e.clientY, warp: null };
    setPanning(true);
    const mv = (ev: MouseEvent) => applyPan(ev.clientX, ev.clientY);
    const up = () => endPan();
    winMove.current = mv;
    winUp.current = up;
    window.addEventListener('mousemove', mv);
    window.addEventListener('mouseup', up);
  }

  function panMove(): boolean {
    return drag.current != null;
  }

  React.useEffect(() => endPan, [endPan]);

  function tileUnderCursor(e: React.MouseEvent, floorZ: number): Position {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const z = zoomRef.current;
    const wx = ref.current.x + (e.clientX - rect.left) / z;
    const wy = ref.current.y + (e.clientY - rect.top) / z;
    return { x: Math.floor(wx / TILE), y: Math.floor(wy / TILE), z: floorZ };
  }

  function worldUnderCursor(e: React.MouseEvent): { x: number; y: number } {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const z = zoomRef.current;
    return { x: ref.current.x + (e.clientX - rect.left) / z, y: ref.current.y + (e.clientY - rect.top) / z };
  }

  function centerOn(pos: Position) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const z = zoomRef.current;
    ref.current = {
      x: (pos.x + 0.5) * TILE - canvas.clientWidth / (2 * z),
      y: (pos.y + 0.5) * TILE - canvas.clientHeight / (2 * z)
    };
    scheduleSave();
  }

  return { ref, zoomRef, panning, beginPan, panMove, endPan, tileUnderCursor, worldUnderCursor, centerOn };
}
