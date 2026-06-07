import React from 'react';

import { DRAW_CURSOR } from '~/usecase/cursors';
import { GLRenderer } from '~/usecase/glRenderer';
import { useMapScene } from '~/usecase/hooks/MapCanvas/useMapScene';
import { useSelection } from '~/usecase/hooks/MapCanvas/useSelection';
import { useMapCamera } from '~/usecase/hooks/MapCanvas/useMapCamera';
import { useChunkTiles } from '~/usecase/hooks/MapCanvas/useChunkTiles';
import { useChunkMeshes } from '~/usecase/hooks/MapCanvas/useChunkMeshes';
import { useSpriteAtlas } from '~/usecase/hooks/MapCanvas/useSpriteAtlas';
import { useMapRenderer } from '~/usecase/hooks/MapCanvas/useMapRenderer';
import { useMapInteraction } from '~/usecase/hooks/MapCanvas/useMapInteraction';

import RenderStats from './RenderStats';
import { MapCanvasProps } from './types';
import TileContextMenu from './TileContextMenu';
import GotoPositionForm from './GotoPositionForm';

const MapCanvas = (props: MapCanvasProps) => {
  const { map, zoom, onZoomChange, activeBrush, activeTool } = props;

  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const fpsRef = React.useRef<HTMLSpanElement>(null);
  const stallRef = React.useRef<HTMLSpanElement>(null);
  const maxRef = React.useRef<HTMLSpanElement>(null);
  const jsRef = React.useRef<HTMLSpanElement>(null);
  const chunkRef = React.useRef<HTMLSpanElement>(null);

  const gl = React.useRef<GLRenderer | null>(null);
  const [glError, setGlError] = React.useState<string | null>(null);

  const inputs = React.useRef<MapCanvasProps>(props);
  inputs.current = props;

  const camera = useMapCamera(canvasRef, map, zoom, onZoomChange);
  const scene = useMapScene();
  const atlas = useSpriteAtlas(gl);
  const tiles = useChunkTiles();
  const meshes = useChunkMeshes(gl);
  const selection = useSelection(meshes);

  useMapRenderer({
    canvasRef,
    gl,
    camera,
    inputs,
    atlas,
    tiles,
    meshes,
    selection,
    scene,
    stats: { fpsRef, stallRef, maxRef, jsRef, chunkRef }
  });

  const interaction = useMapInteraction({ canvasRef, camera, inputs, atlas, tiles, meshes, selection, scene });

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
    meshes.clear();
    tiles.clear();
  }, [map]);

  const paintable = activeTool === 'brush' && activeBrush != null && activeBrush.serverId != null;
  const canvasCursor = paintable
    ? DRAW_CURSOR
    : activeTool === 'eraser' || interaction.boxing
      ? 'crosshair'
      : camera.panning || interaction.moving
        ? 'grabbing'
        : 'default';

  return (
    <div className="relative h-full w-full">
      <canvas
        ref={canvasRef}
        className="h-full w-full"
        onMouseUp={interaction.handlers.onMouseUp}
        onMouseDown={interaction.handlers.onMouseDown}
        onMouseMove={interaction.handlers.onMouseMove}
        onMouseLeave={interaction.handlers.onMouseLeave}
        style={{ cursor: canvasCursor, display: 'block' }}
        onContextMenu={interaction.handlers.onContextMenu}
      />
      <img
        alt=""
        aria-hidden
        ref={scene.ghostRef}
        className="pointer-events-none absolute left-0 top-0 hidden"
        style={{ opacity: 0.6, imageRendering: 'pixelated', transformOrigin: 'top left' }}
      />
      <div
        ref={scene.highlightRef}
        style={{ transformOrigin: 'top left' }}
        className="pointer-events-none absolute left-0 top-0 hidden rounded-[2px] border border-primary/70 bg-primary/5"
      />
      <div
        ref={scene.selectionBoxRef}
        style={{ transformOrigin: 'top left' }}
        className="pointer-events-none absolute left-0 top-0 hidden border border-dashed border-primary bg-primary/10"
      />
      {glError && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-destructive">
          WebGL unavailable: {glError}
        </div>
      )}
      <RenderStats jsRef={jsRef} fpsRef={fpsRef} maxRef={maxRef} stallRef={stallRef} chunkRef={chunkRef} />

      {interaction.menu && (
        <TileContextMenu
          menu={interaction.menu}
          onGoToDest={interaction.goTo}
          onSelectRaw={interaction.selectRaw}
          onGoToPosition={interaction.openGoto}
        />
      )}

      {interaction.gotoForm && (
        <GotoPositionForm onSubmit={interaction.goTo} initial={interaction.gotoForm} onCancel={interaction.closeGoto} />
      )}
    </div>
  );
};

export default MapCanvas;
