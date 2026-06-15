import React from 'react';

import { cn } from '~/usecase/classNames';
import { Button } from '~/components/commons/ui/button';
import EditorTab from '~/components/Preferences/EditorTab';
import GeneralTab from '~/components/Preferences/GeneralTab';
import ClientVersionTab from '~/components/Preferences/ClientVersionTab';
import { Dialog, DialogTitle, DialogHeader, DialogFooter, DialogContent } from '~/components/commons/ui/dialog';
import {
  ClientConfig,
  EditorConfig,
  GeneralConfig,
  loadClientConfig,
  loadEditorConfig,
  saveClientConfig,
  saveEditorConfig,
  loadGeneralConfig,
  saveGeneralConfig,
  defaultClientConfig,
  defaultEditorConfig,
  defaultGeneralConfig
} from '~/adapter/preferences';

type TabId = 'general' | 'editor' | 'client';

interface PreferencesProps {
  open: boolean;
  onSaved?: () => void;
  onResetLayout?: () => void;
  onOpenChange: (open: boolean) => void;
}

const TABS: { id: TabId; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'editor', label: 'Editor' },
  { id: 'client', label: 'Client Version' }
];

const Preferences = ({ open, onSaved, onResetLayout, onOpenChange }: PreferencesProps) => {
  const [tab, setTab] = React.useState<TabId>('general');
  const [config, setConfig] = React.useState<ClientConfig>(defaultClientConfig);
  const [general, setGeneral] = React.useState<GeneralConfig>(defaultGeneralConfig);
  const [editor, setEditor] = React.useState<EditorConfig>(defaultEditorConfig);

  React.useEffect(() => {
    if (!open) return;
    void loadClientConfig().then(setConfig);
    void loadGeneralConfig().then(setGeneral);
    void loadEditorConfig().then(setEditor);
  }, [open]);

  const save = () => {
    void saveClientConfig(config);
    void saveGeneralConfig(general);
    void saveEditorConfig(editor);
    onSaved?.();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Preferences</DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-1 border-b border-border px-3">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                '-mb-px border-b-2 px-2 py-2 text-xs font-medium transition-colors',
                tab === t.id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {tab === 'general' && <GeneralTab config={general} onChange={setGeneral} onResetLayout={() => onResetLayout?.()} />}
          {tab === 'editor' && <EditorTab config={editor} onChange={setEditor} />}
          {tab === 'client' && <ClientVersionTab config={config} onChange={setConfig} />}
        </div>
        <DialogFooter>
          <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={save}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default Preferences;
