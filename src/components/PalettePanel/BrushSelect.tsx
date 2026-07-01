import React from 'react';
import { Search, ChevronDown } from 'lucide-react';

import { cn } from '~/usecase/classNames';
import { BrushKind } from '~/domain/palette';
import { BrushOption } from '~/adapter/biomes';
import { LoadedSprite } from '~/domain/sprite';
import { loadSprites } from '~/adapter/sprites';
import { mapClientIds } from '~/adapter/assets';
import { useAssetsBundle } from '~/usecase/context/AssetsContext';
import { resolveBrushThing, brushSpriteLayout, BrushSpriteLayout } from '~/usecase/brushSprite';

import BrushThumbnail from './BrushThumbnail';

const SPRITE_CACHE = new Map<number, LoadedSprite>();
const SERVER_TO_CLIENT = new Map<number, number>();
const CELL = 28;
const ROW_H = 32;
const VIEW_H = 240;
const OVERSCAN = 4;

interface BrushSelectProps {
  value: string;
  onChange: (name: string) => void;
  options: BrushOption[];
  placeholder?: string;
  allowNone?: boolean;
}

const BrushSelect = ({ value, onChange, options, placeholder, allowNone }: BrushSelectProps) => {
  const { assets } = useAssetsBundle();
  const items = assets!.items;
  const outfits = assets!.outfits;
  const sprPath = assets!.sprPath;
  const transparency = assets!.transparency;

  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [version, setVersion] = React.useState(0);
  const [scrollTop, setScrollTop] = React.useState(0);
  const [layouts, setLayouts] = React.useState<Map<string, BrushSpriteLayout | null>>(new Map());
  const rootRef = React.useRef<HTMLDivElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  const selected = React.useMemo(() => options.find((o) => o.name === value) ?? null, [options, value]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.name.toLowerCase().includes(q)) : options;
  }, [query, options]);

  const rows = React.useMemo<(BrushOption | null)[]>(() => (allowNone ? [null, ...filtered] : filtered), [allowNone, filtered]);

  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const end = Math.min(rows.length, Math.ceil((scrollTop + VIEW_H) / ROW_H) + OVERSCAN);
  const visible = rows.slice(start, end);

  const toResolve = React.useMemo(() => {
    const map = new Map<string, BrushOption>();
    if (selected) map.set(selected.name, selected);
    if (open) for (const o of visible) if (o) map.set(o.name, o);
    return [...map.values()];
  }, [open, start, end, filtered, selected]);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const need = [...new Set(toResolve.map((o) => o.serverId))].filter((id) => {
        const c = SERVER_TO_CLIENT.get(id);
        return c === undefined || c === 0;
      });
      if (need.length) {
        const cids = await mapClientIds(need);
        need.forEach((sid, i) => {
          const c = cids[i] ?? 0;
          if (c) SERVER_TO_CLIENT.set(sid, c);
        });
      }
      if (cancelled) return;
      const map = new Map<string, BrushSpriteLayout | null>();
      const spriteIds: number[] = [];
      for (const o of toResolve) {
        const brush = { key: o.name, name: o.name, kind: o.kind as BrushKind, lookServerId: o.serverId };
        const thing = resolveBrushThing(brush, items, outfits, SERVER_TO_CLIENT);
        const layout = thing ? brushSpriteLayout(thing, false) : null;
        map.set(o.name, layout);
        if (layout) for (const cell of layout.cells) spriteIds.push(cell.spriteId);
      }
      setLayouts(map);
      await loadSprites(sprPath, spriteIds, transparency, SPRITE_CACHE);
      if (!cancelled) setVersion((v) => v + 1);
    })().catch((err) => console.error('Failed to resolve brush sprites', err));
    return () => {
      cancelled = true;
    };
  }, [toResolve, items, outfits, sprPath, transparency]);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  React.useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
    setScrollTop(0);
  }, [query, open]);

  const pick = (name: string) => {
    onChange(name);
    setOpen(false);
    setQuery('');
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 w-full items-center gap-2 rounded-md border border-border bg-input px-1.5 text-xs text-foreground hover:bg-item-hover"
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded bg-muted/40">
          {selected && (
            <BrushThumbnail size={CELL} version={version} cache={SPRITE_CACHE} layout={layouts.get(selected.name) ?? null} />
          )}
        </span>
        <span className={cn('flex-1 truncate text-left', !value && 'text-muted-foreground')}>
          {value || placeholder || 'Select...'}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute left-0 right-0 z-50 mt-1 overflow-hidden rounded-md border border-border bg-card shadow-island">
          <div className="flex items-center gap-1.5 border-b border-border/50 px-2 py-1.5">
            <Search className="h-3 w-3 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              placeholder="Search..."
              onChange={(e) => setQuery(e.target.value)}
              className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div ref={listRef} className="max-h-60 overflow-y-auto p-1" onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
            {rows.length === 0 ? (
              <div className="px-2 py-3 text-center text-[11px] text-muted-foreground">No matches</div>
            ) : (
              <div style={{ height: rows.length * ROW_H, position: 'relative' }}>
                {visible.map((o, i) => {
                  const top = (start + i) * ROW_H;
                  if (o === null) {
                    return (
                      <button
                        type="button"
                        key="__none__"
                        onClick={() => pick('')}
                        style={{ position: 'absolute', top, left: 0, right: 0, height: ROW_H }}
                        className="flex items-center gap-2 rounded px-1.5 text-left text-xs text-muted-foreground hover:bg-item-hover"
                      >
                        <span className="h-6 w-6 shrink-0" />
                        none
                      </button>
                    );
                  }
                  return (
                    <button
                      key={o.name}
                      type="button"
                      onClick={() => pick(o.name)}
                      style={{ position: 'absolute', top, left: 0, right: 0, height: ROW_H }}
                      className={cn(
                        'flex items-center gap-2 rounded px-1.5 text-left text-xs hover:bg-item-hover',
                        o.name === value ? 'bg-primary/15 text-foreground' : 'text-foreground'
                      )}
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded bg-muted/40">
                        <BrushThumbnail size={CELL} version={version} cache={SPRITE_CACHE} layout={layouts.get(o.name) ?? null} />
                      </span>
                      <span className="flex-1 truncate">{o.name}</span>
                      <span className="text-[9px] uppercase text-muted-foreground">{o.kind}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default BrushSelect;
