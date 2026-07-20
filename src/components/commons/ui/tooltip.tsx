import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';

import { cn } from '~/usecase/classNames';

const TooltipProvider = TooltipPrimitive.Provider;

const Tooltip = TooltipPrimitive.Root;

const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      collisionPadding={8}
      className={cn(
        'z-50 overflow-hidden rounded-md border bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
        className
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

type Side = 'top' | 'right' | 'bottom' | 'left';
type Align = 'start' | 'center' | 'end';

interface HintProps {
  side?: Side;
  align?: Align;
  sideOffset?: number;
  label: React.ReactNode;
  children: React.ReactNode;
}

const Hint = ({ label, children, side = 'top', align = 'center', sideOffset }: HintProps) => {
  if (label === null || label === undefined || label === '') return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} align={align} className="max-w-xs" sideOffset={sideOffset}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
};

export { Hint, Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
