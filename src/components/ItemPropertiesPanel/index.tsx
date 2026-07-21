import React from 'react';
import { X } from 'lucide-react';

import { Town } from '~/domain/map';
import { Thing } from '~/domain/thing';
import { cn } from '~/usecase/classNames';
import { LoadedSprite } from '~/domain/sprite';
import { loadSprites } from '~/adapter/sprites';
import { Hint } from '~/components/commons/ui/tooltip';
import { brushSpriteLayout } from '~/usecase/brushSprite';
import { SelectedItem } from '~/components/MapCanvas/types';
import { DragHandleProps } from '~/components/Dock/DockablePanel';
import { useAssetsBundle } from '~/usecase/context/AssetsContext';
import { fluidName, TIBIA_FLUIDS } from '~/lib/formats/tibia/fluids';
import { Select, SelectItem, SelectValue, SelectTrigger, SelectContent } from '~/components/commons/ui/select';
import {
  getTowns,
  setDoorId,
  getTileItems,
  setItemAttrs,
  TileItemEntry,
  OTB_GROUP_DOOR,
  OTB_GROUP_FLUID,
  OTB_GROUP_SPLASH,
  OTB_GROUP_TELEPORT,
  OTB_GROUP_WRITEABLE,
  OTB_GROUP_CONTAINER,
  TilePropertiesPayload
} from '~/adapter/map';

import ItemSprite from './ItemSprite';
import ContainerEditor from './ContainerEditor';

interface ItemPropertiesPanelProps {
  mapId: number | null;
  onClose?: () => void;
  onEdited?: () => void;
  item: SelectedItem | null;
  dragHandle?: DragHandleProps;
  items: Map<number, Thing> | null;
  itemNames: Map<number, string> | null;
}

type FieldDraft = Record<string, string>;

function patchFromEntry(e: TileItemEntry): FieldDraft {
  return {
    actionId: String(e.actionId),
    uniqueId: String(e.uniqueId),
    text: e.text,
    desc: e.desc,
    charges: String(e.charges),
    tier: String(e.tier),
    depotId: String(e.depotId),
    subtype: String(e.subtype),
    teleX: String(e.teleX),
    teleY: String(e.teleY),
    teleZ: String(e.teleZ)
  };
}

function hasTele(e: TileItemEntry): boolean {
  return e.teleX !== 0 || e.teleY !== 0 || e.teleZ !== 0;
}

function isFluidEntry(e: TileItemEntry): boolean {
  return e.group === OTB_GROUP_FLUID || e.group === OTB_GROUP_SPLASH || e.kind === 'splash' || e.kind === 'fluidcontainer';
}

const NumField = ({
  max,
  min,
  label,
  value,
  onChange
}: {
  max: number;
  min?: number;
  label: string;
  value: string;
  onChange: (v: string) => void;
}) => (
  <div className="flex items-center justify-between">
    <span className="text-muted-foreground">{label}:</span>
    <input
      max={max}
      type="number"
      value={value}
      min={min ?? 0}
      onChange={(e) => onChange(e.target.value)}
      className="w-20 rounded border border-border/50 bg-secondary/50 px-2 py-0.5 text-right font-mono text-foreground focus:border-accent focus:outline-none"
    />
  </div>
);

const PickRow = ({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (v: string) => void;
}) => (
  <div className="flex items-center justify-between">
    <span className="text-muted-foreground">{label}:</span>
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-7 w-32">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  </div>
);

const ItemPropertiesPanel = ({ mapId, item, items, itemNames, dragHandle, onClose, onEdited }: ItemPropertiesPanelProps) => {
  const { assets } = useAssetsBundle();
  const [data, setData] = React.useState<TilePropertiesPayload | null>(null);
  const [selectedIdx, setSelectedIdx] = React.useState(-1);
  const [spriteVer, setSpriteVer] = React.useState(0);
  const [draft, setDraft] = React.useState<FieldDraft>({});
  const spriteCache = React.useRef<Map<number, LoadedSprite>>(new Map());
  const [towns, setTowns] = React.useState<Town[]>([]);
  const [doorDraft, setDoorDraft] = React.useState('');
  const prevKey = React.useRef('');
  const saving = React.useRef(false);

  React.useEffect(() => {
    if (mapId === null) {
      setTowns([]);
      return;
    }
    getTowns(mapId)
      .then(setTowns)
      .catch(() => setTowns([]));
  }, [mapId]);

  React.useEffect(() => {
    setDoorDraft(data ? String(data.doorId) : '');
  }, [data?.doorId]);

  const refresh = React.useCallback(() => {
    if (!item || mapId === null) return;
    getTileItems(mapId, item.z, item.x, item.y).then((result) => {
      setData(result);
      const topIdx = result.items.length - 1;
      const match = result.items.findIndex((e) => e.serverId === item.serverId);
      const idx = match >= 0 ? match : topIdx;
      setSelectedIdx(idx);
      if (result.items[idx]) setDraft(patchFromEntry(result.items[idx]));
    });
  }, [mapId, item?.x, item?.y, item?.z, item?.serverId]);

  React.useEffect(() => {
    if (!item || mapId === null) {
      setData(null);
      setSelectedIdx(-1);
      setDraft({});
      prevKey.current = '';
      return;
    }
    const key = `${mapId},${item.z},${item.x},${item.y}`;
    if (key === prevKey.current) return;
    prevKey.current = key;
    refresh();
  }, [mapId, item?.x, item?.y, item?.z, item?.serverId, refresh]);

  React.useEffect(() => {
    if (!data || !items || !assets) return;
    const needed: number[] = [];
    for (const entry of data.items) {
      const thing = items.get(entry.clientId);
      if (!thing) continue;
      if (isFluidEntry(entry)) {
        for (const spriteId of thing.spriteIndex) {
          if (spriteId > 0 && !spriteCache.current.has(spriteId)) needed.push(spriteId);
        }
        continue;
      }
      for (const cell of brushSpriteLayout(thing, false).cells) {
        if (cell.spriteId > 0 && !spriteCache.current.has(cell.spriteId)) needed.push(cell.spriteId);
      }
    }
    if (needed.length === 0) return;
    loadSprites(assets.sprPath, needed, assets.transparency, spriteCache.current).then(() => setSpriteVer((v) => v + 1));
  }, [data, items, assets]);

  const sel: TileItemEntry | null = data && selectedIdx >= 0 ? (data.items[selectedIdx] ?? null) : null;
  const selThing: Thing | null = sel && items ? (items.get(sel.clientId) ?? null) : null;
  const selAttrs = selThing?.attrs ? Object.entries(selThing.attrs) : [];
  const thingRaw = selThing as Record<string, unknown> | null;
  const isTeleport = sel
    ? sel.kind === 'teleport' || sel.group === OTB_GROUP_TELEPORT || hasTele(sel) || selThing?.attrs?.['teleport'] === true
    : false;
  const isWritable = sel
    ? sel.group === OTB_GROUP_WRITEABLE ||
      thingRaw?.['writable'] === true ||
      thingRaw?.['writableOnce'] === true ||
      selThing?.attrs?.['writable'] === true
    : false;
  const isDoor = sel ? sel.kind === 'door' || sel.group === OTB_GROUP_DOOR || selThing?.attrs?.['door'] === true : false;
  const isDepot = sel ? sel.kind === 'depot' : false;
  const isContainer = sel
    ? sel.kind === 'container' ||
      sel.group === OTB_GROUP_CONTAINER ||
      thingRaw?.['isContainer'] === true ||
      selThing?.attrs?.['container'] === true
    : false;
  const isSplash = sel ? sel.group === OTB_GROUP_SPLASH || sel.kind === 'splash' : false;
  const isFluid = sel ? sel.group === OTB_GROUP_FLUID || sel.kind === 'fluidcontainer' : false;
  const showCount = sel ? selThing?.attrs?.['stackable'] === true || isSplash || isFluid || sel.subtype > 1 : false;

  const nameOf = (e: TileItemEntry) => itemNames?.get(e.serverId) ?? '';

  const selectItem = (i: number) => {
    setSelectedIdx(i);
    if (data?.items[i]) setDraft(patchFromEntry(data.items[i]));
  };

  const setField = (key: string, value: string) => {
    setDraft((d) => ({ ...d, [key]: value }));
  };

  const commitWith = React.useCallback(
    async (overrides: Record<string, string> = {}) => {
      if (!sel || !data || mapId === null || !item || saving.current) return;
      saving.current = true;
      try {
        const src = { ...draft, ...overrides };
        const num = (k: string, max: number) => Math.max(0, Math.min(max, parseInt(src[k] || '0', 10) || 0));
        await setItemAttrs(mapId, item.z, item.x, item.y, selectedIdx, {
          actionId: num('actionId', 65535),
          uniqueId: num('uniqueId', 65535),
          text: src.text || '',
          desc: src.desc || '',
          charges: num('charges', 65535),
          tier: num('tier', 255),
          depotId: num('depotId', 65535),
          subtype: num('subtype', 255),
          teleX: num('teleX', 65535),
          teleY: num('teleY', 65535),
          teleZ: num('teleZ', 15)
        });
        onEdited?.();
        refresh();
      } finally {
        saving.current = false;
      }
    },
    [sel, data, mapId, item, selectedIdx, draft, onEdited, refresh]
  );

  const commitDoor = React.useCallback(async () => {
    if (mapId === null || !item || !data) return;
    const v = Math.max(0, Math.min(255, parseInt(doorDraft || '0', 10) || 0));
    if (v === data.doorId) return;
    await setDoorId(mapId, item.z, item.x, item.y, v);
    onEdited?.();
    refresh();
  }, [mapId, item, data, doorDraft, onEdited, refresh]);

  const fluidOptions = React.useMemo(() => {
    const cur = draft.subtype || '0';
    const opts = TIBIA_FLUIDS.map((f) => ({ value: String(f.value), label: f.name }));
    if (!opts.some((o) => o.value === cur)) opts.unshift({ value: cur, label: fluidName(parseInt(cur, 10) || 0) });
    return opts;
  }, [draft.subtype]);

  const depotOptions = React.useMemo(() => {
    const cur = draft.depotId || '0';
    const opts = towns.map((t) => ({ value: String(t.id), label: t.name }));
    if (!opts.some((o) => o.value === cur)) opts.unshift({ value: cur, label: `#${cur}` });
    return opts;
  }, [towns, draft.depotId]);

  const containerRef = React.useRef<HTMLDivElement>(null);

  const handleBlur = (e: React.FocusEvent) => {
    if (!sel) return;
    if (containerRef.current?.contains(e.relatedTarget as Node)) return;
    const orig = patchFromEntry(sel);
    const changed = Object.keys(orig).some((k) => orig[k] !== draft[k]);
    if (changed) commitWith();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      (e.target as HTMLElement).blur();
    }
  };

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
        <div ref={containerRef} onBlur={handleBlur} onKeyDown={handleKeyDown} className="flex-1 overflow-y-auto text-xs">
          <div className="border-b border-border/50 px-2 pb-1 pt-1.5">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Items</div>
            {data.items.map((entry, i) => (
              <button
                key={i}
                onClick={() => selectItem(i)}
                className={cn(
                  'flex w-full items-center gap-2 rounded px-1 py-0.5 text-left',
                  i === selectedIdx ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
                )}
              >
                {items && (
                  <ItemSprite
                    items={items}
                    version={spriteVer}
                    clientId={entry.clientId}
                    cache={spriteCache.current}
                    subtype={
                      isFluidEntry(entry)
                        ? i === selectedIdx
                          ? parseInt(draft.subtype || '0', 10) || 0
                          : entry.subtype
                        : undefined
                    }
                  />
                )}
                <span className="min-w-0 truncate">
                  {entry.serverId} - {nameOf(entry) || 'item'}
                </span>
              </button>
            ))}
          </div>

          {sel && (
            <>
              <div className="border-b border-border/50 px-2 pb-1.5 pt-1.5">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">IDs</div>
                <div className="flex flex-col gap-1">
                  <NumField
                    max={65535}
                    label="Action ID"
                    value={draft.actionId || '0'}
                    onChange={(v) => setField('actionId', v)}
                  />
                  <NumField
                    max={65535}
                    label="Unique ID"
                    value={draft.uniqueId || '0'}
                    onChange={(v) => setField('uniqueId', v)}
                  />
                </div>
              </div>

              {isTeleport && (
                <div className="border-b border-border/50 px-2 pb-1.5 pt-1.5">
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Teleport Destination
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex flex-1 items-center gap-1">
                      <span className="text-muted-foreground">X:</span>
                      <input
                        min={0}
                        max={65535}
                        type="number"
                        value={draft.teleX || '0'}
                        onChange={(e) => setField('teleX', e.target.value)}
                        className="w-full rounded border border-border/50 bg-secondary/50 px-1.5 py-0.5 text-right font-mono text-foreground focus:border-accent focus:outline-none"
                      />
                    </div>
                    <div className="flex flex-1 items-center gap-1">
                      <span className="text-muted-foreground">Y:</span>
                      <input
                        min={0}
                        max={65535}
                        type="number"
                        value={draft.teleY || '0'}
                        onChange={(e) => setField('teleY', e.target.value)}
                        className="w-full rounded border border-border/50 bg-secondary/50 px-1.5 py-0.5 text-right font-mono text-foreground focus:border-accent focus:outline-none"
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-muted-foreground">Z:</span>
                      <input
                        min={0}
                        max={15}
                        type="number"
                        value={draft.teleZ || '0'}
                        onChange={(e) => setField('teleZ', e.target.value)}
                        className="w-14 rounded border border-border/50 bg-secondary/50 px-1.5 py-0.5 text-right font-mono text-foreground focus:border-accent focus:outline-none"
                      />
                    </div>
                  </div>
                </div>
              )}

              {isDoor && data.houseId !== 0 && (
                <div className="border-b border-border/50 px-2 pb-1.5 pt-1.5">
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Door</div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Door ID:</span>
                    <input
                      min={0}
                      max={255}
                      type="number"
                      value={doorDraft}
                      onBlur={commitDoor}
                      onChange={(e) => setDoorDraft(e.target.value)}
                      className="w-20 rounded border border-border/50 bg-secondary/50 px-2 py-0.5 text-right font-mono text-foreground focus:border-accent focus:outline-none"
                    />
                  </div>
                </div>
              )}

              {isContainer && mapId !== null && item && (
                <div className="border-b border-border/50 px-2 pb-1.5 pt-1.5">
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Container</div>
                  <ContainerEditor
                    mapId={mapId}
                    items={items}
                    itemNames={itemNames}
                    onChanged={() => onEdited?.()}
                    pos={{ z: item.z, x: item.x, y: item.y, stackIdx: selectedIdx }}
                  />
                </div>
              )}

              {(isWritable || sel.text) && (
                <div className="border-b border-border/50 px-2 pb-1.5 pt-1.5">
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Text</div>
                  <textarea
                    rows={3}
                    value={draft.text || ''}
                    onChange={(e) => setField('text', e.target.value)}
                    className="w-full resize-y rounded border border-border/50 bg-secondary/50 p-1.5 font-mono text-foreground focus:border-accent focus:outline-none"
                  />
                </div>
              )}

              {sel.desc && (
                <div className="border-b border-border/50 px-2 pb-1.5 pt-1.5">
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Description</div>
                  <textarea
                    rows={2}
                    value={draft.desc || ''}
                    onChange={(e) => setField('desc', e.target.value)}
                    className="w-full resize-y rounded border border-border/50 bg-secondary/50 p-1.5 font-mono text-foreground focus:border-accent focus:outline-none"
                  />
                </div>
              )}

              {(showCount || sel.charges > 0 || sel.tier > 0 || sel.depotId > 0 || isDepot) && (
                <div className="border-b border-border/50 px-2 pb-1.5 pt-1.5">
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Details</div>
                  <div className="flex flex-col gap-1">
                    {showCount &&
                      (isFluid || isSplash ? (
                        <PickRow
                          label="Fluid"
                          options={fluidOptions}
                          value={draft.subtype || '0'}
                          onChange={(v) => {
                            setField('subtype', v);
                            commitWith({ subtype: v });
                          }}
                        />
                      ) : (
                        <NumField
                          min={1}
                          max={255}
                          label="Count"
                          value={draft.subtype || '1'}
                          onChange={(v) => setField('subtype', v)}
                        />
                      ))}
                    {sel.charges > 0 && (
                      <NumField
                        max={65535}
                        label="Charges"
                        value={draft.charges || '0'}
                        onChange={(v) => setField('charges', v)}
                      />
                    )}
                    {sel.tier > 0 && (
                      <NumField max={255} label="Tier" value={draft.tier || '0'} onChange={(v) => setField('tier', v)} />
                    )}
                    {(sel.depotId > 0 || isDepot) &&
                      (towns.length > 0 ? (
                        <PickRow
                          label="Depot town"
                          options={depotOptions}
                          value={draft.depotId || '0'}
                          onChange={(v) => {
                            setField('depotId', v);
                            commitWith({ depotId: v });
                          }}
                        />
                      ) : (
                        <NumField
                          max={65535}
                          label="Depot ID"
                          value={draft.depotId || '0'}
                          onChange={(v) => setField('depotId', v)}
                        />
                      ))}
                  </div>
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
