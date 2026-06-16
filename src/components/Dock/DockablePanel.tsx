import React from 'react';
import { useDraggable } from '@dnd-kit/core';

import { cn } from '~/usecase/classNames';
import { PanelId, PanelMeta } from '~/domain/dock';

type UseDraggableReturn = ReturnType<typeof useDraggable>;

export interface DragHandleProps {
  ref: UseDraggableReturn['setActivatorNodeRef'];
  className: string;
  attributes: UseDraggableReturn['attributes'];
  listeners: UseDraggableReturn['listeners'];
}

interface DockablePanelProps {
  id?: PanelId;
  meta: PanelMeta;
  guarded?: boolean;
  className?: string;
  children: (handle: DragHandleProps) => React.ReactNode;
}

const HANDLE_CLASS = 'cursor-grab active:cursor-grabbing';

const DockablePanel = ({ id, meta, guarded, className = 'min-h-0 flex-1', children }: DockablePanelProps) => {
  const panelId = id ?? meta.id;
  const { setNodeRef, setActivatorNodeRef, listeners, attributes, isDragging } = useDraggable({ id: panelId });

  const handle: DragHandleProps = {
    ref: setActivatorNodeRef,
    className: HANDLE_CLASS,
    attributes,
    listeners
  };

  return (
    <div
      ref={setNodeRef}
      data-panel-id={panelId}
      className={cn(className, isDragging && 'opacity-40', guarded && 'pointer-events-none select-none')}
    >
      {children(handle)}
    </div>
  );
};

export default DockablePanel;
