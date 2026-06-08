import React from 'react';

import { Button } from '~/components/commons/ui/button';
import ClientVersionTab from '~/components/Preferences/ClientVersionTab';
import { ClientConfig, loadClientConfig, saveClientConfig, defaultClientConfig } from '~/adapter/preferences';
import { Dialog, DialogTitle, DialogHeader, DialogFooter, DialogContent } from '~/components/commons/ui/dialog';

interface PreferencesProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const Preferences = ({ open, onOpenChange }: PreferencesProps) => {
  const [config, setConfig] = React.useState<ClientConfig>(defaultClientConfig);

  React.useEffect(() => {
    if (open) void loadClientConfig().then(setConfig);
  }, [open]);

  const save = () => {
    void saveClientConfig(config);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Preferences</DialogTitle>
        </DialogHeader>
        <div className="flex items-center border-b border-border px-3">
          <div className="-mb-px border-b-2 border-primary px-2 py-2 text-xs font-medium">Client Version</div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <ClientVersionTab config={config} onChange={setConfig} />
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
