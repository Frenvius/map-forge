import React from 'react';

import { Button } from '~/components/commons/ui/button';
import { readScript, listScripts, writeScript } from '~/adapter/scripts';
import { Dialog, DialogTitle, DialogHeader, DialogFooter, DialogContent } from '~/components/commons/ui/dialog';

interface ScriptEditorProps {
  open: boolean;
  onReloaded?: () => void;
  onOpenChange: (open: boolean) => void;
}

const ScriptEditor = ({ open, onReloaded, onOpenChange }: ScriptEditorProps) => {
  const [names, setNames] = React.useState<string[]>([]);
  const [active, setActive] = React.useState<string | null>(null);
  const [content, setContent] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [dirty, setDirty] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setStatus('');
    void listScripts().then((list) => {
      setNames(list);
      setActive((cur) => cur ?? list[0] ?? null);
    });
  }, [open]);

  React.useEffect(() => {
    if (!open || !active) return;
    void readScript(active).then((text) => {
      setContent(text);
      setDirty(false);
    });
  }, [open, active]);

  const save = () => {
    if (!active) return;
    setStatus('Saving...');
    void writeScript(active, content)
      .then((n) => {
        setDirty(false);
        setStatus(`ok: ${n} scripts loaded`);
        onReloaded?.();
      })
      .catch((e) => setStatus(`error: ${e}`));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Lua Scripts</DialogTitle>
        </DialogHeader>
        <div className="flex h-[60vh] gap-3 p-4">
          <div className="w-44 flex-shrink-0 overflow-y-auto rounded-md border border-border bg-input">
            {names.map((name) => (
              <button
                key={name}
                onClick={() => setActive(name)}
                className={`block w-full truncate px-2.5 py-1.5 text-left text-xs ${
                  name === active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50'
                }`}
              >
                {name}
              </button>
            ))}
          </div>
          <textarea
            value={content}
            spellCheck={false}
            onChange={(e) => {
              setContent(e.target.value);
              setDirty(true);
            }}
            className="flex-1 resize-none rounded-md border border-border bg-input px-3 py-2 font-mono text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
        <DialogFooter>
          <span className="mr-auto px-2 text-xs text-muted-foreground">{status}</span>
          <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button size="sm" onClick={save} disabled={!active || !dirty}>
            Save + Reload
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ScriptEditor;
