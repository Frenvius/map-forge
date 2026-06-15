import React from 'react';
import { IconDoorExit } from '@tabler/icons-react';

import { GLRenderer } from '~/usecase/glRenderer';
import { useTool } from '~/usecase/context/ToolContext';
import { isZoneTool, isHouseTool } from '~/domain/tools';
import { DRAW_CURSOR, WAYPOINT_CURSOR } from '~/usecase/cursors';
import { useAssetsBundle } from '~/usecase/context/AssetsContext';
import { useMapScene } from '~/usecase/hooks/MapCanvas/useMapScene';
import { useSelection } from '~/usecase/hooks/MapCanvas/useSelection';
import { useMapCamera } from '~/usecase/hooks/MapCanvas/useMapCamera';
import { useChunkTiles } from '~/usecase/hooks/MapCanvas/useChunkTiles';
import { useChunkMeshes } from '~/usecase/hooks/MapCanvas/useChunkMeshes';
import { useSpriteAtlas } from '~/usecase/hooks/MapCanvas/useSpriteAtlas';
import { useMapRenderer } from '~/usecase/hooks/MapCanvas/useMapRenderer';
import { useEditorSettings } from '~/usecase/context/EditorSettingsContext';
import { useMapInteraction } from '~/usecase/hooks/MapCanvas/useMapInteraction';

import RenderStats from './RenderStats';
import TileContextMenu from './TileContextMenu';
import GotoPositionForm from './GotoPositionForm';
import SpawnPropertiesForm from './SpawnPropertiesForm';
import { MapCanvasProps, MapCanvasInputs } from './types';
import CreaturePropertiesForm from './CreaturePropertiesForm';
import WaypointPropertiesForm from './WaypointPropertiesForm';

const SPAWN_HANDLES = [
  { key: 'nw', left: '0%', top: '0%', cursor: 'nwse-resize' },
  { key: 'n', left: '50%', top: '0%', cursor: 'ns-resize' },
  { key: 'ne', left: '100%', top: '0%', cursor: 'nesw-resize' },
  { key: 'e', left: '100%', top: '50%', cursor: 'ew-resize' },
  { key: 'se', left: '100%', top: '100%', cursor: 'nwse-resize' },
  { key: 's', left: '50%', top: '100%', cursor: 'ns-resize' },
  { key: 'sw', left: '0%', top: '100%', cursor: 'nesw-resize' },
  { key: 'w', left: '0%', top: '50%', cursor: 'ew-resize' }
];

const MapCanvas = (props: MapCanvasProps) => {
  const settings = useEditorSettings();
  const tool = useTool();
  const { assets } = useAssetsBundle();

  const { map, zoom, onZoomChange } = props;
  const { activeBrush, activeTool } = tool;

  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const fpsRef = React.useRef<HTMLSpanElement>(null);
  const stallRef = React.useRef<HTMLSpanElement>(null);
  const maxRef = React.useRef<HTMLSpanElement>(null);
  const jsRef = React.useRef<HTMLSpanElement>(null);
  const chunkRef = React.useRef<HTMLSpanElement>(null);

  const gl = React.useRef<GLRenderer | null>(null);
  const [glError, setGlError] = React.useState<string | null>(null);

  const inputs = React.useRef<MapCanvasInputs>(null as unknown as MapCanvasInputs);
  inputs.current = {
    ...props,
    items: assets!.items,
    outfits: assets!.outfits,
    itemNames: props.itemNames ?? assets!.itemNames,
    sprPath: assets!.sprPath,
    transparency: assets!.transparency,
    spawnMarkerClientId: assets!.spawnMarkerClientId,
    waypointMarkerClientId: assets!.waypointMarkerClientId,
    showSpawns: settings.showSpawns,
    showCreatures: settings.showCreatures,
    showWaypoints: settings.showWaypoints,
    showHouses: settings.showHouses,
    automagic: settings.automagic,
    zoneVisibility: settings.zoneVisibility,
    spawnTime: settings.spawnTime,
    spawnRadius: settings.spawnSize,
    autoCreateSpawn: settings.autoCreateSpawn,
    copyPositionFormat: settings.copyPositionFormat,
    activeTool: tool.activeTool,
    activeBrush: tool.activeBrush,
    activeHouseId: tool.activeHouseId,
    onToolChange: tool.setActiveTool,
    onSelectBrush: tool.selectBrush,
    onRevealBrush: tool.revealInPalette,
    onSelectHouse: (id: number) => {
      tool.setActiveHouse(id);
      tool.setActiveTool('house');
      tool.revealInPalette('houses', id);
    }
  };

  const camera = useMapCamera(
    canvasRef,
    map,
    zoom,
    onZoomChange,
    props.initialCenter,
    props.onViewChange,
    settings.infiniteMouse
  );
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

  if (props.waypointEditRef) props.waypointEditRef.current = interaction.editWaypoints;

  React.useEffect(() => {
    const ref = props.centerRef;
    if (!ref) return;
    ref.current = (x, y) => camera.centerOn({ x, y, z: inputs.current.floorZ });
    return () => {
      ref.current = null;
    };
  }, []);

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

  React.useEffect(() => {
    meshes.clear();
  }, [
    props.spawns,
    props.waypoints,
    props.houses,
    tool.activeHouseId,
    settings.showSpawns,
    settings.showCreatures,
    settings.showWaypoints,
    settings.showHouses,
    settings.zoneVisibility
  ]);

  React.useEffect(() => {
    const el = document.documentElement;
    el.classList.toggle('panning-grab', camera.panning);
    return () => el.classList.remove('panning-grab');
  }, [camera.panning]);

  const paintable =
    (activeTool === 'brush' && activeBrush != null && activeBrush.serverId != null) ||
    (activeTool === 'house' && tool.activeHouseId != null);
  const canvasCursor = props.placingWaypoint
    ? WAYPOINT_CURSOR
    : paintable
      ? DRAW_CURSOR
      : activeTool === 'eraser' ||
          activeTool === 'spawn' ||
          isZoneTool(activeTool) ||
          isHouseTool(activeTool) ||
          interaction.boxing
        ? 'crosshair'
        : camera.panning || interaction.moving
          ? 'grabbing'
          : 'default';

  return (
    <div className="relative h-full w-full overflow-hidden">
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
        aria-hidden
        ref={scene.boxGhostRef}
        className="pointer-events-none absolute left-0 top-0 hidden"
        style={{ transformOrigin: 'top left', imageRendering: 'pixelated' }}
      />
      <div
        ref={scene.selectionBoxRef}
        style={{ transformOrigin: 'top left' }}
        className="pointer-events-none absolute left-0 top-0 hidden border border-dashed border-primary bg-primary/10"
      />
      <div
        ref={scene.spawnBoxRef}
        style={{ transformOrigin: 'top left' }}
        className="pointer-events-none absolute left-0 top-0 hidden border-2 border-dashed border-amber-400/80 bg-amber-400/5"
      >
        {SPAWN_HANDLES.map((h) => (
          <div
            key={h.key}
            onMouseDown={(e) => interaction.beginSpawnResize(e, h.key)}
            style={{ left: h.left, top: h.top, cursor: h.cursor, transform: 'translate(-50%, -50%)' }}
            className="pointer-events-auto absolute h-3 w-3 rounded-sm border border-amber-200 bg-amber-400 shadow"
          />
        ))}
      </div>
      <div ref={scene.houseExitsRef} style={{ display: 'none' }} className="pointer-events-none absolute left-0 top-0">
        {(props.houses?.list ?? [])
          .filter((h) => h.entryX !== 0 || h.entryY !== 0)
          .map((h) => (
            <div
              key={h.id}
              data-x={h.entryX}
              data-y={h.entryY}
              data-z={h.entryZ}
              title={`Exit: ${h.name}`}
              style={{ transformOrigin: 'top left' }}
              className="absolute left-0 top-0 hidden items-center justify-center text-sky-200 drop-shadow-[0_1px_1px_rgba(0,0,0,0.9)]"
            >
              <IconDoorExit className="h-3/4 w-3/4" />
            </div>
          ))}
      </div>

      {glError && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-destructive">
          WebGL unavailable: {glError}
        </div>
      )}
      <RenderStats jsRef={jsRef} fpsRef={fpsRef} maxRef={maxRef} stallRef={stallRef} chunkRef={chunkRef} />

      {interaction.menu && (
        <TileContextMenu
          menu={interaction.menu}
          onCut={interaction.cut}
          onCopy={interaction.copy}
          onPaste={interaction.paste}
          onGoToDest={interaction.goTo}
          onCopyText={interaction.copyText}
          onSelectRaw={interaction.selectRaw}
          onDelete={interaction.deleteSelected}
          onSelectHouse={interaction.selectHouse}
          onCopyPosition={interaction.copyPosition}
          onSelectGround={interaction.selectGround}
          onAddWaypoint={interaction.addWaypointHere}
          onSelectCreature={interaction.selectCreature}
          onSpawnProperties={interaction.spawnProperties}
          onCreatureProperties={interaction.creatureProperties}
          onWaypointProperties={interaction.waypointProperties}
        />
      )}

      {interaction.gotoForm && (
        <GotoPositionForm onSubmit={interaction.goTo} initial={interaction.gotoForm} onCancel={interaction.closeGoto} />
      )}

      {interaction.spawnForm && (
        <SpawnPropertiesForm
          initial={interaction.spawnForm}
          onCancel={interaction.closeSpawnForm}
          onSubmit={interaction.submitSpawnForm}
        />
      )}

      {interaction.creatureForm && (
        <CreaturePropertiesForm
          initial={interaction.creatureForm}
          onCancel={interaction.closeCreatureForm}
          onSubmit={interaction.submitCreatureForm}
        />
      )}

      {interaction.waypointForm && (
        <WaypointPropertiesForm
          initial={interaction.waypointForm}
          onCancel={interaction.closeWaypointForm}
          onSubmit={interaction.submitWaypointForm}
        />
      )}
    </div>
  );
};

export default MapCanvas;
