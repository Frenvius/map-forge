import React from 'react';
import { useDroppable } from '@dnd-kit/core';

import { cn } from '~/usecase/classNames';
import { BrushSpriteLayout } from '~/usecase/brushSprite';
import BrushThumbnail from '~/components/PalettePanel/BrushThumbnail';
import { BorderDef, BorderEdge, BORDER_EDGES } from '~/adapter/materials';

import { useItemSprites, ITEM_SPRITE_CACHE } from './sprites';

interface BorderEditorProps {
  border: BorderDef;
  onChange: (next: BorderDef) => void;
}

const PLACED: { edge: BorderEdge; x: number; y: number }[] = [
  { edge: 'cse', x: 8, y: 8 },
  { edge: 's', x: 140, y: 8 },
  { edge: 'csw', x: 272, y: 8 },
  { edge: 'dse', x: 96, y: 96 },
  { edge: 'dsw', x: 184, y: 96 },
  { edge: 'e', x: 8, y: 140 },
  { edge: 'dne', x: 96, y: 184 },
  { edge: 'dnw', x: 184, y: 184 },
  { edge: 'w', x: 272, y: 140 },
  { edge: 'cne', x: 8, y: 272 },
  { edge: 'n', x: 140, y: 272 },
  { edge: 'cnw', x: 272, y: 272 }
];

interface SlotProps {
  edge: BorderEdge;
  x: number;
  y: number;
  id: number;
  layout: BrushSpriteLayout | null;
  version: number;
  onSet: (edge: BorderEdge, value: number) => void;
}

const Slot = ({ edge, x, y, id, layout, version, onSet }: SlotProps) => {
  const { setNodeRef, isOver } = useDroppable({ id: `edge-${edge}` });
  return (
    <div style={{ left: x, top: y, width: 80 }} className="absolute flex flex-col items-center">
      <div
        title={edge}
        ref={setNodeRef}
        className={cn(
          'group relative flex h-20 w-20 items-center justify-center overflow-hidden rounded-md border bg-background transition-colors',
          isOver ? 'border-primary ring-1 ring-primary' : 'border-border hover:border-primary/60'
        )}
      >
        {id > 0 ? (
          <BrushThumbnail size={64} layout={layout} version={version} cache={ITEM_SPRITE_CACHE} />
        ) : (
          <span className="text-[10px] uppercase text-muted-foreground">{edge}</span>
        )}
        <input
          type="number"
          value={id || ''}
          placeholder="id"
          onChange={(e) => onSet(edge, Number(e.target.value) || 0)}
          className="absolute left-1/2 top-1/2 w-14 -translate-x-1/2 -translate-y-1/2 rounded border border-border bg-background/90 px-1 py-0.5 text-center text-[11px] text-foreground opacity-0 shadow outline-none transition-opacity focus:opacity-100 focus:ring-1 focus:ring-ring group-hover:opacity-100"
        />
      </div>
    </div>
  );
};

const PREVIEW_RING: (BorderEdge | null)[][] = [
  ['cse', 's', 'csw'],
  ['e', null, 'w'],
  ['cne', 'n', 'cnw']
];
const PREVIEW_INNER: BorderEdge[][] = [
  ['dnw', 'dne'],
  ['dsw', 'dse']
];

const PreviewCell = ({
  edge,
  border,
  layouts,
  version,
  center
}: {
  edge: BorderEdge | null;
  border: BorderDef;
  layouts: ReturnType<typeof useItemSprites>['layouts'];
  version: number;
  center?: boolean;
}) => {
  const id = edge ? (border.items[edge] ?? 0) : 0;
  return (
    <div className={cn('flex h-8 w-8 items-center justify-center', center && 'bg-primary/15')}>
      {id > 0 && <BrushThumbnail size={32} version={version} cache={ITEM_SPRITE_CACHE} layout={layouts.get(id) ?? null} />}
    </div>
  );
};

const BorderPreview = ({
  border,
  layouts,
  version
}: {
  border: BorderDef;
  layouts: ReturnType<typeof useItemSprites>['layouts'];
  version: number;
}) => (
  <div className="flex flex-col items-center gap-3">
    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Assembled preview</span>
    <div className="flex items-end gap-6">
      <div className="flex flex-col items-center gap-1">
        <div className="overflow-hidden rounded-md border border-border/50 bg-background">
          {PREVIEW_RING.map((row, r) => (
            <div key={r} className="flex">
              {row.map((edge, c) => (
                <PreviewCell key={c} edge={edge} border={border} layouts={layouts} version={version} center={edge === null} />
              ))}
            </div>
          ))}
        </div>
        <span className="text-[10px] text-muted-foreground">outer</span>
      </div>
      <div className="flex flex-col items-center gap-1">
        <div className="overflow-hidden rounded-md border border-border/50 bg-background">
          {PREVIEW_INNER.map((row, r) => (
            <div key={r} className="flex">
              {row.map((edge, c) => (
                <PreviewCell key={c} edge={edge} border={border} layouts={layouts} version={version} />
              ))}
            </div>
          ))}
        </div>
        <span className="text-[10px] text-muted-foreground">inner</span>
      </div>
    </div>
  </div>
);

const BorderEditor = ({ border, onChange }: BorderEditorProps) => {
  const ids = BORDER_EDGES.map((e) => border.items[e] ?? 0);
  const { layouts, version } = useItemSprites(ids);

  const setEdge = (edge: BorderEdge, value: number) => {
    const items = { ...border.items };
    if (value > 0) items[edge] = value;
    else delete items[edge];
    onChange({ ...border, items });
  };

  return (
    <div className="flex flex-col gap-2">
      <BorderPreview border={border} layouts={layouts} version={version} />
      <div className="relative mx-auto" style={{ width: 360, height: 352 }}>
        {PLACED.map((slot) => {
          const id = border.items[slot.edge] ?? 0;
          return (
            <Slot
              id={id}
              x={slot.x}
              y={slot.y}
              key={slot.edge}
              onSet={setEdge}
              edge={slot.edge}
              version={version}
              layout={layouts.get(id) ?? null}
            />
          );
        })}
      </div>
    </div>
  );
};

export default BorderEditor;
