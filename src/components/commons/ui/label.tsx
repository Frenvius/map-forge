import * as React from 'react';

import { cn } from '~/usecase/classNames';

const Label = React.forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(({ className, ...props }, ref) => (
  <label
    ref={ref}
    className={cn('flex items-center gap-2 text-xs font-medium text-foreground select-none', className)}
    {...props}
  />
));
Label.displayName = 'Label';

export { Label };
