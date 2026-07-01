import React from 'react';
import { X, Plus } from 'lucide-react';
import { useDroppable } from '@dnd-kit/core';

import { cn } from '~/usecase/classNames';
import BrushThumbnail from '~/components/PalettePanel/BrushThumbnail';
import { BorderDef, BorderRef, GroundBrush, groundLookid } from '~/adapter/materials';
import VirtualSelect, { VirtualSelectRow } from '~/components/commons/ui/VirtualSelect';
import { Select, SelectItem, SelectValue, SelectContent, SelectTrigger } from '~/components/commons/ui/select';

import { useItemSprites, ITEM_SPRITE_CACHE } from './sprites';

interface GroundEditorProps {
  brush: GroundBrush;
  borders: BorderDef[];
  grounds: GroundBrush[];
  onChange: (next: GroundBrush) => void;
}

const TO_DEFAULT = ' default';
const TO_NONE = 'none';

const borderRep = (b: BorderDef) => b.items.n ?? b.items.s ?? b.items.e ?? b.items.w ?? Object.values(b.items).find(Boolean) ?? 0;

const GroundEditor = ({ brush, borders, grounds, onChange }: GroundEditorProps) => {
  const lookid = groundLookid(brush);
  const [visIds, setVisIds] = React.useState<number[]>([]);

  const lookidByName = React.useMemo(() => new Map(grounds.map((g) => [g.name, groundLookid(g)])), [grounds]);
  const spriteIds = [
    ...brush.items.map((i) => i.id),
    ...(lookid ? [lookid] : []),
    ...borders.map(borderRep),
    ...brush.friends.map((f) => lookidByName.get(f) ?? 0),
    ...brush.borders.map((b) => (b.to ? (lookidByName.get(b.to) ?? 0) : 0)),
    ...visIds
  ];
  const { layouts, version } = useItemSprites(spriteIds);
  const { setNodeRef, isOver } = useDroppable({ id: 'ground-items' });

  const total = brush.items.reduce((s, i) => s + Math.max(0, i.chance), 0);
  const otherNames = grounds.map((g) => g.name).filter((n) => n !== brush.name);

  const groundThumb = (key: string) => {
    const id = lookidByName.get(key) ?? 0;
    return id > 0 ? (
      <BrushThumbnail size={28} version={version} cache={ITEM_SPRITE_CACHE} layout={layouts.get(id) ?? null} />
    ) : null;
  };
  const onVisibleNames = (names: string[]) => setVisIds(names.map((n) => lookidByName.get(n) ?? 0).filter(Boolean));

  const repById = React.useMemo(() => new Map(borders.map((d) => [d.id, borderRep(d)])), [borders]);
  const borderRows = React.useMemo<VirtualSelectRow[]>(
    () => borders.map((d) => ({ key: String(d.id), label: d.name ?? `Border ${d.id}` })),
    [borders]
  );
  const toRows = React.useMemo<VirtualSelectRow[]>(
    () => [
      { key: TO_DEFAULT, label: 'to: default' },
      { key: TO_NONE, label: 'to: none' },
      ...otherNames.map((n) => ({ key: n, label: `to: ${n}` }))
    ],
    [otherNames]
  );
  const friendRows = React.useMemo<VirtualSelectRow[]>(
    () => otherNames.filter((n) => !brush.friends.includes(n)).map((n) => ({ key: n, label: n })),
    [otherNames, brush.friends]
  );
  const borderThumb = (key: string) => (
    <BrushThumbnail
      size={28}
      version={version}
      cache={ITEM_SPRITE_CACHE}
      layout={layouts.get(repById.get(Number(key)) ?? 0) ?? null}
    />
  );

  const setItemChance = (idx: number, chance: number) =>
    onChange({ ...brush, items: brush.items.map((it, i) => (i === idx ? { ...it, chance } : it)) });
  const removeItem = (idx: number) => onChange({ ...brush, items: brush.items.filter((_, i) => i !== idx) });

  const setBorder = (idx: number, patch: Partial<BorderRef>) =>
    onChange({ ...brush, borders: brush.borders.map((b, i) => (i === idx ? { ...b, ...patch } : b)) });
  const addBorder = () =>
    onChange({
      ...brush,
      borders: [...brush.borders, { align: 'outer', id: borders[0]?.id ?? null, to: null, groundEquivalent: null, super: false }]
    });
  const removeBorder = (idx: number) => onChange({ ...brush, borders: brush.borders.filter((_, i) => i !== idx) });

  const addFriend = (name: string) => brush.friends.includes(name) || onChange({ ...brush, friends: [...brush.friends, name] });
  const removeFriend = (name: string) => onChange({ ...brush, friends: brush.friends.filter((f) => f !== name) });

  const toValue = (to: string | null) => (to == null ? TO_DEFAULT : to);
  const toModel = (v: string) => (v === TO_DEFAULT ? null : v);

  return (
    <div className="flex flex-col gap-5">
      <section className="flex items-center gap-4">
        <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-background">
          {lookid ? (
            <BrushThumbnail size={48} version={version} cache={ITEM_SPRITE_CACHE} layout={layouts.get(lookid) ?? null} />
          ) : (
            <span className="text-[10px] text-muted-foreground">no icon</span>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Palette icon</span>
          <span className="text-xs text-foreground">Auto from highest chance{lookid ? ` (id ${lookid})` : ''}</span>
        </div>
        <label className="ml-auto flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">z-order</span>
          <input
            type="number"
            placeholder="auto"
            value={brush.zOrder ?? ''}
            onChange={(e) => onChange({ ...brush, zOrder: e.target.value === '' ? null : Number(e.target.value) })}
            className="h-7 w-24 rounded border border-border bg-input px-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
          />
        </label>
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-foreground">Ground items</span>
          <span className="font-mono text-[10px] text-muted-foreground">Σ {total}</span>
        </div>
        <div
          ref={setNodeRef}
          className={cn(
            'grid grid-cols-[repeat(auto-fill,minmax(72px,1fr))] gap-2 rounded-lg border border-dashed p-2 transition-colors',
            isOver ? 'border-primary bg-primary/5' : 'border-border/60'
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

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-foreground">Borders</span>
          <button
            onClick={addBorder}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Plus className="h-3 w-3" /> Add
          </button>
        </div>
        {brush.borders.length === 0 ? (
          <span className="text-xs text-muted-foreground">No borders.</span>
        ) : (
          <div className="flex flex-col gap-1.5">
            {brush.borders.map((b, i) => {
              return (
                <div key={i} className="flex items-center gap-2 rounded-md border border-border/60 bg-background p-1.5">
                  <Select value={b.align} onValueChange={(v) => setBorder(i, { align: v })}>
                    <SelectTrigger className="h-7 w-24 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="outer">outer</SelectItem>
                      <SelectItem value="inner">inner</SelectItem>
                    </SelectContent>
                  </Select>
                  <VirtualSelect
                    rows={borderRows}
                    className="flex-1"
                    placeholder="border"
                    renderThumb={borderThumb}
                    value={b.id != null ? String(b.id) : ''}
                    onChange={(v) => setBorder(i, { id: Number(v) })}
                  />
                  <VirtualSelect
                    rows={toRows}
                    className="w-28"
                    value={toValue(b.to)}
                    renderThumb={groundThumb}
                    onVisibleKeys={onVisibleNames}
                    onChange={(v) => setBorder(i, { to: toModel(v) })}
                  />
                  <button
                    title="Remove"
                    onClick={() => removeBorder(i)}
                    className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-[#c42b1c] hover:text-white"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-foreground">Optional border</span>
          <span className="text-[10px] text-muted-foreground">gravel / mountain overlay</span>
        </div>
        <div className="flex items-center gap-2 rounded-md border border-border/60 bg-background p-1.5">
          <VirtualSelect
            allowNone
            rows={borderRows}
            className="flex-1"
            placeholder="none"
            renderThumb={borderThumb}
            value={brush.optionalId != null ? String(brush.optionalId) : ''}
            onChange={(v) => onChange({ ...brush, optionalId: v === '' ? null : Number(v) })}
          />
          <label className="flex flex-shrink-0 cursor-pointer items-center gap-1.5 pr-1 text-xs text-foreground">
            <input
              type="checkbox"
              checked={brush.soloOptional}
              className="h-3.5 w-3.5 cursor-pointer accent-primary"
              onChange={(e) => onChange({ ...brush, soloOptional: e.target.checked })}
            />
            solo
          </label>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-foreground">Friends</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {brush.friends.map((f) => (
            <span
              key={f}
              className="flex items-center gap-1 rounded-full border border-border/60 bg-secondary/60 py-0.5 pl-2 pr-1 text-xs"
            >
              {f}
              <button onClick={() => removeFriend(f)} className="text-muted-foreground hover:text-[#f0795b]">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <VirtualSelect
            value=""
            className="w-36"
            rows={friendRows}
            onChange={addFriend}
            renderThumb={groundThumb}
            placeholder="+ add friend"
            onVisibleKeys={onVisibleNames}
          />
        </div>
      </section>
    </div>
  );
};

export default GroundEditor;
