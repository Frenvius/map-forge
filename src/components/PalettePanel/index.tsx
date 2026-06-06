import React from 'react';

import { cn } from '~/usecase/classNames';
import { ThingType } from '~/domain/tibia';
import { LoadedSprite } from '~/domain/sprite';
import { loadSprites } from '~/adapter/sprites';
import { mapClientIds } from '~/adapter/assets';
import { brushSpriteLayout, BrushSpriteLayout, resolveBrushThing } from '~/usecase/brushSprite';
import { Select, SelectItem, SelectValue, SelectContent, SelectTrigger } from '~/components/commons/ui/select';
import { ActiveBrush, PaletteData, PaletteBrush, PaletteCategoryId, PALETTE_CATEGORIES } from '~/domain/palette';

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
  data: PaletteData;
  sprPath: string;
  transparency: boolean;
  items: Map<number, ThingType>;
  outfits: Map<number, ThingType>;
  onSelectBrush: (brush: ActiveBrush | null) => void;
}

interface Tile {
  brush: PaletteBrush;
  layout: BrushSpriteLayout | null;
}

const PalettePanel = ({ data, items, outfits, sprPath, transparency, onSelectBrush }: PalettePanelProps) => {
  const spriteCache = React.useRef<Map<number, LoadedSprite>>(new Map());
  const serverToClient = React.useRef<Map<number, number>>(new Map());

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
    setTilesetName(data[category][0]?.name ?? '');
  }, [category, data]);

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
      onSelectBrush(null);
      return;
    }
    setSelectedKey(brush.key);
    if (brush.kind === 'creature') {
      onSelectBrush({ key: brush.key, name: brush.name, kind: brush.kind, isGround: false });
      return;
    }
    const serverId = brush.lookServerId;
    const clientId = serverId != null ? serverToClient.current.get(serverId) : undefined;
    const isGround = clientId ? (items.get(clientId)?.isGround ?? false) : false;
    const preview = tile.layout ? makeBrushPreview(tile.layout, spriteCache.current) : null;
    onSelectBrush({
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

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-lg bg-card shadow-island">
      <div className="flex h-7 flex-shrink-0 items-center border-b border-border/50 bg-secondary/80 px-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-foreground">Palette</h2>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">{tiles.length}</span>
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
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {tiles.length === 0 ? (
          <div className="px-1 py-6 text-center text-xs text-muted-foreground">No brushes in this tileset.</div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(2.25rem,1fr))] gap-1">
            {tiles.map((tile) => (
              <button
                key={tile.brush.key}
                title={tile.brush.name}
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
    </div>
  );
};

export default PalettePanel;
