import { X, FolderOpen } from 'lucide-react';

import { cn } from '~/usecase/classNames';
import { Button } from '~/components/commons/ui/button';

interface ClientRowProps {
  label: string;
  path?: string;
  isDefault: boolean;
  onBrowse: () => void;
  onClear: () => void;
}

const ClientRow = ({ label, path, isDefault, onBrowse, onClear }: ClientRowProps) => (
  <div className="flex items-center gap-2 rounded-md border border-border bg-input/40 px-2.5 py-1.5">
    <span className={cn('h-2 w-2 shrink-0 rounded-full', path ? 'bg-primary' : 'border border-muted-foreground')} />
    <span className="w-12 shrink-0 text-xs font-medium">{label}</span>
    {isDefault && (
      <span className="shrink-0 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">default</span>
    )}
    <span
      title={path}
      className={cn('flex-1 truncate text-xs', path ? 'text-muted-foreground' : 'italic text-muted-foreground/60')}
    >
      {path || 'not set'}
    </span>
    <Button size="sm" variant="ghost" onClick={onBrowse} className="h-6 px-2 text-xs">
      <FolderOpen className="mr-1 h-3.5 w-3.5" />
      Browse
    </Button>
    {path && (
      <button
        onClick={onClear}
        aria-label="Clear path"
        className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    )}
  </div>
);

export default ClientRow;
