import React from 'react';
import { createPortal } from 'react-dom';
import { useDraggable } from '@dnd-kit/core';
import { Search, ListFilter } from 'lucide-react';

import { cn } from '~/usecase/classNames';
import { loadPalette } from '~/adapter/palette';
import { loadAllServerIds } from '~/adapter/materials';
import { BrushSpriteLayout } from '~/usecase/brushSprite';
import { Checkbox } from '~/components/commons/ui/checkbox';
import { useAssetsBundle } from '~/usecase/context/AssetsContext';
import BrushThumbnail from '~/components/PalettePanel/BrushThumbnail';
import { FlagIndex, THING_FLAGS, FLAG_LABELS } from '~/adapter/thingFlags';
import { Select, SelectItem, SelectValue, SelectContent, SelectTrigger } from '~/components/commons/ui/select';

import { useItemSprites, ITEM_SPRITE_CACHE } from './sprites';

export const ITEM_DRAG_TYPE = 'application/x-nosbor-item';
const ROW_H = 48;
const OVERSCAN = 6;

const FlagFilter = ({
  flagIndex,
  value,
  onChange
}: {
  flagIndex: FlagIndex;
  value: string[];
  onChange: (flags: string[]) => void;
}) => {
  const [open, setOpen] = React.useState(false);
  const btnRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const [pos, setPos] = React.useState<{ top: number; right: number }>({ top: 0, right: 0 });

  const openMenu = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    setOpen((o) => !o);
  };

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!btnRef.current?.contains(t) && !panelRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const indexReady = [...flagIndex.values()].some((a) => a.length > 0);
  const visible = THING_FLAGS.filter((f) => !indexReady || (flagIndex.get(f) ?? []).length > 0 || value.includes(f));
  const toggle = (f: string) => onChange(value.includes(f) ? value.filter((x) => x !== f) : [...value, f]);

  return (
    <>
      <button
        ref={btnRef}
        onClick={openMenu}
        title="Filter by flags"
        className={cn(
          'relative flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md border border-border/60 bg-input text-muted-foreground hover:text-foreground',
          value.length && 'border-primary/60 text-primary'
        )}
      >
        <ListFilter className="h-4 w-4" />
        {value.length > 0 && (
          <span className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[8px] font-semibold text-primary-foreground">
            {value.length}
          </span>
        )}
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            style={{ position: 'fixed', top: pos.top, right: pos.right }}
            className="z-[100] flex max-h-80 w-56 flex-col overflow-hidden rounded-md border border-border bg-popover shadow-island"
          >
            <button
              disabled={!value.length}
              onClick={() => onChange([])}
              className="flex-shrink-0 border-b border-border/60 px-3 py-1.5 text-left text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
            >
              Clear filters
            </button>
            <div className="min-h-0 flex-1 overflow-y-auto p-1">
              {visible.map((f) => (
                <button
                  key={f}
                  onClick={() => toggle(f)}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent"
                >
                  <Checkbox checked={value.includes(f)} className="pointer-events-none" />
                  <span className="flex-1 text-foreground">{FLAG_LABELS[f]}</span>
                  <span className="rounded bg-secondary px-1 py-0.5 font-mono text-[9px] leading-none text-muted-foreground">
                    {(flagIndex.get(f) ?? []).length}
                  </span>
                </button>
              ))}
            </div>
          </div>,
          document.body
        )}
    </>
  );
};

interface Category {
  name: string;
  ids: number[];
}

interface ItemRowProps {
  id: number;
  name: string | undefined;
  layout: BrushSpriteLayout | null;
  version: number;
}

const ItemRow = ({ id, name, layout, version }: ItemRowProps) => {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `item-${id}`, data: { serverId: id } });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{ height: ROW_H }}
      title={`${id}${name ? ` · ${name}` : ''}`}
      className={cn(
        'flex w-full cursor-grab touch-none items-center gap-2 rounded px-2 hover:bg-item-hover active:cursor-grabbing',
        isDragging && 'opacity-40'
      )}
    >
      <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded border border-border/50 bg-background">
        <BrushThumbnail size={40} layout={layout} version={version} cache={ITEM_SPRITE_CACHE} />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-xs text-foreground">{name || `Item ${id}`}</span>
        <span className="font-mono text-[10px] text-muted-foreground">{id}</span>
      </span>
    </div>
  );
};

const ItemsPalette = ({ flagIndex }: { flagIndex: FlagIndex }) => {
  const { assets, dataDir } = useAssetsBundle();
  const itemNames = assets?.itemNames ?? null;
  const [cats, setCats] = React.useState<Category[]>([]);
  const [category, setCategory] = React.useState('All');
  const [query, setQuery] = React.useState('');
  const [flagFilter, setFlagFilter] = React.useState<string[]>([]);

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const ticking = React.useRef(false);
  const [scrollTop, setScrollTop] = React.useState(0);
  const [viewportH, setViewportH] = React.useState(600);

  React.useEffect(() => {
    if (!dataDir) return;
    let cancelled = false;
    Promise.all([loadAllServerIds(), loadPalette(dataDir, assets?.items).catch(() => null)])
      .then(([all, pal]) => {
        if (cancelled) return;
        const rawCats: Category[] = (pal?.raw ?? []).map((ts) => ({
          name: ts.name,
          ids: ts.brushes.map((b) => b.lookServerId).filter((v): v is number => v != null)
        }));
        setCats([{ name: 'All', ids: all.slice().sort((a, b) => a - b) }, ...rawCats]);
      })
      .catch((err) => console.error('Failed to load item categories', err));
    return () => {
      cancelled = true;
    };
  }, [dataDir]);

  const current = cats.find((c) => c.name === category) ?? cats[0] ?? null;

  const filtered = React.useMemo(() => {
    const ids = current?.ids ?? [];
    const q = query.trim().toLowerCase();
    const sets = flagFilter.map((f) => new Set(flagIndex.get(f) ?? []));
    return ids.filter((id) => {
      if (q && !(String(id).includes(q) || (itemNames?.get(id)?.toLowerCase().includes(q) ?? false))) return false;
      return sets.every((s) => s.has(id));
    });
  }, [current, query, itemNames, flagFilter, flagIndex]);

  React.useLayoutEffect(() => {
    setViewportH(scrollRef.current?.clientHeight ?? 600);
  }, [filtered]);

  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const end = Math.min(filtered.length, start + Math.ceil(viewportH / ROW_H) + OVERSCAN * 2);
  const visible = filtered.slice(start, end);

  const { layouts, version } = useItemSprites(visible);

  const onScroll = () => {
    if (ticking.current) return;
    ticking.current = true;
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) {
        setScrollTop(el.scrollTop);
        setViewportH(el.clientHeight);
      }
      ticking.current = false;
    });
  };

  return (
    <aside className="flex h-full flex-col overflow-hidden rounded-lg bg-card shadow-island">
      <div className="flex h-8 flex-shrink-0 items-center border-b border-border/50 bg-secondary/60 px-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-foreground">Items</h2>
      </div>
      <div className="flex flex-col gap-2 border-b border-border/60 p-2">
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {cats.map((c) => (
              <SelectItem key={c.name} value={c.name}>
                {c.name} ({c.ids.length})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1.5">
          <div className="flex h-8 flex-1 items-center gap-1.5 rounded-md border border-border/60 bg-input px-2">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={query}
              placeholder="Search id or name..."
              onChange={(e) => setQuery(e.target.value)}
              className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            />
          </div>
          <FlagFilter value={flagFilter} flagIndex={flagIndex} onChange={setFlagFilter} />
        </div>
      </div>
      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto p-1.5">
        <div style={{ height: filtered.length * ROW_H, position: 'relative' }}>
          <div style={{ position: 'absolute', top: start * ROW_H, left: 0, right: 0 }}>
            {visible.map((id) => (
              <ItemRow id={id} key={id} version={version} name={itemNames?.get(id)} layout={layouts.get(id) ?? null} />
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
};

export default ItemsPalette;
