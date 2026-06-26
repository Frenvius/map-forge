import React from 'react';
import { X } from 'lucide-react';
import { useDroppable } from '@dnd-kit/core';

import { cn } from '~/usecase/classNames';
import { DoodadBrush } from '~/adapter/materials';
import { Checkbox } from '~/components/commons/ui/checkbox';
import BrushThumbnail from '~/components/PalettePanel/BrushThumbnail';

import { useItemSprites, ITEM_SPRITE_CACHE } from './sprites';

interface DoodadEditorProps {
  brush: DoodadBrush;
  onChange: (next: DoodadBrush) => void;
}

const DoodadEditor = ({ brush, onChange }: DoodadEditorProps) => {
  const lookid = brush.serverLookid ?? brush.items[0]?.id ?? 0;
  const { layouts, version } = useItemSprites([...brush.items.map((i) => i.id), ...(lookid ? [lookid] : [])]);
  const items = useDroppable({ id: 'doodad-items' });
  const icon = useDroppable({ id: 'doodad-lookid' });

  const total = brush.items.reduce((s, i) => s + Math.max(0, i.chance), 0);

  const setItemChance = (idx: number, chance: number) =>
    onChange({ ...brush, items: brush.items.map((it, i) => (i === idx ? { ...it, chance } : it)) });
  const removeItem = (idx: number) => onChange({ ...brush, items: brush.items.filter((_, i) => i !== idx) });

  return (
    <div className="flex flex-col gap-5">
      <section className="flex items-center gap-4">
        <div
          ref={icon.setNodeRef}
          title="Drop an item here to set the palette icon"
          className={cn(
            'flex h-16 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-background transition-colors',
            icon.isOver ? 'border-primary ring-1 ring-primary' : 'border-border'
          )}
        >
          {lookid > 0 ? (
            <BrushThumbnail size={48} version={version} cache={ITEM_SPRITE_CACHE} layout={layouts.get(lookid) ?? null} />
          ) : (
            <span className="text-[10px] text-muted-foreground">drop icon</span>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-xs text-foreground">
            <Checkbox checked={brush.draggable} onCheckedChange={(v) => onChange({ ...brush, draggable: v === true })} />
            Draggable
          </label>
          <label className="flex items-center gap-2 text-xs text-foreground">
            <Checkbox checked={brush.onBlocking} onCheckedChange={(v) => onChange({ ...brush, onBlocking: v === true })} />
            On blocking
          </label>
        </div>
        <label className="ml-auto flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Thickness</span>
          <input
            placeholder="e.g. 12/100"
            value={brush.thickness ?? ''}
            onChange={(e) => onChange({ ...brush, thickness: e.target.value.trim() || null })}
            className="h-7 w-28 rounded border border-border bg-input px-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
          />
        </label>
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-foreground">Items</span>
          <span className="font-mono text-[10px] text-muted-foreground">Σ {total}</span>
        </div>
        <div
          ref={items.setNodeRef}
          className={cn(
            'grid grid-cols-[repeat(auto-fill,minmax(72px,1fr))] gap-2 rounded-lg border border-dashed p-2 transition-colors',
            items.isOver ? 'border-primary bg-primary/5' : 'border-border/60'
          )}
        >
          {brush.items.map((it, i) => {
            const pct = total > 0 ? Math.round((Math.max(0, it.chance) / total) * 100) : 0;
            return (
              <div
                key={i}
                className="group relative flex flex-col items-center gap-1 rounded-md border border-border/60 bg-background p-1.5"
              >
                <button
                  title="Remove"
                  onClick={() => removeItem(i)}
                  className="absolute right-0.5 top-0.5 hidden h-4 w-4 items-center justify-center rounded bg-secondary text-muted-foreground hover:bg-[#c42b1c] hover:text-white group-hover:flex"
                >
                  <X className="h-3 w-3" />
                </button>
                <div className="flex h-10 w-10 items-center justify-center overflow-hidden">
                  <BrushThumbnail size={40} version={version} cache={ITEM_SPRITE_CACHE} layout={layouts.get(it.id) ?? null} />
                </div>
                <input
                  type="number"
                  value={it.chance}
                  onChange={(e) => setItemChance(i, Number(e.target.value) || 0)}
                  className="h-5 w-full rounded border border-border bg-input px-1 text-center text-[10px] text-foreground outline-none focus:ring-1 focus:ring-ring"
                />
                <div className="h-1 w-full overflow-hidden rounded bg-secondary">
                  <div style={{ width: `${pct}%` }} className="h-full bg-primary" />
                </div>
                <span className="font-mono text-[9px] text-muted-foreground">
                  {it.id} · {pct}%
                </span>
              </div>
            );
          })}
          {brush.items.length === 0 && (
            <span className="col-span-full py-4 text-center text-xs text-muted-foreground">Drag items here to add</span>
          )}
        </div>
      </section>

      {brush.compositeCount > 0 && (
        <section className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-foreground">Composites</span>
          <p className="text-[11px] text-muted-foreground">
            {brush.compositeCount} multi-tile composite{brush.compositeCount > 1 ? 's' : ''} preserved on save. Visual editing
            coming later.
          </p>
        </section>
      )}
    </div>
  );
};

export default DoodadEditor;
