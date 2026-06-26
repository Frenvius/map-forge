import React from 'react';
import { X } from 'lucide-react';
import { useDroppable } from '@dnd-kit/core';

import { cn } from '~/usecase/classNames';
import { Checkbox } from '~/components/commons/ui/checkbox';
import { WallBrush, WallSegment } from '~/adapter/materials';
import BrushThumbnail from '~/components/PalettePanel/BrushThumbnail';

import { useItemSprites, ITEM_SPRITE_CACHE, type SpriteLayouts } from './sprites';

interface WallEditorProps {
  brush: WallBrush;
  onChange: (next: WallBrush) => void;
}

const SegmentView = ({
  segment,
  layouts,
  version,
  onItems
}: {
  segment: WallSegment;
  layouts: SpriteLayouts;
  version: number;
  onItems: (items: WallSegment['items']) => void;
}) => {
  const { setNodeRef, isOver } = useDroppable({ id: `wall-seg-${segment.type}` });
  const total = segment.items.reduce((s, i) => s + Math.max(0, i.chance), 0);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold capitalize text-foreground">{segment.type}</span>
        <span className="font-mono text-[10px] text-muted-foreground">
          {segment.doorCount > 0 ? `${segment.doorCount} doors · ` : ''}Σ {total}
        </span>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          'grid grid-cols-[repeat(auto-fill,minmax(78px,1fr))] gap-2 rounded-lg border border-dashed p-2 transition-colors',
          isOver ? 'border-primary bg-primary/5' : 'border-border/60'
        )}
      >
        {segment.items.map((it, i) => {
          const pct = total > 0 ? Math.round((Math.max(0, it.chance) / total) * 100) : 0;
          return (
            <div
              key={i}
              className="group relative flex flex-col items-center gap-1 rounded-md border border-border/60 bg-background p-1.5"
            >
              <button
                title="Remove"
                onClick={() => onItems(segment.items.filter((_, k) => k !== i))}
                className="absolute right-0.5 top-0.5 hidden h-4 w-4 items-center justify-center rounded bg-secondary text-muted-foreground hover:bg-[#c42b1c] hover:text-white group-hover:flex"
              >
                <X className="h-3 w-3" />
              </button>
              <div className="flex h-9 w-9 items-center justify-center overflow-hidden">
                <BrushThumbnail size={36} version={version} cache={ITEM_SPRITE_CACHE} layout={layouts.get(it.id) ?? null} />
              </div>
              <input
                type="number"
                value={it.chance}
                className="h-5 w-full rounded border border-border bg-input px-1 text-center text-[10px] text-foreground outline-none focus:ring-1 focus:ring-ring"
                onChange={(e) =>
                  onItems(segment.items.map((x, k) => (k === i ? { ...x, chance: Number(e.target.value) || 0 } : x)))
                }
              />
              <span className="whitespace-nowrap font-mono text-[9px] text-muted-foreground">
                {it.id} · {pct}%
              </span>
            </div>
          );
        })}
        {segment.items.length === 0 && (
          <span className="col-span-full py-3 text-center text-xs text-muted-foreground">Drag items here</span>
        )}
      </div>
    </div>
  );
};

const WallEditor = ({ brush, onChange }: WallEditorProps) => {
  const lookid = brush.serverLookid ?? brush.segments[0]?.items[0]?.id ?? 0;
  const allIds = [...brush.segments.flatMap((s) => s.items.map((i) => i.id)), ...(lookid ? [lookid] : [])];
  const { layouts, version } = useItemSprites(allIds);

  const setSegmentItems = (type: string, items: WallSegment['items']) =>
    onChange({ ...brush, segments: brush.segments.map((s) => (s.type === type ? { ...s, items } : s)) });

  return (
    <div className="flex flex-col gap-5">
      <section className="flex items-center gap-4">
        <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-background">
          {lookid > 0 ? (
            <BrushThumbnail size={48} version={version} cache={ITEM_SPRITE_CACHE} layout={layouts.get(lookid) ?? null} />
          ) : (
            <span className="text-[10px] text-muted-foreground">no icon</span>
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
            placeholder="e.g. 100/100"
            value={brush.thickness ?? ''}
            onChange={(e) => onChange({ ...brush, thickness: e.target.value.trim() || null })}
            className="h-7 w-28 rounded border border-border bg-input px-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
          />
        </label>
      </section>

      {brush.segments.length === 0 ? (
        <p className="text-xs text-muted-foreground">No editable wall segments.</p>
      ) : (
        <section className="flex flex-col gap-4">
          {brush.segments.map((seg) => (
            <SegmentView
              segment={seg}
              key={seg.type}
              layouts={layouts}
              version={version}
              onItems={(items) => setSegmentItems(seg.type, items)}
            />
          ))}
        </section>
      )}

      {brush.extraCount > 0 && (
        <p className="text-[11px] text-muted-foreground">
          {brush.extraCount} alternate/composite block{brush.extraCount > 1 ? 's' : ''} and all doors preserved on save.
        </p>
      )}
    </div>
  );
};

export default WallEditor;
