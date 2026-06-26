import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { X, Plus, ChevronDown } from 'lucide-react';

import { cn } from '~/usecase/classNames';
import { Checkbox } from '~/components/commons/ui/checkbox';
import BrushThumbnail from '~/components/PalettePanel/BrushThumbnail';
import { FlagIndex, THING_FLAGS, FLAG_LABELS } from '~/adapter/thingFlags';
import { ItemEntry, TilesetDef, TilesetCategory, TILESET_ITEM_KINDS } from '~/adapter/materials';
import { Select, SelectItem, SelectValue, SelectContent, SelectTrigger } from '~/components/commons/ui/select';

import { useItemSprites, ITEM_SPRITE_CACHE, type SpriteLayouts } from './sprites';

interface TilesetEditorProps {
  def: TilesetDef;
  brushLookid: Map<string, number>;
  brushNames: string[];
  flagIndex: FlagIndex;
  onChange: (next: TilesetDef) => void;
}

const ADDABLE_KINDS = ['raw', 'items', 'terrain', 'doodad'];

const isItemKind = (kind: string) => TILESET_ITEM_KINDS.includes(kind);

const FlagsRow = ({
  flags,
  flagIndex,
  onChange
}: {
  flags: string[];
  flagIndex: FlagIndex;
  onChange: (flags: string[]) => void;
}) => {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const total = new Set(flags.flatMap((f) => flagIndex.get(f) ?? [])).size;

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const toggle = (f: string) => onChange(flags.includes(f) ? flags.filter((x) => x !== f) : [...flags, f]);

  const indexReady = [...flagIndex.values()].some((a) => a.length > 0);
  const visibleFlags = THING_FLAGS.filter((f) => !indexReady || (flagIndex.get(f) ?? []).length > 0 || flags.includes(f));

  return (
    <div ref={ref} className="relative flex items-center gap-2">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex h-7 w-48 items-center justify-between rounded-md border border-border/60 bg-input px-2 text-xs text-foreground outline-none hover:border-border focus:ring-1 focus:ring-ring"
      >
        <span className={cn(flags.length ? 'text-foreground' : 'text-muted-foreground')}>
          {flags.length ? `${flags.length} flag rule${flags.length > 1 ? 's' : ''}` : 'Flag rules'}
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
      {flags.length > 0 && <span className="text-[10px] text-muted-foreground">≈ {total} items</span>}
      {open && (
        <div className="absolute left-0 top-8 z-50 max-h-72 w-56 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-island">
          {visibleFlags.map((f) => {
            const checked = flags.includes(f);
            return (
              <button
                key={f}
                onClick={() => toggle(f)}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent"
              >
                <Checkbox checked={checked} className="pointer-events-none" />
                <span className="flex-1 text-foreground">{FLAG_LABELS[f]}</span>
                <span className="rounded bg-secondary px-1 py-0.5 font-mono text-[9px] leading-none text-muted-foreground">
                  {(flagIndex.get(f) ?? []).length}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

const ItemCategory = ({
  index,
  category,
  layouts,
  version,
  flagIndex,
  onChange,
  onFlags
}: {
  index: number;
  category: TilesetCategory;
  layouts: SpriteLayouts;
  version: number;
  flagIndex: FlagIndex;
  onChange: (items: ItemEntry[]) => void;
  onFlags: (flags: string[]) => void;
}) => {
  const { setNodeRef, isOver } = useDroppable({ id: `tileset-cat-${index}` });
  const setEntry = (i: number, patch: Partial<ItemEntry>) =>
    onChange(category.items.map((e, k) => (k === i ? { ...e, ...patch } : e)));
  return (
    <div className="flex flex-col gap-2">
      <FlagsRow onChange={onFlags} flagIndex={flagIndex} flags={category.flags} />
      <div
        ref={setNodeRef}
        className={cn(
          'grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2 rounded-lg border border-dashed p-2 transition-colors',
          isOver ? 'border-primary bg-primary/5' : 'border-border/60'
        )}
      >
        {category.items.map((e, i) => (
          <div
            key={i}
            className="group relative flex items-center gap-2 overflow-hidden rounded-lg border border-border/60 bg-background p-1.5"
          >
            <button
              title="Remove"
              onClick={() => onChange(category.items.filter((_, k) => k !== i))}
              className="absolute right-1 top-1 z-10 hidden h-4 w-4 items-center justify-center rounded bg-secondary/90 text-muted-foreground hover:bg-[#c42b1c] hover:text-white group-hover:flex"
            >
              <X className="h-3 w-3" />
            </button>
            <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-md border border-border/50 bg-secondary/40">
              <BrushThumbnail size={44} version={version} cache={ITEM_SPRITE_CACHE} layout={layouts.get(e.fromId) ?? null} />
            </span>
            <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
              <label className="flex items-center gap-1.5">
                <span className="w-5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">id</span>
                <input
                  type="number"
                  value={e.fromId}
                  onChange={(ev) => setEntry(i, { fromId: Number(ev.target.value) || 0 })}
                  className="h-6 w-full min-w-0 rounded border border-border/70 bg-input px-1.5 text-center font-mono text-[11px] font-medium text-foreground outline-none focus:ring-1 focus:ring-ring"
                />
              </label>
              <label className="flex items-center gap-1.5">
                <span className="w-5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">to</span>
                <input
                  type="number"
                  placeholder="-"
                  value={e.toId ?? ''}
                  onChange={(ev) => setEntry(i, { toId: ev.target.value === '' ? null : Number(ev.target.value) })}
                  className={cn(
                    'h-6 w-full min-w-0 rounded border border-border/70 bg-input px-1.5 text-center font-mono text-[11px] outline-none placeholder:text-muted-foreground/40 focus:ring-1 focus:ring-ring',
                    e.toId == null ? 'text-muted-foreground' : 'font-medium text-foreground'
                  )}
                />
              </label>
            </div>
          </div>
        ))}
        {category.items.length === 0 && (
          <span className="col-span-full py-3 text-center text-xs text-muted-foreground">Drag items here</span>
        )}
      </div>
    </div>
  );
};

const BrushCategory = ({
  category,
  brushLookid,
  brushNames,
  layouts,
  version,
  onChange
}: {
  category: TilesetCategory;
  brushLookid: Map<string, number>;
  brushNames: string[];
  layouts: SpriteLayouts;
  version: number;
  onChange: (brushes: string[]) => void;
}) => (
  <div className="flex flex-wrap items-center gap-1.5">
    {category.brushes.map((b) => {
      const id = brushLookid.get(b) ?? 0;
      return (
        <span
          key={b}
          className="flex items-center gap-1.5 rounded-full border border-border/60 bg-secondary/60 py-0.5 pl-1 pr-1.5 text-xs"
        >
          <span className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full border border-border/50 bg-background">
            {id > 0 && <BrushThumbnail size={24} version={version} cache={ITEM_SPRITE_CACHE} layout={layouts.get(id) ?? null} />}
          </span>
          {b}
          <button
            className="text-muted-foreground hover:text-[#f0795b]"
            onClick={() => onChange(category.brushes.filter((x) => x !== b))}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      );
    })}
    <Select value="" onValueChange={(v) => category.brushes.includes(v) || onChange([...category.brushes, v])}>
      <SelectTrigger className="h-7 w-44 text-xs">
        <SelectValue placeholder="+ add brush" />
      </SelectTrigger>
      <SelectContent>
        {brushNames
          .filter((n) => !category.brushes.includes(n))
          .map((n) => (
            <SelectItem key={n} value={n}>
              {n}
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  </div>
);

const TilesetCategories = ({ def, brushLookid, brushNames, flagIndex, onChange }: TilesetEditorProps) => {
  const spriteIds = [
    ...def.categories.flatMap((c) => c.items.map((e) => e.fromId)),
    ...def.categories.flatMap((c) => c.brushes.map((b) => brushLookid.get(b) ?? 0))
  ];
  const { layouts, version } = useItemSprites(spriteIds);

  const setCategory = (i: number, patch: Partial<TilesetCategory>) =>
    onChange({ ...def, categories: def.categories.map((c, k) => (k === i ? { ...c, ...patch } : c)) });
  const removeCategory = (i: number) => onChange({ ...def, categories: def.categories.filter((_, k) => k !== i) });
  const addCategory = (kind: string) =>
    onChange({ ...def, categories: [...def.categories, { kind, items: [], brushes: [], flags: [] }] });

  const usedKinds = def.categories.map((c) => c.kind);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Plus className="h-3.5 w-3.5 text-muted-foreground" />
        <Select value="" onValueChange={addCategory}>
          <SelectTrigger className="h-7 w-44 text-xs">
            <SelectValue placeholder="Add category" />
          </SelectTrigger>
          <SelectContent>
            {ADDABLE_KINDS.filter((k) => !usedKinds.includes(k)).map((k) => (
              <SelectItem key={k} value={k}>
                {k}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {def.categories.map((cat, i) => (
        <section key={i} className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-foreground">{cat.kind}</span>
            <button
              title="Remove category"
              onClick={() => removeCategory(i)}
              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-[#c42b1c] hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {isItemKind(cat.kind) ? (
            <ItemCategory
              index={i}
              category={cat}
              layouts={layouts}
              version={version}
              flagIndex={flagIndex}
              onFlags={(flags) => setCategory(i, { flags })}
              onChange={(items) => setCategory(i, { items })}
            />
          ) : (
            <BrushCategory
              category={cat}
              layouts={layouts}
              version={version}
              brushNames={brushNames}
              brushLookid={brushLookid}
              onChange={(brushes) => setCategory(i, { brushes })}
            />
          )}
        </section>
      ))}
    </div>
  );
};

export default TilesetCategories;
