import React from 'react';

import { Position } from '~/domain/map';

interface GotoPositionFormProps {
  initial: Position;
  onSubmit: (pos: Position) => void;
  onCancel: () => void;
}

const GotoPositionForm = ({ initial, onSubmit, onCancel }: GotoPositionFormProps) => {
  const [pos, setPos] = React.useState<Position>(initial);

  return (
    <div onMouseDown={onCancel} className="absolute inset-0 z-50 flex items-center justify-center bg-black/40">
      <form
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(pos);
        }}
        className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-island-lg"
      >
        <div className="text-sm font-medium">Go to position</div>
        <div className="flex gap-2">
          {(['x', 'y', 'z'] as const).map((axis) => (
            <label key={axis} className="flex flex-col gap-1 text-xs text-muted-foreground">
              {axis.toUpperCase()}
              <input
                type="number"
                value={pos[axis]}
                onChange={(e) => setPos({ ...pos, [axis]: Number(e.target.value) })}
                className="w-24 rounded border border-input bg-background px-2 py-1 text-sm text-foreground outline-none focus:border-ring"
              />
            </label>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded border border-border px-3 py-1.5 text-sm hover:bg-accent">
            Cancel
          </button>
          <button type="submit" className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/85">
            Go
          </button>
        </div>
      </form>
    </div>
  );
};

export default GotoPositionForm;
