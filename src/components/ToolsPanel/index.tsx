import { Cat, Brush, MapPin, Eraser, Target, Crosshair, SquarePlus, MousePointer2, GripHorizontal } from 'lucide-react';

import { cn } from '~/usecase/classNames';
import { TOOLS, ToolId } from '~/domain/tools';
import { DragHandleProps } from '~/components/Dock/DockablePanel';

const ICONS: Record<ToolId, typeof Eraser> = {
  select: MousePointer2,
  brush: Brush,
  eraser: Eraser,
  spawn: Crosshair
};

interface ToolsPanelProps {
  automagic: boolean;
  activeTool: ToolId;
  showSpawns: boolean;
  showCreatures: boolean;
  autoCreateSpawn: boolean;
  showWaypoints: boolean;
  dragHandle?: DragHandleProps;
  onSelectTool: (tool: ToolId) => void;
  onToggleSpawns: () => void;
  onToggleAutomagic: () => void;
  onToggleCreatures: () => void;
  onToggleAutoSpawn: () => void;
  onToggleWaypoints: () => void;
}

const ToolsPanel = ({
  automagic,
  activeTool,
  showSpawns,
  showCreatures,
  autoCreateSpawn,
  showWaypoints,
  dragHandle,
  onSelectTool,
  onToggleSpawns,
  onToggleAutomagic,
  onToggleCreatures,
  onToggleAutoSpawn,
  onToggleWaypoints
}: ToolsPanelProps) => {
  return (
    <div className="flex h-full flex-col items-center gap-0.5 overflow-y-auto rounded-lg bg-card p-1 shadow-island">
      <div
        ref={dragHandle?.ref}
        {...dragHandle?.attributes}
        {...dragHandle?.listeners}
        className={cn('flex w-full justify-center py-1 text-muted-foreground/60', dragHandle?.className)}
      >
        <GripHorizontal className="h-3.5 w-3.5" />
      </div>

      {TOOLS.map((tool) => {
        const Icon = ICONS[tool.id];
        const selected = activeTool === tool.id;
        return (
          <button
            key={tool.id}
            title={tool.label}
            onClick={() => onSelectTool(tool.id)}
            className={cn(
              'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded transition-colors',
              selected ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-item-hover hover:text-foreground'
            )}
          >
            <Icon className="h-[18px] w-[18px]" />
          </button>
        );
      })}

      <div className="mt-auto flex w-full flex-col items-center gap-0.5 pt-1">
        <div className="my-1 h-px w-5 bg-border/60" />
        <button
          onClick={onToggleCreatures}
          title="Show creatures and NPCs"
          className={cn(
            'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded transition-colors',
            showCreatures ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-item-hover hover:text-foreground'
          )}
        >
          <Cat className="h-[18px] w-[18px]" />
        </button>
        <button
          onClick={onToggleSpawns}
          title="Show spawn areas"
          className={cn(
            'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded transition-colors',
            showSpawns ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-item-hover hover:text-foreground'
          )}
        >
          <Target className="h-[18px] w-[18px]" />
        </button>
        <button
          onClick={onToggleAutoSpawn}
          title="Auto-create spawn when placing a creature"
          className={cn(
            'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded transition-colors',
            autoCreateSpawn ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-item-hover hover:text-foreground'
          )}
        >
          <SquarePlus className="h-[18px] w-[18px]" />
        </button>
        <button
          title="Show waypoints"
          onClick={onToggleWaypoints}
          className={cn(
            'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded transition-colors',
            showWaypoints ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-item-hover hover:text-foreground'
          )}
        >
          <MapPin className="h-[18px] w-[18px]" />
        </button>
        <button
          onClick={onToggleAutomagic}
          title="Automatic borders - auto-border, walls, tables, carpets, mountains"
          className={cn(
            'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded text-sm font-semibold transition-colors',
            automagic ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-item-hover hover:text-foreground'
          )}
        >
          A
        </button>
      </div>
    </div>
  );
};

export default ToolsPanel;
