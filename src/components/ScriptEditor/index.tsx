import React from 'react';

import { Button } from '~/components/commons/ui/button';
import { Checkbox } from '~/components/commons/ui/checkbox';
import { readScript, listScripts, writeScript, openScriptsDir } from '~/adapter/scripts';
import { isLuaEnabled, setLuaEnabled } from '~/usecase/util/luaSettings';
import { Dialog, DialogTitle, DialogHeader, DialogFooter, DialogContent } from '~/components/commons/ui/dialog';

interface ScriptEditorProps {
  open: boolean;
  onReloaded?: () => void;
  onOpenChange: (open: boolean) => void;
}

const ScriptEditor = ({ open, onReloaded, onOpenChange }: ScriptEditorProps) => {
  const initialEnabled = React.useRef(isLuaEnabled());
  const [enabled, setEnabled] = React.useState(initialEnabled.current);
  const [names, setNames] = React.useState<string[]>([]);
  const [active, setActive] = React.useState<string | null>(null);
  const [content, setContent] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [dirty, setDirty] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setStatus('');
    initialEnabled.current = isLuaEnabled();
    setEnabled(initialEnabled.current);
    void listScripts().then((list) => {
      setNames(list);
      setActive((cur) => cur ?? list[0] ?? null);
    });
  }, [open]);

  const refresh = () => {
    setStatus('');
    void listScripts()
      .then((list) => {
        setNames(list);
        const next = active && list.includes(active) ? active : (list[0] ?? null);
        setActive(next);
        if (!next || dirty) return null;
        return readScript(next).then((text) => {
          setContent(text);
          setDirty(false);
        });
      })
      .then(() => setStatus(dirty ? 'File list refreshed, unsaved changes kept' : 'Reloaded from disk'))
      .catch((e) => setStatus(`error: ${e}`));
  };

  React.useEffect(() => {
    if (!open || !active) return;
    void readScript(active).then((text) => {
      setContent(text);
      setDirty(false);
    });
  }, [open, active]);

  const toggleDirty = enabled !== initialEnabled.current;

  const save = () => {
    if (toggleDirty) setLuaEnabled(enabled);
    if (!active || !dirty) {
      if (toggleDirty) window.location.reload();
      return;
    }
    setStatus('Saving...');
    void writeScript(active, content)
      .then((n) => {
        setDirty(false);
        setStatus(`ok: ${n} scripts loaded`);
        onReloaded?.();
        if (toggleDirty) window.location.reload();
      })
      .catch((e) => setStatus(`error: ${e}`));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader className="h-12 flex-row items-center justify-between gap-3 py-0 pr-12">
          <DialogTitle>Lua Scripts</DialogTitle>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{enabled ? 'Enabled' : 'Disabled'}</span>
            <Checkbox checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} />
          </label>
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
        <DialogFooter className="items-center">
          <div className="mr-auto flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => void openScriptsDir().catch((e) => setStatus(`error: ${e}`))}>
              Open Folder
            </Button>
            <Button size="sm" variant="ghost" onClick={refresh}>
              Reload Files
            </Button>
          </div>
          <span className="self-center px-2 text-xs text-muted-foreground">{status}</span>
          <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button size="sm" onClick={save} disabled={(!active || !dirty) && !toggleDirty}>
            Save + Reload
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ScriptEditor;
