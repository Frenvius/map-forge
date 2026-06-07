import { Position } from '~/domain/map';

import { HoverItem, ContextMenuState } from '../types';

interface TileContextMenuProps {
  menu: ContextMenuState;
  onSelectRaw: (item: HoverItem) => void;
  onGoToDest: (dest: Position) => void;
  onGoToPosition: (tile: Position) => void;
}

const TileContextMenu = ({ menu, onSelectRaw, onGoToDest, onGoToPosition }: TileContextMenuProps) => (
  <div
    onMouseDown={(e) => e.stopPropagation()}
    style={{ left: menu.clientX, top: menu.clientY }}
    className="fixed z-50 min-w-[200px] overflow-hidden rounded-md border border-border bg-popover py-1 text-sm text-popover-foreground shadow-island-lg"
  >
    {menu.item && (
      <>
        <button
          onClick={() => onSelectRaw(menu.item!)}
          className="flex w-full items-center px-3 py-1.5 text-left hover:bg-accent"
        >
          Select RAW{menu.item.name ? ` "${menu.item.name}"` : ''}
        </button>
        <div className="my-1 h-px bg-border" />
      </>
    )}
    {menu.dest ? (
      <button onClick={() => onGoToDest(menu.dest!)} className="flex w-full items-center px-3 py-1.5 text-left hover:bg-accent">
        Go to destination ({menu.dest.x}, {menu.dest.y}, {menu.dest.z})
      </button>
    ) : (
      <div className="px-3 py-1.5 text-muted-foreground">No portal here</div>
    )}
    <div className="my-1 h-px bg-border" />
    <button onClick={() => onGoToPosition(menu.tile)} className="flex w-full items-center px-3 py-1.5 text-left hover:bg-accent">
      Go to position...
    </button>
    <div className="px-3 py-1 text-xs text-muted-foreground">
      Here: {menu.tile.x}, {menu.tile.y}, {menu.tile.z}
    </div>
  </div>
);

export default TileContextMenu;
