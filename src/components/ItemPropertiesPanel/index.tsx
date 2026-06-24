import React from 'react';
import { X } from 'lucide-react';

import { cn } from '~/usecase/classNames';
import { Thing } from '~/domain/thing';
import { LoadedSprite } from '~/domain/sprite';
import { loadSprites } from '~/adapter/sprites';
import { Hint } from '~/components/commons/ui/tooltip';
import { brushSpriteLayout } from '~/usecase/brushSprite';
import { TILE } from '~/components/MapCanvas/constants';
import { SelectedItem } from '~/components/MapCanvas/types';
import { DragHandleProps } from '~/components/Dock/DockablePanel';
import { useAssetsBundle } from '~/usecase/context/AssetsContext';
import { getTileItems, TileItemEntry, TilePropertiesPayload } from '~/adapter/map';

const THUMB = 32;

interface ItemPropertiesPanelProps {
  mapId: number | null;
  onClose?: () => void;
  item: SelectedItem | null;
  dragHandle?: DragHandleProps;
  items: Map<number, Thing> | null;
  itemNames: Map<number, string> | null;
}

const ItemSprite = ({
  clientId,
  items,
  cache,
  version
}: {
  version: number;
  clientId: number;
  items: Map<number, Thing>;
  cache: Map<number, LoadedSprite>;
}) => {
  const ref = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, THUMB, THUMB);
    const thing = items.get(clientId);
    if (!thing) return;
    const layout = brushSpriteLayout(thing, false);
    if (!layout || layout.cells.length === 0) return;
    const offW = layout.cols * TILE;
    const offH = layout.rows * TILE;
    const off = document.createElement('canvas');
    off.width = offW;
    off.height = offH;
    const octx = off.getContext('2d');
    if (!octx) return;
    let drew = false;
    for (const cell of layout.cells) {
      const sprite = cache.get(cell.spriteId);
      if (!sprite || sprite.empty) continue;
      octx.putImageData(new ImageData(new Uint8ClampedArray(sprite.rgba), TILE, TILE), cell.dx, cell.dy);
      drew = true;
    }
    if (!drew) return;
    const scale = Math.min(THUMB / offW, THUMB / offH);
    const dw = offW * scale;
    const dh = offH * scale;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, (THUMB - dw) / 2, (THUMB - dh) / 2, dw, dh);
  }, [clientId, items, cache, version]);

  return (
    <canvas ref={ref} width={THUMB} height={THUMB} className="h-8 w-8 flex-shrink-0" style={{ imageRendering: 'pixelated' }} />
  );
};

const ItemPropertiesPanel = ({ mapId, item, items, itemNames, dragHandle, onClose }: ItemPropertiesPanelProps) => {
  const { assets } = useAssetsBundle();
  const [data, setData] = React.useState<TilePropertiesPayload | null>(null);
  const [selectedIdx, setSelectedIdx] = React.useState(-1);
  const [spriteVer, setSpriteVer] = React.useState(0);
  const spriteCache = React.useRef<Map<number, LoadedSprite>>(new Map());
  const prevKey = React.useRef('');

  React.useEffect(() => {
    if (!item || mapId === null) {
      setData(null);
      setSelectedIdx(-1);
      prevKey.current = '';
      return;
    }
    const key = `${mapId},${item.z},${item.x},${item.y}`;
    if (key === prevKey.current) return;
    prevKey.current = key;
    let cancelled = false;
    getTileItems(mapId, item.z, item.x, item.y)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        const topIdx = result.items.length - 1;
        const match = result.items.findIndex((e) => e.serverId === item.serverId);
        setSelectedIdx(match >= 0 ? match : topIdx);
      })
      .catch(() => {
        if (!cancelled) {
          setData(null);
          setSelectedIdx(-1);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [mapId, item?.x, item?.y, item?.z, item?.serverId]);

  React.useEffect(() => {
    if (!data || !items || !assets) return;
    const needed: number[] = [];
    for (const entry of data.items) {
      const thing = items.get(entry.clientId);
      if (!thing) continue;
      const layout = brushSpriteLayout(thing, false);
      for (const cell of layout.cells) {
        if (cell.spriteId > 0 && !spriteCache.current.has(cell.spriteId)) needed.push(cell.spriteId);
      }
    }
    if (needed.length === 0) return;
    loadSprites(assets.sprPath, needed, assets.transparency, spriteCache.current).then(() => setSpriteVer((v) => v + 1));
  }, [data, items, assets]);

  const sel: TileItemEntry | null = data && selectedIdx >= 0 ? (data.items[selectedIdx] ?? null) : null;
  const selThing: Thing | null = sel && items ? (items.get(sel.clientId) ?? null) : null;
  const selAttrs = selThing?.attrs ? Object.entries(selThing.attrs) : [];

  const nameOf = (e: TileItemEntry) => itemNames?.get(e.serverId) ?? '';

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
        <h2 className="text-xs font-semibold uppercase tracking-wide text-foreground">Properties</h2>
        {onClose && (
          <Hint side="bottom" label="Close panel">
            <button
              onClick={onClose}
              className="ml-auto flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-item-hover hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </Hint>
        )}
      </div>

      {!item || !data ? (
        <div className="flex flex-1 items-center justify-center p-3 text-xs text-muted-foreground">Click an item to inspect</div>
      ) : (
        <div className="flex-1 overflow-y-auto text-xs">
          <div className="border-b border-border/50 px-2 pb-1 pt-1.5">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Items</div>
            {data.items.map((entry, i) => (
              <button
                key={i}
                onClick={() => setSelectedIdx(i)}
                className={cn(
                  'flex w-full items-center gap-2 rounded px-1 py-0.5 text-left',
                  i === selectedIdx ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
                )}
              >
                {items && <ItemSprite items={items} version={spriteVer} clientId={entry.clientId} cache={spriteCache.current} />}
                <span className="min-w-0 truncate">
                  {entry.serverId} - {nameOf(entry) || 'item'}
                </span>
              </button>
            ))}
          </div>

          {sel && (
            <>
              <div className="border-b border-border/50 px-2 pb-1.5 pt-1.5">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Action</div>
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Action ID:</span>
                    <input
                      readOnly
                      type="number"
                      value={sel.actionId}
                      className="w-20 rounded border border-border/50 bg-secondary/50 px-2 py-0.5 text-right font-mono text-foreground"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Unique ID:</span>
                    <input
                      readOnly
                      type="number"
                      value={sel.uniqueId}
                      className="w-20 rounded border border-border/50 bg-secondary/50 px-2 py-0.5 text-right font-mono text-foreground"
                    />
                  </div>
                </div>
              </div>

              {sel.text && (
                <div className="border-b border-border/50 px-2 pb-1.5 pt-1.5">
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Text Description
                  </div>
                  <textarea
                    readOnly
                    rows={4}
                    value={sel.text}
                    className="w-full resize-none rounded border border-border/50 bg-secondary/50 p-1.5 font-mono text-foreground"
                  />
                </div>
              )}

              {sel.desc && (
                <div className="border-b border-border/50 px-2 pb-1.5 pt-1.5">
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Description</div>
                  <div className="rounded bg-secondary/50 p-1.5 font-mono text-foreground">{sel.desc}</div>
                </div>
              )}

              {(sel.charges > 0 || sel.tier > 0) && (
                <div className="px-2 pb-1.5 pt-1.5">
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Details</div>
                  {sel.charges > 0 && (
                    <div className="flex items-center justify-between py-0.5">
                      <span className="text-muted-foreground">Charges:</span>
                      <span className="font-mono text-foreground">{sel.charges}</span>
                    </div>
                  )}
                  {sel.tier > 0 && (
                    <div className="flex items-center justify-between py-0.5">
                      <span className="text-muted-foreground">Tier:</span>
                      <span className="font-mono text-foreground">{sel.tier}</span>
                    </div>
                  )}
                </div>
              )}

              {selAttrs.length > 0 && (
                <div className="border-t border-border/50 px-2 pb-1.5 pt-1.5">
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Attributes</div>
                  {selAttrs.map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between py-0.5">
                      <span className="text-muted-foreground">{k}:</span>
                      <span className="font-mono text-foreground">{String(v)}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default ItemPropertiesPanel;
