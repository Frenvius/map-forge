import { FolderOpen } from 'lucide-react';

import { Button } from '~/components/commons/ui/button';
import {
  Dialog,
  DialogTitle,
  DialogHeader,
  DialogFooter,
  DialogContent,
  DialogDescription
} from '~/components/commons/ui/dialog';

interface CreatureDataDialogProps {
  open: boolean;
  mapName: string;
  onSelect: () => void;
  onClose: () => void;
}

const CreatureDataDialog = ({ open, mapName, onSelect, onClose }: CreatureDataDialogProps) => (
  <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>Creature data folder</DialogTitle>
        <DialogDescription>No monster/npc folder could be found for {mapName}.</DialogDescription>
      </DialogHeader>
      <div className="px-4 py-4 text-xs leading-relaxed text-muted-foreground">
        Select the server <span className="font-mono text-foreground">data</span> folder (the one containing{' '}
        <span className="font-mono text-foreground">monster</span> and <span className="font-mono text-foreground">npc</span>). It
        is saved for this map and reloaded automatically when creatures change.
      </div>
      <DialogFooter>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Skip
        </Button>
        <Button size="sm" onClick={onSelect}>
          <FolderOpen />
          Select data folder
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

export default CreatureDataDialog;
