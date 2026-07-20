import React from 'react';
import { X, LocateFixed } from 'lucide-react';

import { cn } from '~/usecase/classNames';
import { Hint } from '~/components/commons/ui/tooltip';
import { IdMarker, listIdMarkers } from '~/adapter/map';
import { DragHandleProps } from '~/components/Dock/DockablePanel';

interface IdMarkersPanelProps {
  mapId: number | null;
  version?: number;
  onClose?: () => void;
  dragHandle?: DragHandleProps;
  onGoto: (x: number, y: number, z: number) => void;
}

const IdMarkersPanel = ({ mapId, version, onGoto, dragHandle, onClose }: IdMarkersPanelProps) => {
  const [markers, setMarkers] = React.useState<IdMarker[]>([]);
  const [query, setQuery] = React.useState('');

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
  }, [mapId, version]);

  const list = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return markers;
    return markers.filter(
      (m) =>
        String(m.actionId).includes(q) || String(m.uniqueId).includes(q) || `${m.x},${m.y},${m.z}`.includes(q.replace(/\s/g, ''))
    );
  }, [markers, query]);

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
        <h2 className="text-xs font-semibold uppercase tracking-wide text-foreground">Action / Unique IDs</h2>
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

      <div className="flex-shrink-0 border-b border-border/50 p-2">
        <input
          value={query}
          placeholder="Search id or x,y,z..."
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded border border-border/50 bg-secondary/50 px-2 py-1 text-xs text-foreground outline-none focus:border-ring"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto text-xs">
        <div className="grid grid-cols-[4rem_4rem_1fr_1.75rem] gap-1 border-b border-border/50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          <span>Action</span>
          <span>Unique</span>
          <span>Position</span>
          <span />
        </div>
        {list.length === 0 ? (
          <div className="p-3 text-center text-muted-foreground">No matching ids</div>
        ) : (
          list.map((m, i) => (
            <div
              key={`${m.z}-${m.x}-${m.y}-${m.actionId}-${m.uniqueId}-${i}`}
              className="group grid grid-cols-[4rem_4rem_1fr_1.75rem] items-center gap-1 px-2 py-0.5 hover:bg-accent"
            >
              <span className="font-mono text-muted-foreground">{m.actionId || '-'}</span>
              <span className="font-mono text-muted-foreground">{m.uniqueId || '-'}</span>
              <span className="font-mono text-foreground">
                {m.x}, {m.y}, {m.z}
              </span>
              <Hint label="Teleport here">
                <button
                  onClick={() => onGoto(m.x, m.y, m.z)}
                  className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-item-hover hover:text-primary group-hover:opacity-100"
                >
                  <LocateFixed className="h-3.5 w-3.5" />
                </button>
              </Hint>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default IdMarkersPanel;
