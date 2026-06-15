import React from 'react';
import { FolderOpen } from 'lucide-react';

import { Town } from '~/domain/map';
import { cn } from '~/usecase/classNames';
import { LoadedSprite } from '~/domain/sprite';
import { loadSprites } from '~/adapter/sprites';
import { mapClientIds } from '~/adapter/assets';
import { House, MapHouses } from '~/domain/house';
import { useTool } from '~/usecase/context/ToolContext';
import { Waypoint, MapWaypoints } from '~/domain/waypoint';
import { DragHandleProps } from '~/components/Dock/DockablePanel';
import { useAssetsBundle } from '~/usecase/context/AssetsContext';
import { brushSpriteLayout, BrushSpriteLayout, resolveBrushThing } from '~/usecase/brushSprite';
import { Select, SelectItem, SelectValue, SelectContent, SelectTrigger } from '~/components/commons/ui/select';
import { PaletteData, PaletteBrush, PaletteTileset, PaletteCategoryId, PALETTE_CATEGORIES } from '~/domain/palette';

import HousesList from './HousesList';
import WaypointsList from './WaypointsList';
import BrushThumbnail from './BrushThumbnail';

const CELL_SIZE = 32;

function makeBrushPreview(layout: BrushSpriteLayout, cache: Map<number, LoadedSprite>): string | null {
  const canvas = document.createElement('canvas');
  canvas.width = layout.cols * 32;
  canvas.height = layout.rows * 32;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  let drew = false;
  for (const cell of layout.cells) {
    const sprite = cache.get(cell.spriteId);
    if (!sprite || sprite.empty) continue;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(sprite.rgba), 32, 32), cell.dx, cell.dy);
    drew = true;
  }
  return drew ? canvas.toDataURL() : null;
}

interface PalettePanelProps {
  dragHandle?: DragHandleProps;
  waypoints: MapWaypoints | null;
  houses: MapHouses | null;
  towns: Town[];
  onAddWaypoint: () => void;
  onGotoWaypoint: (wp: Waypoint) => void;
  onEditWaypoints: (next: MapWaypoints) => void;
  onCopyWaypointPosition: (wp: Waypoint) => void;
  onEditHouses: (next: MapHouses) => void;
  onGotoHouse: (house: House) => void;
  creatureTilesets?: PaletteTileset[];
  creatureNeedsPicker?: boolean;
  onPickCreatureDir?: () => void;
}

interface PendingReveal {
  category: PaletteCategoryId;
  tilesetName: string;
  key: string;
}

interface Tile {
  brush: PaletteBrush;
  layout: BrushSpriteLayout | null;
}

const SHARED_SPRITE_CACHE = new Map<number, LoadedSprite>();
const SHARED_SERVER_TO_CLIENT = new Map<number, number>();

const PalettePanel = ({
  dragHandle,
  waypoints,
  houses,
  towns,
  onAddWaypoint,
  onGotoWaypoint,
  onEditWaypoints,
  onCopyWaypointPosition,
  onEditHouses,
  onGotoHouse,
  creatureTilesets,
  creatureNeedsPicker,
  onPickCreatureDir
}: PalettePanelProps) => {
  const { assets, palette } = useAssetsBundle();
  const { reveal, selectBrush } = useTool();

  const data = React.useMemo<PaletteData>(() => {
    const base = palette as PaletteData;
    if (!creatureTilesets || creatureTilesets.length === 0) return base;
    return { ...base, creature: creatureTilesets };
  }, [palette, creatureTilesets]);
  const items = assets!.items;
  const outfits = assets!.outfits;
  const sprPath = assets!.sprPath;
  const transparency = assets!.transparency;

  const spriteCache = React.useRef(SHARED_SPRITE_CACHE);
  const serverToClient = React.useRef(SHARED_SERVER_TO_CLIENT);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const pending = React.useRef<PendingReveal | null>(null);

  const [category, setCategory] = React.useState<PaletteCategoryId>('terrain');
  const [tilesetName, setTilesetName] = React.useState<string>('');
  const [selectedKey, setSelectedKey] = React.useState<string | null>(null);
  const [tiles, setTiles] = React.useState<Tile[]>([]);
  const [renderVersion, setRenderVersion] = React.useState(0);

  const tilesets = data[category];
  const current = React.useMemo(
    () => tilesets.find((t) => t.name === tilesetName) ?? tilesets[0] ?? null,
    [tilesets, tilesetName]
  );

  React.useEffect(() => {
    if (pending.current?.category === category) return;
    setTilesetName(data[category][0]?.name ?? '');
  }, [category, data]);

  React.useEffect(() => {
    if (!reveal) return;
    if (reveal.category === 'houses') {
      setCategory('houses');
      return;
    }
    const order = [reveal.category, ...PALETTE_CATEGORIES.map((c) => c.id).filter((id) => id !== reveal.category)];
    const match = (b: PaletteBrush) => (reveal.name != null ? b.name === reveal.name : b.lookServerId === reveal.serverId);
    for (const cat of order) {
      const ts = data[cat]?.find((t) => t.brushes.some(match));
      const brush = ts?.brushes.find(match);
      if (ts && brush) {
        pending.current = { category: cat, tilesetName: ts.name, key: brush.key };
        setCategory(cat);
        setTilesetName(ts.name);
        return;
      }
    }
  }, [reveal?.nonce]);

  React.useEffect(() => {
    const pend = pending.current;
    if (!pend || current?.name !== pend.tilesetName || !tiles.some((t) => t.brush.key === pend.key)) return;
    setSelectedKey(pend.key);
    const key = pend.key;
    pending.current = null;
    requestAnimationFrame(() => {
      scrollRef.current?.querySelector(`[data-brush-key="${CSS.escape(key)}"]`)?.scrollIntoView({ block: 'nearest' });
    });
  }, [tiles, current]);

  React.useEffect(() => {
    let cancelled = false;
    const brushes = current?.brushes ?? [];
    setTiles(brushes.map((brush) => ({ brush, layout: null })));
    if (brushes.length === 0) return;

    (async () => {
      const needed = [
        ...new Set(
          brushes
            .filter((b) => b.kind !== 'creature' && b.lookServerId != null)
            .map((b) => b.lookServerId as number)
            .filter((id) => !serverToClient.current.has(id))
        )
      ];
      if (needed.length > 0) {
        const clientIds = await mapClientIds(needed);
        needed.forEach((sid, i) => serverToClient.current.set(sid, clientIds[i] ?? 0));
      }
      if (cancelled) return;

      const resolved: Tile[] = brushes.map((brush) => {
        const thing = resolveBrushThing(brush, items, outfits, serverToClient.current);
        return { brush, layout: thing ? brushSpriteLayout(thing, brush.kind === 'creature') : null };
      });
      setTiles(resolved);

      const spriteIds: number[] = [];
      for (const tile of resolved) {
        if (tile.layout) for (const cell of tile.layout.cells) spriteIds.push(cell.spriteId);
      }
      await loadSprites(sprPath, spriteIds, transparency, spriteCache.current);
      if (!cancelled) setRenderVersion((v) => v + 1);
    })();

    return () => {
      cancelled = true;
    };
  }, [current, items, outfits, sprPath, transparency]);

  function handleSelect(tile: Tile) {
    const brush = tile.brush;
    if (brush.key === selectedKey) {
      setSelectedKey(null);
      selectBrush(null);
      return;
    }
    setSelectedKey(brush.key);
    if (brush.kind === 'creature') {
      selectBrush({
        key: brush.key,
        name: brush.name,
        kind: brush.kind,
        isGround: false,
        lookType: brush.lookType,
        isNpc: brush.isNpc,
        head: brush.creature?.head,
        body: brush.creature?.body,
        legs: brush.creature?.legs,
        feet: brush.creature?.feet
      });
      return;
    }
    const serverId = brush.lookServerId;
    const clientId = serverId != null ? serverToClient.current.get(serverId) : undefined;
    const isGround = clientId ? (items.get(clientId)?.isGround ?? false) : false;
    const preview = tile.layout ? makeBrushPreview(tile.layout, spriteCache.current) : null;
    selectBrush({
      key: brush.key,
      name: brush.name,
      kind: brush.kind,
      serverId,
      isGround,
      cols: tile.layout?.cols,
      rows: tile.layout?.rows,
      preview: preview ?? undefined
    });
  }

  const isWaypoints = category === 'waypoints';
  const isHouses = category === 'houses';
  const isCreature = category === 'creature';
  const isList = isWaypoints || isHouses;

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
        <h2 className="text-xs font-semibold uppercase tracking-wide text-foreground">Palette</h2>
        {isCreature && onPickCreatureDir && (
          <button
            onClick={onPickCreatureDir}
            title="Select creature data folder"
            className="ml-2 flex h-5 items-center gap-1 rounded border border-border/50 bg-card/60 px-1.5 text-[10px] text-muted-foreground transition-colors hover:bg-item-hover hover:text-foreground"
          >
            <FolderOpen className="h-3 w-3" />
            Data
          </button>
        )}
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
          {isWaypoints ? (waypoints?.list.length ?? 0) : isHouses ? (houses?.list.length ?? 0) : tiles.length}
        </span>
      </div>

      <div className="flex flex-shrink-0 flex-col gap-2 border-b border-border/50 p-2">
        <Select value={category} onValueChange={(v) => setCategory(v as PaletteCategoryId)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PALETTE_CATEGORIES.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {!isList && (
          <div className="flex flex-col gap-1">
            <span className="px-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">Tileset</span>
            <Select value={current?.name ?? ''} onValueChange={setTilesetName} disabled={tilesets.length === 0}>
              <SelectTrigger>
                <SelectValue placeholder="No tilesets" />
              </SelectTrigger>
              <SelectContent>
                {tilesets.map((t) => (
                  <SelectItem key={t.name} value={t.name}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {isWaypoints ? (
        <WaypointsList
          waypoints={waypoints}
          onAdd={onAddWaypoint}
          onGoto={onGotoWaypoint}
          onEdit={onEditWaypoints}
          onCopyPosition={onCopyWaypointPosition}
        />
      ) : isHouses ? (
        <HousesList towns={towns} houses={houses} onGoto={onGotoHouse} onEdit={onEditHouses} />
      ) : (
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-2">
          {tiles.length === 0 ? (
            isCreature && creatureNeedsPicker ? (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                No monster/npc folder for this map. Use <span className="text-foreground">Data</span> in the header to select it.
              </div>
            ) : (
              <div className="px-1 py-6 text-center text-xs text-muted-foreground">No brushes in this tileset.</div>
            )
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(2.25rem,1fr))] gap-1">
              {tiles.map((tile) => (
                <button
                  key={tile.brush.key}
                  title={tile.brush.name}
                  data-brush-key={tile.brush.key}
                  onClick={() => handleSelect(tile)}
                  className={cn(
                    'flex aspect-square items-center justify-center rounded border bg-muted/40 p-0.5 transition-colors hover:bg-item-hover',
                    selectedKey === tile.brush.key ? 'border-primary bg-primary/15' : 'border-border/50'
                  )}
                >
                  <BrushThumbnail size={CELL_SIZE} layout={tile.layout} version={renderVersion} cache={spriteCache.current} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PalettePanel;
