import React from 'react';
import { X, Trash2, Loader2, ChevronUp, ChevronDown, LocateFixed, ChevronsUpDown } from 'lucide-react';

import { Thing } from '~/domain/thing';
import { cn } from '~/usecase/classNames';
import { Hint } from '~/components/commons/ui/tooltip';
import { DragHandleProps } from '~/components/Dock/DockablePanel';
import { IdMarker, ItemMarker, removeItemAt, clearMarkerAt, listIdMarkers, listItemsWithClientIds } from '~/adapter/map';

type TabId = 'action' | 'unique' | 'container';
type SortKey = 'id' | 'pos' | 'items';

interface Row {
  id: number;
  x: number;
  y: number;
  z: number;
  clientId?: number;
  hasContents?: boolean;
}

interface IdMarkersPanelProps {
  mapId: number | null;
  items: Map<number, Thing> | null;
  version?: number;
  onClose?: () => void;
  dragHandle?: DragHandleProps;
  onGoto: (x: number, y: number, z: number, clientId?: number) => void;
  onEdited: (tagged?: [number, number][]) => void;
}

const TABS: { id: TabId; label: string; column: string }[] = [
  { id: 'action', label: 'Actions', column: 'Action' },
  { id: 'unique', label: 'Uniques', column: 'Unique' },
  { id: 'container', label: 'Containers', column: 'Item' }
];

const ROW_H = 24;
const OVERSCAN = 8;

const SortHeader = ({ label, active, dir, onClick }: { label: string; active: boolean; dir?: 1 | -1; onClick: () => void }) => {
  const Icon = !active ? ChevronsUpDown : dir === 1 ? ChevronUp : ChevronDown;
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex min-w-0 items-center justify-center overflow-hidden px-2 py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors hover:text-foreground',
        active && 'text-foreground'
      )}
    >
      <span className="relative">
        {label}
        <Icon className={cn('absolute left-full top-1/2 ml-0.5 h-3 w-3 -translate-y-1/2', !active && 'opacity-40')} />
      </span>
    </button>
  );
};

const isContainer = (thing: Thing) => {
  const flag = (thing as unknown as Record<string, unknown>).isContainer ?? thing.attrs?.isContainer;
  return Boolean(flag);
};

const IdMarkersPanel = ({ mapId, items, version, onGoto, onEdited, dragHandle, onClose }: IdMarkersPanelProps) => {
  const [tab, setTab] = React.useState<TabId>('action');
  const [markers, setMarkers] = React.useState<IdMarker[]>([]);
  const [containers, setContainers] = React.useState<ItemMarker[]>([]);
  const [query, setQuery] = React.useState('');
  const [refresh, setRefresh] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [scrollTop, setScrollTop] = React.useState(0);
  const [viewH, setViewH] = React.useState(320);
  const [sort, setSort] = React.useState<{ key: SortKey; dir: 1 | -1 } | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (mapId === null) {
      setMarkers([]);
      return;
    }
    let cancelled = false;
    void listIdMarkers(mapId).then((list) => {
      if (!cancelled) setMarkers(list);
    });
    return () => {
      cancelled = true;
    };
  }, [mapId, version, refresh]);

  React.useEffect(() => {
    if (mapId === null || !items || tab !== 'container') {
      if (mapId === null) setContainers([]);
      return;
    }
    const ids: number[] = [];
    for (const [id, thing] of items) if (isContainer(thing)) ids.push(id);
    let cancelled = false;
    setLoading(true);
    void listItemsWithClientIds(mapId, ids)
      .then((list) => {
        if (!cancelled) setContainers(list);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mapId, items, version, refresh, tab]);

  const rows = React.useMemo<Row[]>(() => {
    if (tab === 'container')
      return containers.map((c) => ({
        id: c.serverId,
        x: c.x,
        y: c.y,
        z: c.z,
        clientId: c.clientId,
        hasContents: c.hasContents
      }));
    const pick = tab === 'action' ? (m: IdMarker) => m.actionId : (m: IdMarker) => m.uniqueId;
    return markers.filter((m) => pick(m) > 0).map((m) => ({ id: pick(m), x: m.x, y: m.y, z: m.z }));
  }, [tab, markers, containers]);

  const list = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => String(r.id).includes(q) || `${r.x},${r.y},${r.z}`.includes(q.replace(/\s/g, '')));
  }, [rows, query]);

  const deleteRow = React.useCallback(
    async (r: Row) => {
      if (mapId === null) return;
      if (tab === 'container') {
        const touched = await removeItemAt(mapId, r.z, r.x, r.y, r.clientId!);
        onEdited(touched.map((k) => [k, r.z]));
      } else {
        await clearMarkerAt(mapId, r.x, r.y, r.z, tab === 'action');
        onEdited();
      }
      setRefresh((v) => v + 1);
    },
    [mapId, tab, onEdited]
  );

  const column = TABS.find((t) => t.id === tab)!.column;
  const showContents = tab === 'container';

  const sorted = React.useMemo(() => {
    if (!sort) return list;
    const cmp: Record<SortKey, (a: Row, b: Row) => number> = {
      id: (a, b) => a.id - b.id,
      pos: (a, b) => a.z - b.z || a.x - b.x || a.y - b.y,
      items: (a, b) => Number(!!a.hasContents) - Number(!!b.hasContents)
    };
    return [...list].sort((a, b) => cmp[sort.key](a, b) * sort.dir);
  }, [list, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((prev) => (prev?.key === key ? { key, dir: prev.dir === 1 ? -1 : 1 } : { key, dir: 1 }));

  React.useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setScrollTop(0);
  }, [tab, query, refresh, sort]);

  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el);
    setViewH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const { idW, posW } = React.useMemo(() => {
    let iw = Math.max(column.length, 3);
    let pw = 'POSITION'.length;
    for (const r of list) {
      iw = Math.max(iw, String(r.id).length);
      pw = Math.max(pw, `${r.x}, ${r.y}, ${r.z}`.length);
    }
    return { idW: iw, posW: pw };
  }, [list, column]);

  const idCol = `max(${idW + 2}ch, ${column.length + 4}ch)`;
  const posCol = `max(${posW + 2}ch, 12ch)`;
  const template = showContents
    ? `${idCol} ${posCol} minmax(0,9ch) minmax(0,1fr) 2.75rem`
    : `${idCol} ${posCol} minmax(0,1fr) 2.75rem`;
  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const end = Math.min(sorted.length, Math.ceil((scrollTop + viewH) / ROW_H) + OVERSCAN);
  const visible = sorted.slice(start, end);
  const busy = showContents && loading;

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
        <h2 className="text-xs font-semibold uppercase tracking-wide text-foreground">Map IDs</h2>
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

      <div className="flex flex-shrink-0 items-center gap-1 border-b border-border/50 px-2 pt-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'rounded-t px-2 py-1 text-[11px] font-medium transition-colors',
              tab === t.id ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-shrink-0 border-b border-border/50 p-2">
        <input
          value={query}
          placeholder="Search id or x,y,z..."
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded border border-border/50 bg-secondary/50 px-2 py-1 text-xs text-foreground outline-none focus:border-ring"
        />
      </div>

      <div
        style={{ gridTemplateColumns: template }}
        className="grid flex-shrink-0 items-center border-b border-border/50 bg-card font-mono text-xs text-muted-foreground"
      >
        <SortHeader label={column} dir={sort?.dir} active={sort?.key === 'id'} onClick={() => toggleSort('id')} />
        <SortHeader dir={sort?.dir} label="Position" active={sort?.key === 'pos'} onClick={() => toggleSort('pos')} />
        {showContents && (
          <SortHeader label="Items" dir={sort?.dir} active={sort?.key === 'items'} onClick={() => toggleSort('items')} />
        )}
        <span />
        <span className="py-1 pr-2" />
      </div>

      <div
        ref={scrollRef}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden font-mono text-xs"
      >
        {busy ? (
          <div className="p-4 text-center text-muted-foreground">
            <Loader2 className="mx-auto h-4 w-4 animate-spin" />
          </div>
        ) : sorted.length === 0 ? (
          <div className="p-3 text-center text-muted-foreground">No matching entries</div>
        ) : (
          <div style={{ height: sorted.length * ROW_H, position: 'relative' }}>
            {visible.map((r, i) => {
              const idx = start + i;
              return (
                <div
                  key={`${r.z}-${r.x}-${r.y}-${r.id}-${idx}`}
                  className="group grid items-center hover:bg-accent"
                  onDoubleClick={() => onGoto(r.x, r.y, r.z, showContents ? r.clientId : undefined)}
                  style={{
                    gridTemplateColumns: template,
                    position: 'absolute',
                    top: idx * ROW_H,
                    left: 0,
                    right: 0,
                    height: ROW_H
                  }}
                >
                  <span className="whitespace-nowrap px-2 text-center font-mono text-muted-foreground">{r.id}</span>
                  <span className="whitespace-nowrap px-2 text-center font-mono text-foreground">
                    {r.x}, {r.y}, {r.z}
                  </span>
                  {showContents && (
                    <span
                      className={cn(
                        'overflow-hidden text-ellipsis whitespace-nowrap px-2 text-center font-mono',
                        r.hasContents ? 'text-primary' : 'text-muted-foreground/40'
                      )}
                    >
                      {r.hasContents ? 'Yes' : 'No'}
                    </span>
                  )}
                  <span />
                  <span className="flex items-center justify-end gap-0.5 pl-1 pr-2">
                    <Hint label="Teleport here">
                      <button
                        onClick={() => onGoto(r.x, r.y, r.z, showContents ? r.clientId : undefined)}
                        className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-item-hover hover:text-primary group-hover:opacity-100"
                      >
                        <LocateFixed className="h-3.5 w-3.5" />
                      </button>
                    </Hint>
                    <Hint label={showContents ? 'Delete item' : `Clear ${column.toLowerCase()} id`}>
                      <button
                        onClick={() => void deleteRow(r)}
                        className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-item-hover hover:text-destructive group-hover:opacity-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </Hint>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default IdMarkersPanel;
