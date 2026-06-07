import { Brush, Eraser, MousePointer2, GripHorizontal } from 'lucide-react';

import { cn } from '~/usecase/classNames';
import { TOOLS, ToolId } from '~/domain/tools';
import { DragHandleProps } from '~/components/Dock/DockablePanel';

const ICONS: Record<ToolId, typeof Eraser> = {
  select: MousePointer2,
  brush: Brush,
  eraser: Eraser
};

interface ToolsPanelProps {
  activeTool: ToolId;
  dragHandle?: DragHandleProps;
  onSelectTool: (tool: ToolId) => void;
}

const ToolsPanel = ({ activeTool, dragHandle, onSelectTool }: ToolsPanelProps) => {
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
    </div>
  );
};

export default ToolsPanel;
