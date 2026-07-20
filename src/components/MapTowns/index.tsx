import React from 'react';
import { X, Plus, Trash2, MapPin, Crosshair } from 'lucide-react';

import { Town } from '~/domain/map';
import { cn } from '~/usecase/classNames';
import { getTowns, setTowns } from '~/adapter/map';
import { Input } from '~/components/commons/ui/input';
import { Hint } from '~/components/commons/ui/tooltip';
import { Button } from '~/components/commons/ui/button';

interface MapTownsProps {
  open: boolean;
  mapId: number | null;
  cursorRef: React.RefObject<{ x: number; y: number; z: number } | null>;
  onSaved?: () => void;
  onClose: () => void;
  onGoto: (x: number, y: number, z: number) => void;
}

const MapTownsPanel = ({ open, mapId, cursorRef, onSaved, onClose, onGoto }: MapTownsProps) => {
  const [towns, setTownList] = React.useState<Town[]>([]);
  const [selectedId, setSelectedId] = React.useState<number | null>(null);
  const [pos, setPos] = React.useState({ x: 60, y: 80 });
  const dragRef = React.useRef<{ startX: number; startY: number; panelX: number; panelY: number } | null>(null);

  React.useEffect(() => {
    if (!open || mapId === null) return;
    void getTowns(mapId).then((list) => {
      setTownList(list);
      setSelectedId(list[0]?.id ?? null);
    });
  }, [open, mapId]);

  const selected = towns.find((t) => t.id === selectedId) ?? null;

  const patchSelected = (next: Partial<Town>) =>
    setTownList((list) => list.map((t) => (t.id === selectedId ? { ...t, ...next } : t)));

  const nextId = () => towns.reduce((max, t) => Math.max(max, t.id), 0) + 1;

  const addTown = () => {
    const id = nextId();
    const town: Town = { id, name: 'Unnamed Town', x: 0, y: 0, z: 7 };
    setTownList((list) => [...list, town]);
    setSelectedId(id);
  };

  const addTownAtCursor = () => {
    const c = cursorRef.current;
    if (!c) return;
    const id = nextId();
    const town: Town = { id, name: 'Unnamed Town', x: c.x, y: c.y, z: c.z };
    setTownList((list) => [...list, town]);
    setSelectedId(id);
  };

  const removeTown = () => {
    if (selectedId === null) return;
    setTownList((list) => {
      const next = list.filter((t) => t.id !== selectedId);
      setSelectedId(next[0]?.id ?? null);
      return next;
    });
  };

  const useMapPosition = () => {
    const c = cursorRef.current;
    if (!c || !selected) return;
    patchSelected({ x: c.x, y: c.y, z: c.z });
  };

  const gotoTemple = () => {
    if (!selected) return;
    onGoto(selected.x, selected.y, selected.z);
  };

  const save = () => {
    if (mapId === null) return;
    void setTowns(mapId, towns).then(() => {
      onSaved?.();
      onClose();
    });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, panelX: pos.x, panelY: pos.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    setPos({
      x: dragRef.current.panelX + (e.clientX - dragRef.current.startX),
      y: dragRef.current.panelY + (e.clientY - dragRef.current.startY)
    });
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  if (!open) return null;

  return (
    <div
      style={{ left: pos.x, top: pos.y }}
      className="fixed z-40 flex w-[420px] flex-col rounded-lg border border-border bg-card shadow-island-lg"
    >
      <div
        onPointerUp={onPointerUp}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        className="flex h-8 flex-shrink-0 cursor-grab items-center border-b border-border/50 bg-secondary/80 px-3 active:cursor-grabbing"
      >
        <h2 className="select-none text-xs font-semibold uppercase tracking-wide text-foreground">Edit Towns</h2>
        <button
          onClick={onClose}
          className="ml-auto flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-item-hover hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex gap-3 p-3">
        <div className="flex w-40 flex-col gap-2">
          <div className="h-48 overflow-y-auto rounded-md border border-border bg-input">
            {towns.length === 0 ? (
              <div className="p-3 text-xs text-muted-foreground">No towns</div>
            ) : (
              towns.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setSelectedId(t.id)}
                  className={cn(
                    'block w-full truncate px-2.5 py-1 text-left text-xs',
                    t.id === selectedId ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-accent'
                  )}
                >
                  {t.name}
                </button>
              ))
            )}
          </div>
          <div className="flex gap-1">
            <Hint side="bottom" label="Add town">
              <Button size="sm" variant="ghost" onClick={addTown} className="h-6 w-6 p-0">
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </Hint>
            <Hint side="bottom" label="Add town at cursor">
              <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={addTownAtCursor}>
                <Crosshair className="h-3.5 w-3.5" />
              </Button>
            </Hint>
            {selected && (
              <Hint side="bottom" label="Remove town">
                <Button size="sm" variant="ghost" onClick={removeTown} className="h-6 w-6 p-0 text-destructive">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </Hint>
            )}
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-2">
          {selected ? (
            <>
              <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
                Name
                <Input className="h-7" value={selected.name} onChange={(e) => patchSelected({ name: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                Town ID
                <Input disabled className="h-7" value={selected.id} />
              </label>
              <div className="flex items-end gap-1.5">
                <div className="grid flex-1 grid-cols-3 gap-1.5">
                  {(['x', 'y', 'z'] as const).map((axis) => (
                    <label key={axis} className="flex flex-col gap-1 text-xs font-medium text-foreground">
                      Temple {axis.toUpperCase()}
                      <Input
                        type="number"
                        className="h-7"
                        value={selected[axis]}
                        onChange={(e) => patchSelected({ [axis]: Number(e.target.value) })}
                      />
                    </label>
                  ))}
                </div>
                <Hint side="bottom" label="Use cursor position">
                  <Button size="sm" variant="ghost" onClick={useMapPosition} className="h-7 w-7 flex-shrink-0 p-0">
                    <Crosshair className="h-3.5 w-3.5" />
                  </Button>
                </Hint>
              </div>
              <Button size="sm" variant="ghost" onClick={gotoTemple} className="h-6 w-fit text-xs">
                <MapPin className="mr-1 h-3 w-3" />
                Go To
              </Button>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">Select or add a town</div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-border/50 px-3 py-2">
        <Button size="sm" variant="ghost" onClick={onClose} className="h-7 text-xs">
          Cancel
        </Button>
        <Button size="sm" onClick={save} className="h-7 text-xs">
          Save
        </Button>
      </div>
    </div>
  );
};

export default MapTownsPanel;
