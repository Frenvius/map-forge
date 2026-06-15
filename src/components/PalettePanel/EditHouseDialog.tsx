import React from 'react';

import { Town } from '~/domain/map';
import { House } from '~/domain/house';
import { Input } from '~/components/commons/ui/input';
import { Button } from '~/components/commons/ui/button';
import { Select, SelectItem, SelectValue, SelectContent, SelectTrigger } from '~/components/commons/ui/select';
import { Dialog, DialogTitle, DialogHeader, DialogFooter, DialogContent } from '~/components/commons/ui/dialog';

interface EditHouseDialogProps {
  open: boolean;
  house: House | null;
  towns: Town[];
  onOpenChange: (open: boolean) => void;
  onSave: (next: House) => void;
}

const EditHouseDialog = ({ open, house, towns, onOpenChange, onSave }: EditHouseDialogProps) => {
  const [draft, setDraft] = React.useState<House | null>(house);

  React.useEffect(() => {
    if (open) setDraft(house);
  }, [open, house]);

  if (!draft) return null;

  const patch = (next: Partial<House>) => setDraft((d) => (d ? { ...d, ...next } : d));

  const save = () => {
    const name = draft.name.trim() || `House #${draft.id}`;
    onSave({ ...draft, name });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit House</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 p-4">
          <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
            Name
            <Input value={draft.name} onChange={(e) => patch({ name: e.target.value })} />
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              House ID
              <Input disabled value={draft.id} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
              Rent
              <Input type="number" value={draft.rent} onChange={(e) => patch({ rent: Number(e.target.value) })} />
            </label>
          </div>

          <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
            Town
            <Select value={String(draft.townId)} onValueChange={(v) => patch({ townId: Number(v) })}>
              <SelectTrigger>
                <SelectValue placeholder="No town" />
              </SelectTrigger>
              <SelectContent>
                {towns.length === 0 ? (
                  <SelectItem value="0">No towns defined</SelectItem>
                ) : (
                  towns.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </label>

          <label className="flex items-center gap-2 text-xs font-medium text-foreground">
            <input
              type="checkbox"
              checked={draft.guildhall}
              className="h-3.5 w-3.5 accent-primary"
              onChange={(e) => patch({ guildhall: e.target.checked })}
            />
            Guildhall
          </label>
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

export default EditHouseDialog;
