import React from 'react';
import { Layers, ZoomIn, ZoomOut } from 'lucide-react';

import { stepZoom } from '~/usecase/zoom';
import { HoverInfo, HoverItem } from '~/components/MapCanvas/types';
import { useEditorSettings } from '~/usecase/context/EditorSettingsContext';
import { Select, SelectItem, SelectContent, SelectTrigger } from '~/components/commons/ui/select';

const MIN_FLOOR = 0;
const MAX_FLOOR = 15;
const FLOORS = Array.from({ length: MAX_FLOOR - MIN_FLOOR + 1 }, (_, i) => MIN_FLOOR + i);

export interface StatusBarApi {
  setHover: (hover: HoverInfo | null) => void;
  setSelectedItem: (item: HoverItem | null) => void;
  flash: (message: string) => void;
}

const FLASH_DURATION = 2500;

interface StatusBarProps {
  status: string;
  floorZ: number;
  zoom: number;
  minZoom: number;
  maxZoom: number;
  apiRef: React.MutableRefObject<StatusBarApi | null>;
  onFloorChange: (z: number) => void;
  onZoomChange: (zoom: number) => void;
}

const TileDescription = ({ hover }: { hover: HoverInfo | null }) => {
  if (!hover) return null;
  if (hover.box)
    return (
      <span className="truncate">
        Selecting <span className="text-foreground">{hover.box.w}</span> x <span className="text-foreground">{hover.box.h}</span> (
        <span className="text-foreground">{hover.box.w * hover.box.h}</span> tiles)
      </span>
    );
  if (!hover.item) return <span className="text-muted-foreground/70">{hover.hasTile ? 'Empty tile' : 'Nothing'}</span>;

  const { name, serverId, clientId, count } = hover.item;
  return (
    <span className="truncate">
      Item{name ? ` "${name}"` : ''} id:<span className="text-foreground">{serverId}</span> cid:
      <span className="text-foreground">{clientId}</span>
      {count > 1 ? <span className="text-muted-foreground/70"> ({count} items)</span> : null}
    </span>
  );
};

const SelectedDescription = ({ item }: { item: HoverItem }) => {
  const { name, serverId, clientId } = item;
  return (
    <span className="truncate font-mono">
      Selected{name ? ` "${name}"` : ''} id:<span className="text-foreground">{serverId}</span> cid:
      <span className="text-foreground">{clientId}</span>
    </span>
  );
};

const StatusBar = ({ status, apiRef, floorZ, zoom, onFloorChange, onZoomChange }: StatusBarProps) => {
  const { defaultFloor: SEA_LEVEL } = useEditorSettings();
  const [hover, setHover] = React.useState<HoverInfo | null>(null);
  const [selectedItem, setSelectedItem] = React.useState<HoverItem | null>(null);
  const [flash, setFlash] = React.useState<string | null>(null);
  const flashTimer = React.useRef(0);

  const showFlash = React.useCallback((message: string) => {
    setFlash(message);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), FLASH_DURATION);
  }, []);

  React.useImperativeHandle(apiRef, () => ({ setHover, setSelectedItem, flash: showFlash }), [showFlash]);

  React.useEffect(() => () => window.clearTimeout(flashTimer.current), []);

  return (
    <div className="flex h-8 flex-shrink-0 items-stretch border-t border-border/50 bg-toolbar-bg text-xs text-muted-foreground">
      <div className="flex min-w-0 flex-1 items-center px-3">
        {flash ? (
          <span className="truncate text-foreground">{flash}</span>
        ) : selectedItem ? (
          <SelectedDescription item={selectedItem} />
        ) : (
          <span className="truncate">{status}</span>
        )}
      </div>

      <div className="w-px self-stretch bg-border" />

      <div className="flex min-w-0 flex-1 items-center px-3 font-mono">
        <TileDescription hover={hover} />
      </div>

      <div className="w-px self-stretch bg-border" />

      <div className="flex w-44 flex-shrink-0 items-center px-3 font-mono tabular-nums">
        {hover ? (
          <span>
            x: <span className="text-foreground">{hover.x}</span> y:<span className="text-foreground">{hover.y}</span> z:
            <span className="text-foreground">{hover.z}</span>
          </span>
        ) : null}
      </div>

      <div className="w-px self-stretch bg-border" />

      <div
        className="flex flex-shrink-0 items-center gap-2 px-3"
        onWheel={(e) => {
          const delta = e.deltaY < 0 ? -1 : 1;
          const next = Math.min(MAX_FLOOR, Math.max(MIN_FLOOR, floorZ + delta));
          if (next !== floorZ) onFloorChange(next);
        }}
      >
        <Layers className="h-3.5 w-3.5" />
        <Select value={String(floorZ)} onValueChange={(v) => onFloorChange(Number(v))}>
          <SelectTrigger className="h-6 w-28 px-2 py-0 tabular-nums">
            <span>
              Floor {floorZ}
              {floorZ === SEA_LEVEL ? <span className="ml-1 text-muted-foreground/70">(sea)</span> : null}
            </span>
          </SelectTrigger>
          <SelectContent className="max-h-none">
            {FLOORS.map((z) => (
              <SelectItem key={z} value={String(z)}>
                Floor {z}
                {z === SEA_LEVEL ? <span className="ml-1.5 text-muted-foreground/70">(sea level)</span> : null}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="mx-1 h-4 w-px bg-border" />

        <button
          onClick={() => onZoomChange(stepZoom(zoom, -1))}
          className="flex h-5 w-5 items-center justify-center rounded hover:bg-accent hover:text-foreground"
        >
          <ZoomOut className="h-3.5 w-3.5" />
        </button>
        <span className="w-10 text-center tabular-nums text-foreground">{Math.round(zoom * 100)}%</span>
        <button
          onClick={() => onZoomChange(stepZoom(zoom, 1))}
          className="flex h-5 w-5 items-center justify-center rounded hover:bg-accent hover:text-foreground"
        >
          <ZoomIn className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
};

export default StatusBar;
