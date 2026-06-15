import React from 'react';
import { Copy, Plus, Search, Trash2, MapPin, LocateFixed } from 'lucide-react';

import { Waypoint, MapWaypoints } from '~/domain/waypoint';
import { sortWaypoints, removeWaypoint, renameWaypoint } from '~/usecase/waypointEdits';

interface WaypointsListProps {
  waypoints: MapWaypoints | null;
  onGoto: (wp: Waypoint) => void;
  onCopyPosition: (wp: Waypoint) => void;
  onEdit: (next: MapWaypoints) => void;
  onAdd: () => void;
}

const WaypointsList = ({ waypoints, onGoto, onCopyPosition, onEdit, onAdd }: WaypointsListProps) => {
  const [query, setQuery] = React.useState('');
  const [editing, setEditing] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState('');

  const list = React.useMemo(() => {
    const all = sortWaypoints(waypoints?.list ?? []);
    const q = query.trim().toLowerCase();
    return q ? all.filter((w) => w.name.toLowerCase().includes(q)) : all;
  }, [waypoints, query]);

  const commitRename = (wp: Waypoint) => {
    if (waypoints && draft.trim() && draft.trim() !== wp.name) onEdit(renameWaypoint(waypoints, wp.name, draft));
    setEditing(null);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-shrink-0 items-center gap-1.5 border-b border-border/50 px-2 py-1.5">
        <Search className="h-3 w-3 text-muted-foreground" />
        <input
          type="text"
          value={query}
          placeholder="Search waypoints..."
          onChange={(e) => setQuery(e.target.value)}
          className="w-full bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
        />
        <button
          onClick={onAdd}
          title="Add waypoint at view center"
          className="rounded p-0.5 text-muted-foreground hover:bg-item-hover hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {list.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-muted-foreground">No waypoints. Click + to add one.</div>
        ) : (
          list.map((wp) => (
            <div
              key={wp.name}
              className="group flex items-center gap-1.5 px-2 py-1 text-xs hover:bg-accent"
              onDoubleClick={() => {
                setEditing(wp.name);
                setDraft(wp.name);
              }}
            >
              <MapPin className="h-3 w-3 flex-shrink-0 text-blue-400" />
              {editing === wp.name ? (
                <input
                  autoFocus
                  type="text"
                  value={draft}
                  onBlur={() => commitRename(wp)}
                  onChange={(e) => setDraft(e.target.value)}
                  className="min-w-0 flex-1 rounded border border-input bg-background px-1 text-xs outline-none focus:border-ring"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename(wp);
                    if (e.key === 'Escape') setEditing(null);
                  }}
                />
              ) : (
                <button
                  onClick={() => onGoto(wp)}
                  title={`${wp.x}, ${wp.y}, ${wp.z}`}
                  className="min-w-0 flex-1 truncate text-left text-foreground"
                >
                  {wp.name}
                </button>
              )}
              <span className="flex-shrink-0 font-mono text-[9px] text-muted-foreground">{wp.z}</span>
              <button
                title="Go to waypoint"
                onClick={() => onGoto(wp)}
                className="flex-shrink-0 rounded p-0.5 text-muted-foreground opacity-0 hover:bg-item-hover hover:text-primary group-hover:opacity-100"
              >
                <LocateFixed className="h-3 w-3" />
              </button>
              <button
                title="Copy position"
                onClick={() => onCopyPosition(wp)}
                className="flex-shrink-0 rounded p-0.5 text-muted-foreground opacity-0 hover:bg-item-hover hover:text-foreground group-hover:opacity-100"
              >
                <Copy className="h-3 w-3" />
              </button>
              <button
                title="Delete"
                onClick={() => waypoints && onEdit(removeWaypoint(waypoints, wp.name))}
                className="flex-shrink-0 rounded p-0.5 text-muted-foreground opacity-0 hover:bg-item-hover hover:text-destructive group-hover:opacity-100"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default WaypointsList;
