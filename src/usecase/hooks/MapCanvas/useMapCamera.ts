import React from 'react';

import { stepZoom } from '~/usecase/zoom';
import { MapMeta, Position } from '~/domain/map';
import { Camera } from '~/components/MapCanvas/types';
import { TILE } from '~/components/MapCanvas/constants';

export interface MapCamera {
  ref: React.MutableRefObject<Camera>;
  zoomRef: React.MutableRefObject<number>;
  panning: boolean;
  beginPan: (e: React.MouseEvent) => void;
  panMove: (e: React.MouseEvent) => boolean;
  endPan: () => void;
  tileUnderCursor: (e: React.MouseEvent, floorZ: number) => Position;
  centerOn: (pos: Position) => void;
}

export function useMapCamera(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  map: MapMeta,
  zoom: number,
  onZoomChange: (zoom: number) => void
): MapCamera {
  const ref = React.useRef<Camera>({ x: 0, y: 0 });
  const zoomRef = React.useRef(zoom);
  const appliedZoom = React.useRef(zoom);
  const drag = React.useRef<null | { startX: number; startY: number; camX: number; camY: number }>(null);
  const [panning, setPanning] = React.useState(false);

  const onZoomChangeRef = React.useRef(onZoomChange);
  onZoomChangeRef.current = onZoomChange;

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cx = ((map.bounds.minX + map.bounds.maxX) / 2) * TILE;
    const cy = ((map.bounds.minY + map.bounds.maxY) / 2) * TILE;
    ref.current = { x: cx - canvas.clientWidth / (2 * zoom), y: cy - canvas.clientHeight / (2 * zoom) };
  }, [map]);

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
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  function beginPan(e: React.MouseEvent) {
    drag.current = { startX: e.clientX, startY: e.clientY, camX: ref.current.x, camY: ref.current.y };
    setPanning(true);
  }

  function panMove(e: React.MouseEvent): boolean {
    if (!drag.current) return false;
    const z = zoomRef.current;
    ref.current = {
      x: drag.current.camX - (e.clientX - drag.current.startX) / z,
      y: drag.current.camY - (e.clientY - drag.current.startY) / z
    };
    return true;
  }

  function endPan() {
    drag.current = null;
    setPanning(false);
  }

  function tileUnderCursor(e: React.MouseEvent, floorZ: number): Position {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const z = zoomRef.current;
    const wx = ref.current.x + (e.clientX - rect.left) / z;
    const wy = ref.current.y + (e.clientY - rect.top) / z;
    return { x: Math.floor(wx / TILE), y: Math.floor(wy / TILE), z: floorZ };
  }

  function centerOn(pos: Position) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const z = zoomRef.current;
    ref.current = {
      x: (pos.x + 0.5) * TILE - canvas.clientWidth / (2 * z),
      y: (pos.y + 0.5) * TILE - canvas.clientHeight / (2 * z)
    };
  }

  return { ref, zoomRef, panning, beginPan, panMove, endPan, tileUnderCursor, centerOn };
}
