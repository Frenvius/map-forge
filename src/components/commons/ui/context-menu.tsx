import * as React from 'react';
import * as ContextMenuPrimitive from '@radix-ui/react-context-menu';

import { cn } from '~/usecase/classNames';

const ContextMenu = ContextMenuPrimitive.Root;
const ContextMenuTrigger = ContextMenuPrimitive.Trigger;
const ContextMenuGroup = ContextMenuPrimitive.Group;

const ContextMenuContent = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Portal>
    <ContextMenuPrimitive.Content
      ref={ref}
      className={cn(
        'z-50 min-w-[9rem] overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-island animate-in fade-in-80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
        className
      )}
      {...props}
    />
  </ContextMenuPrimitive.Portal>
));
ContextMenuContent.displayName = ContextMenuPrimitive.Content.displayName;

const ContextMenuItem = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item> & { inset?: boolean; destructive?: boolean }
>(({ inset, destructive, className, ...props }, ref) => (
  <ContextMenuPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-xs outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 focus:bg-accent focus:text-accent-foreground',
      inset && 'pl-8',
      destructive && 'text-[#f0795b] focus:bg-[#c42b1c] focus:text-white',
      className
    )}
    {...props}
  />
));
ContextMenuItem.displayName = ContextMenuPrimitive.Item.displayName;

const ContextMenuLabel = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Label> & { inset?: boolean }
>(({ inset, className, ...props }, ref) => (
  <ContextMenuPrimitive.Label
    ref={ref}
    className={cn(
      'px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground',
      inset && 'pl-8',
      className
    )}
    {...props}
  />
));
ContextMenuLabel.displayName = ContextMenuPrimitive.Label.displayName;

const ContextMenuSeparator = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Separator ref={ref} className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />
));
ContextMenuSeparator.displayName = ContextMenuPrimitive.Separator.displayName;

const ContextMenuShortcut = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => (
  <span className={cn('ml-auto text-[10px] tracking-widest text-muted-foreground', className)} {...props} />
);
ContextMenuShortcut.displayName = 'ContextMenuShortcut';

export {
  ContextMenu,
  ContextMenuItem,
  ContextMenuGroup,
  ContextMenuLabel,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuShortcut,
  ContextMenuSeparator
};
