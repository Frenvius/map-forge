import React from 'react';
import { DndContext, DragOverlay, pointerWithin } from '@dnd-kit/core';

import { cornerOf, floatRectOf } from '~/usecase/dock';
import CornerPanel from '~/components/Dock/CornerPanel';
import { DockApi } from '~/usecase/hooks/Workspace/useDock';
import FloatingPanel from '~/components/Dock/FloatingPanel';
import { DragHandleProps } from '~/components/Dock/DockablePanel';
import { PanelId, panelMeta, DEFAULT_MINIMAP_SIZE } from '~/domain/dock';

import DockSide from './DockSide';

interface WorkspaceProps {
  dock: DockApi;
  tabs: React.ReactNode;
  children: React.ReactNode;
  progress: { value: number; label: string } | null;
  renderPanel: (id: PanelId, handle?: DragHandleProps) => React.ReactNode;
}

const Workspace = ({ dock, tabs, children, progress, renderPanel }: WorkspaceProps) => {
  const renderCornerPanel = (id: PanelId) => {
    const corner = cornerOf(dock.layout, id);
    if (!corner) return null;
    return (
      <CornerPanel
        key={id}
        corner={corner}
        meta={panelMeta(id)}
        guarded={dock.guard}
        onResizeEnd={() => dock.setResizing(false)}
        onResizeStart={() => dock.setResizing(true)}
        width={dock.layout.width[id] ?? DEFAULT_MINIMAP_SIZE}
        height={dock.layout.height[id] ?? DEFAULT_MINIMAP_SIZE}
        onResize={(side, dx, dy) => dock.resizeCornerPanel(id, corner, side, dx, dy)}
      >
        {(handle) => renderPanel(id, handle)}
      </CornerPanel>
    );
  };

  const renderFloatingPanel = (id: PanelId) => {
    const rect = floatRectOf(dock.layout, id);
    if (!rect) return null;
    return (
      <FloatingPanel
        id={id}
        key={id}
        rect={rect}
        meta={panelMeta(id)}
        guarded={dock.guard}
        onResizeEnd={() => dock.setResizing(false)}
        onResizeStart={() => dock.setResizing(true)}
        onResize={(side, dx, dy) => dock.resizeFloatPanel(id, side, dx, dy)}
      >
        {(handle) => renderPanel(id, handle)}
      </FloatingPanel>
    );
  };

  return (
    <DndContext
      sensors={dock.sensors}
      onDragEnd={dock.handleDragEnd}
      onDragMove={dock.handleDragMove}
      onDragStart={dock.handleDragStart}
      collisionDetection={pointerWithin}
    >
      <div ref={dock.workspaceRef} className="relative flex min-h-0 flex-1 gap-1.5 overflow-hidden bg-toolbar-bg p-1.5">
        <DockSide zone="left" dock={dock} renderPanel={renderPanel} />

        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg bg-card shadow-island">
          {tabs}

          <div ref={dock.mapAreaRef} className="relative min-h-0 flex-1">
            {children}

            {progress && (
              <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-background/80 backdrop-blur-sm">
                <div className="text-sm text-muted-foreground">{progress.label}</div>
                <div className="h-2 w-72 overflow-hidden rounded-full bg-secondary">
                  <div
                    style={{ width: `${Math.round(progress.value * 100)}%` }}
                    className="h-full rounded-full bg-primary transition-[width] duration-150 ease-out"
                  />
                </div>
                <div className="font-mono text-xs text-muted-foreground">{Math.round(progress.value * 100)}%</div>
              </div>
            )}

            {dock.cornered.map(renderCornerPanel)}
          </div>
        </div>

        <DockSide dock={dock} zone="right" renderPanel={renderPanel} />

        {dock.floating.map(renderFloatingPanel)}
      </div>

      <DragOverlay dropAnimation={null}>
        {dock.dragging ? (
          <div
            style={{ width: dock.dragSize?.width, height: dock.dragSize?.height }}
            className="cursor-grabbing rounded-lg shadow-[0_10px_40px_-5px_rgba(0,0,0,0.65)] ring-1 ring-black/40"
          >
            {renderPanel(dock.dragging)}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
};

export default Workspace;
