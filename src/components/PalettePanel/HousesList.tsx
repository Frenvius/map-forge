import React from 'react';
import { Plus, Home, Search, Trash2, Pencil, DoorOpen } from 'lucide-react';

import { Town } from '~/domain/map';
import { cn } from '~/usecase/classNames';
import { useTool } from '~/usecase/context/ToolContext';
import { House, MapHouses, sortHouses, nextHouseId } from '~/domain/house';

import EditHouseDialog from './EditHouseDialog';

interface HousesListProps {
  houses: MapHouses | null;
  towns: Town[];
  onEdit: (next: MapHouses) => void;
  onGoto: (house: House) => void;
}

const HousesList = ({ houses, towns, onEdit, onGoto }: HousesListProps) => {
  const { activeTool, activeHouseId, setActiveTool, setActiveHouse } = useTool();
  const [query, setQuery] = React.useState('');
  const [townFilter, setTownFilter] = React.useState<string>('all');
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [dialogHouse, setDialogHouse] = React.useState<House | null>(null);

  const list = React.useMemo(() => {
    const all = sortHouses(houses?.list ?? []);
    const q = query.trim().toLowerCase();
    return all.filter((h) => {
      if (townFilter === 'all') {
        // no town constraint
      } else if (townFilter === 'none') {
        if (towns.some((t) => t.id === h.townId)) return false;
      } else if (h.townId !== Number(townFilter)) {
        return false;
      }
      if (!q) return true;
      return h.name.toLowerCase().includes(q) || String(h.id).includes(q);
    });
  }, [houses, towns, query, townFilter]);

  const selectHouse = (id: number) => {
    setActiveHouse(id);
    if (activeTool !== 'house' && activeTool !== 'house_exit') setActiveTool('house');
  };

  const addHouse = () => {
    const wps = houses ?? { list: [] };
    const id = nextHouseId(wps);
    const townId = townFilter !== 'all' && townFilter !== 'none' ? Number(townFilter) : (towns[0]?.id ?? 0);
    const house: House = { id, name: `Unnamed House #${id}`, townId, rent: 0, guildhall: false, entryX: 0, entryY: 0, entryZ: 7 };
    onEdit({ list: [...wps.list, house] });
    setActiveHouse(id);
    setDialogHouse(house);
    setDialogOpen(true);
  };

  const editHouse = (house: House) => {
    setDialogHouse(house);
    setDialogOpen(true);
  };

  const removeHouse = (id: number) => {
    if (!houses) return;
    onEdit({ list: houses.list.filter((h) => h.id !== id) });
    if (activeHouseId === id) setActiveHouse(null);
  };

  const saveHouse = (next: House) => {
    if (!houses) return;
    onEdit({ list: houses.list.map((h) => (h.id === next.id ? next : h)) });
  };

  const modeBtn = (tool: 'house' | 'house_exit', label: string, Icon: typeof Home) => (
    <button
      onClick={() => setActiveTool(tool)}
      className={cn(
        'flex flex-1 items-center justify-center gap-1.5 rounded border px-2 py-1 text-xs transition-colors',
        activeTool === tool
          ? 'border-primary bg-primary/15 text-foreground'
          : 'border-border/50 text-muted-foreground hover:bg-item-hover'
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-shrink-0 gap-1.5 border-b border-border/50 p-2">
        {modeBtn('house', 'House tiles', Home)}
        {modeBtn('house_exit', 'Select Exit', DoorOpen)}
      </div>

      <div className="flex flex-shrink-0 flex-col gap-1.5 border-b border-border/50 p-2">
        <select
          value={townFilter}
          onChange={(e) => setTownFilter(e.target.value)}
          className="h-7 rounded border border-input bg-input px-2 text-xs text-foreground outline-none focus:border-ring"
        >
          <option value="all">All Towns</option>
          {towns.map((t) => (
            <option key={t.id} value={String(t.id)}>
              {t.name}
            </option>
          ))}
          <option value="none">No Town</option>
        </select>
        <div className="flex items-center gap-1.5">
          <Search className="h-3 w-3 text-muted-foreground" />
          <input
            type="text"
            value={query}
            placeholder="Search houses..."
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
          />
          <button
            title="Add house"
            onClick={addHouse}
            className="rounded p-0.5 text-muted-foreground hover:bg-item-hover hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {list.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-muted-foreground">No houses. Click + to add one.</div>
        ) : (
          list.map((h) => (
            <div
              key={h.id}
              onDoubleClick={() => onGoto(h)}
              onClick={() => selectHouse(h.id)}
              className={cn(
                'group flex cursor-pointer items-center gap-1.5 px-2 py-1 text-xs',
                activeHouseId === h.id ? 'bg-primary/20 text-foreground' : 'hover:bg-accent'
              )}
            >
              <Home className={cn('h-3 w-3 flex-shrink-0', h.guildhall ? 'text-amber-400' : 'text-muted-foreground')} />
              <span className="w-8 flex-shrink-0 font-mono text-[9px] text-muted-foreground">{h.id}</span>
              <span title={`${h.name} (rent ${h.rent})`} className="min-w-0 flex-1 truncate text-foreground">
                {h.name}
              </span>
              <button
                title="Edit house"
                onClick={(e) => {
                  e.stopPropagation();
                  editHouse(h);
                }}
                className="flex-shrink-0 rounded p-0.5 text-muted-foreground opacity-0 hover:bg-item-hover hover:text-foreground group-hover:opacity-100"
              >
                <Pencil className="h-3 w-3" />
              </button>
              <button
                title="Remove house"
                onClick={(e) => {
                  e.stopPropagation();
                  removeHouse(h.id);
                }}
                className="flex-shrink-0 rounded p-0.5 text-muted-foreground opacity-0 hover:bg-item-hover hover:text-destructive group-hover:opacity-100"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))
        )}
      </div>

      <EditHouseDialog towns={towns} open={dialogOpen} onSave={saveHouse} house={dialogHouse} onOpenChange={setDialogOpen} />
    </div>
  );
};

export default HousesList;
