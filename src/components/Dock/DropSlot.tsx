import { cn } from '~/usecase/classNames';

interface DropSlotProps {
  active: boolean;
  animate: boolean;
  base: number;
  width: number;
  align: 'start' | 'center' | 'end';
}

const DropSlot = ({ active, animate, base, width, align }: DropSlotProps) => {
  return (
    <div
      style={{ width: active ? base + width + 6 : base }}
      className={cn('h-full flex-shrink-0 overflow-hidden', animate && 'transition-[width] duration-200 ease-out')}
    >
      {active && (
        <div
          style={{ width }}
          className={cn(
            'h-full rounded-lg bg-primary/20 ring-1 ring-inset ring-primary/30',
            align === 'start' ? 'mr-auto' : align === 'end' ? 'ml-auto' : 'mx-auto'
          )}
        />
      )}
    </div>
  );
};

export default DropSlot;
