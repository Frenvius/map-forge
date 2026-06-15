import { ComponentType } from 'react';
import { Brush, Eraser, Crosshair, MousePointer2, GripHorizontal } from 'lucide-react';
import {
  IconFlag3,
  IconSpider,
  IconSwords,
  IconLogout,
  IconSwordOff,
  IconViewfinder,
  IconShieldHalf,
  IconScanLetterA
} from '@tabler/icons-react';

import { cn } from '~/usecase/classNames';
import { TOOLS, ToolId } from '~/domain/tools';
import { useTool } from '~/usecase/context/ToolContext';
import { DragHandleProps } from '~/components/Dock/DockablePanel';
import { useEditorSettings } from '~/usecase/context/EditorSettingsContext';

const ICONS: Record<ToolId, ComponentType<{ className?: string }>> = {
  select: MousePointer2,
  brush: Brush,
  eraser: Eraser,
  spawn: Crosshair,
  zone_pz: IconShieldHalf,
  zone_nopvp: IconSwordOff,
  zone_nologout: IconLogout,
  zone_pvp: IconSwords
};

interface ToolsPanelProps {
  dragHandle?: DragHandleProps;
}

const ToolsPanel = ({ dragHandle }: ToolsPanelProps) => {
  const { activeTool, setActiveTool } = useTool();
  const { automagic, showSpawns, showCreatures, showWaypoints, toggleSpawns, toggleAutomagic, toggleCreatures, toggleWaypoints } =
    useEditorSettings();

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
          <div key={tool.id} className="flex w-full flex-col items-center">
            {tool.id === 'zone_pz' && <div className="my-1 h-px w-5 bg-border/60" />}
            <button
              title={tool.label}
              onClick={() => setActiveTool(tool.id)}
              className={cn(
                'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded transition-colors',
                selected ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-item-hover hover:text-foreground'
              )}
            >
              <Icon className="h-[18px] w-[18px]" />
            </button>
          </div>
        );
      })}

      <div className="mt-auto flex w-full flex-col items-center gap-0.5 pt-1">
        <div className="my-1 h-px w-5 bg-border/60" />
        <button
          onClick={toggleCreatures}
          title="Show creatures and NPCs"
          className={cn(
            'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded transition-colors',
            showCreatures ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-item-hover hover:text-foreground'
          )}
        >
          <IconSpider className="h-[18px] w-[18px]" />
        </button>
        <button
          onClick={toggleSpawns}
          title="Show spawn areas"
          className={cn(
            'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded transition-colors',
            showSpawns ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-item-hover hover:text-foreground'
          )}
        >
          <IconViewfinder className="h-[18px] w-[18px]" />
        </button>
        <button
          title="Show waypoints"
          onClick={toggleWaypoints}
          className={cn(
            'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded transition-colors',
            showWaypoints ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-item-hover hover:text-foreground'
          )}
        >
          <IconFlag3 className="h-[18px] w-[18px]" />
        </button>
        <button
          onClick={toggleAutomagic}
          title="Automatic borders - auto-border, walls, tables, carpets, mountains"
          className={cn(
            'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded transition-colors',
            automagic ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-item-hover hover:text-foreground'
          )}
        >
          <IconScanLetterA className="h-[18px] w-[18px]" />
        </button>
      </div>
    </div>
  );
};

export default ToolsPanel;
