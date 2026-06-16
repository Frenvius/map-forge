import React from 'react';
import { ChevronRight } from 'lucide-react';

import { Position } from '~/domain/map';

import { HoverItem, ContextMenuState } from '../types';

interface TileContextMenuProps {
  menu: ContextMenuState;
  onCut: () => void;
  onCopy: () => void;
  onCopyPosition: (tile: Position) => void;
  onPaste: (tile: Position) => void;
  onDelete: () => void;
  onGoToDest: (dest: Position) => void;
  onCopyText: (text: string) => void;
  onSelectRaw: (item: HoverItem) => void;
  onSelectGround: (item: HoverItem) => void;
  onSelectHouse: (houseId: number) => void;
  onSpawnProperties: (center: Position) => void;
  onCreatureProperties: (pos: Position) => void;
  onSelectCreature: (pos: Position) => void;
  onWaypointProperties: (pos: Position) => void;
  onAddWaypoint: (pos: Position) => void;
  onItemProperties?: () => void;
}

interface ItemProps {
  label: React.ReactNode;
  shortcut?: string;
  disabled?: boolean;
  onClick?: () => void;
}

const Item = ({ label, shortcut, disabled, onClick }: ItemProps) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className="flex w-full items-center justify-between px-3 py-1.5 text-left hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
  >
    <span>{label}</span>
    {shortcut && <span className="ml-6 text-xs text-muted-foreground">{shortcut}</span>}
  </button>
);

const Separator = () => <div className="my-1 h-px bg-border" />;

const SubMenu = ({ label, children, openLeft }: { label: string; children: React.ReactNode; openLeft?: boolean }) => (
  <div className="group/sub relative">
    <button className="flex w-full items-center justify-between px-3 py-1.5 text-left hover:bg-accent">
      <span>{label}</span>
      <ChevronRight className="ml-6 h-3.5 w-3.5 text-muted-foreground" />
    </button>
    <div
      className={`invisible absolute top-0 min-w-[200px] rounded-md border border-border bg-popover py-1 shadow-island-lg group-hover/sub:visible ${
        openLeft ? 'right-full -mr-1' : 'left-full -ml-1'
      }`}
    >
      {children}
    </div>
  </div>
);

const TileContextMenu = ({
  menu,
  onCut,
  onCopy,
  onCopyPosition,
  onPaste,
  onDelete,
  onGoToDest,
  onCopyText,
  onSelectRaw,
  onSelectGround,
  onSelectHouse,
  onSpawnProperties,
  onCreatureProperties,
  onSelectCreature,
  onAddWaypoint,
  onItemProperties,
  onWaypointProperties
}: TileContextMenuProps) => {
  const { item, ground, dest, tile, spawn, creature, waypoint, houseId, hasSelection, canPaste } = menu;

  const ref = React.useRef<HTMLDivElement>(null);
  const [pos, setPos] = React.useState({ left: menu.clientX, top: menu.clientY });
  const [flipX, setFlipX] = React.useState(false);

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const margin = 4;
    const overflowX = menu.clientX + width > window.innerWidth - margin;
    const overflowY = menu.clientY + height > window.innerHeight - margin;
    setPos({
      left: overflowX ? Math.max(margin, menu.clientX - width) : menu.clientX,
      top: overflowY ? Math.max(margin, menu.clientY - height) : menu.clientY
    });
    setFlipX(overflowX);
  }, [menu.clientX, menu.clientY]);

  return (
    <div
      ref={ref}
      onMouseDown={(e) => e.stopPropagation()}
      style={{ left: pos.left, top: pos.top }}
      className="fixed z-50 min-w-[220px] rounded-md border border-border bg-popover py-1 text-sm text-popover-foreground shadow-island-lg"
    >
      {dest && <Item onClick={() => onGoToDest(dest)} label={`Go To Destination (${dest.x}, ${dest.y}, ${dest.z})`} />}
      {item && (
        <Item
          onClick={() => onSelectRaw(item)}
          label={
            <span>
              Select RAW
              {item.name && <span className="text-xs text-muted-foreground"> "{item.name}"</span>}
            </span>
          }
        />
      )}
      {ground && <Item label="Select Groundbrush" onClick={() => onSelectGround(ground)} />}
      {houseId != null && <Item label="Select House" onClick={() => onSelectHouse(houseId)} />}
      {creature && <Item label="Select Creature" onClick={() => onSelectCreature(creature)} />}

      <SubMenu label="Copy..." openLeft={flipX}>
        <Item label="Copy Position" disabled={!hasSelection} onClick={() => onCopyPosition(tile)} />
        {item && (
          <>
            <Item label="Copy Item Server Id" onClick={() => onCopyText(String(item.serverId))} />
            <Item label="Copy Item Client Id" onClick={() => onCopyText(String(item.clientId))} />
            {item.name && <Item label="Copy Item Name" onClick={() => onCopyText(item.name)} />}
          </>
        )}
      </SubMenu>

      <Separator />
      <Item label="Cut" onClick={onCut} shortcut="Ctrl+X" disabled={!hasSelection} />
      <Item label="Copy" onClick={onCopy} shortcut="Ctrl+C" disabled={!hasSelection} />
      <Item label="Paste" shortcut="Ctrl+V" disabled={!canPaste} onClick={() => onPaste(tile)} />
      <Item label="Delete" shortcut="Del" onClick={onDelete} disabled={!hasSelection} />

      <Separator />
      <Item label="Add Waypoint Here" onClick={() => onAddWaypoint(tile)} />
      {spawn ? (
        <Item label="Spawn Properties..." onClick={() => onSpawnProperties(spawn)} />
      ) : creature ? (
        <Item label="Creature Properties..." onClick={() => onCreatureProperties(creature)} />
      ) : waypoint ? (
        <Item label="Waypoint Properties..." onClick={() => onWaypointProperties(waypoint)} />
      ) : (
        <Item disabled={!item} label="Properties" onClick={onItemProperties} />
      )}
    </div>
  );
};

export default TileContextMenu;
