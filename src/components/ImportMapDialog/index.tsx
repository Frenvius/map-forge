import React from 'react';
import { open } from '@tauri-apps/plugin-dialog';

import { Input } from '~/components/commons/ui/input';
import { Button } from '~/components/commons/ui/button';
import { Select, SelectItem, SelectValue, SelectContent, SelectTrigger } from '~/components/commons/ui/select';
import { Dialog, DialogTitle, DialogHeader, DialogFooter, DialogContent } from '~/components/commons/ui/dialog';

export type HouseImportMode = 'smart' | 'merge' | 'insert' | 'none';
export type SpawnImportMode = 'merge' | 'none';
export type PlaceMode = 'offset' | 'ghost';

export interface ImportMapRequest {
  path: string;
  placeMode: PlaceMode;
  offsetX: number;
  offsetY: number;
  houseMode: HouseImportMode;
  spawnMode: SpawnImportMode;
}

interface ImportMapDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (req: ImportMapRequest) => void;
}

const ImportMapDialog = ({ open: isOpen, onOpenChange, onImport }: ImportMapDialogProps) => {
  const [path, setPath] = React.useState('');
  const [placeGhost, setPlaceGhost] = React.useState(false);
  const [offsetX, setOffsetX] = React.useState(0);
  const [offsetY, setOffsetY] = React.useState(0);
  const [houseMode, setHouseMode] = React.useState<HouseImportMode>('smart');
  const [spawnMode, setSpawnMode] = React.useState<SpawnImportMode>('merge');

  React.useEffect(() => {
    if (isOpen) {
      setPath('');
      setPlaceGhost(false);
      setOffsetX(0);
      setOffsetY(0);
      setHouseMode('smart');
      setSpawnMode('merge');
    }
  }, [isOpen]);

  const browse = async () => {
    const selected = await open({
      multiple: false,
      title: 'Import map...',
      filters: [{ name: 'OTBM Maps', extensions: ['otbm'] }]
    });
    if (selected && typeof selected === 'string') setPath(selected);
  };

  const submit = () => {
    if (!path) return;
    onImport({ path, placeMode: placeGhost ? 'ghost' : 'offset', offsetX, offsetY, houseMode, spawnMode });
    onOpenChange(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Import Map</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 p-4">
          <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
            Map File
            <div className="flex gap-2">
              <Input readOnly value={path} className="flex-1" placeholder="No file selected" />
              <Button size="sm" variant="secondary" onClick={() => void browse()}>
                Browse...
              </Button>
            </div>
          </label>

          <label className="flex items-center gap-2 text-xs font-medium text-foreground">
            <input
              type="checkbox"
              checked={placeGhost}
              className="h-3.5 w-3.5 accent-primary"
              onChange={(e) => setPlaceGhost(e.target.checked)}
            />
            Place map manually
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label
              data-off={placeGhost}
              className="flex flex-col gap-1 text-xs font-medium text-foreground data-[off=true]:text-muted-foreground"
            >
              Offset X
              <Input
                type="number"
                value={offsetX}
                disabled={placeGhost}
                onChange={(e) => setOffsetX(Number(e.target.value) || 0)}
              />
            </label>
            <label
              data-off={placeGhost}
              className="flex flex-col gap-1 text-xs font-medium text-foreground data-[off=true]:text-muted-foreground"
            >
              Offset Y
              <Input
                type="number"
                value={offsetY}
                disabled={placeGhost}
                onChange={(e) => setOffsetY(Number(e.target.value) || 0)}
              />
            </label>
          </div>

          <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
            House Import Behaviour
            <Select value={houseMode} onValueChange={(v) => setHouseMode(v as HouseImportMode)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="smart">Smart Merge</SelectItem>
                <SelectItem value="merge">Merge</SelectItem>
                <SelectItem value="insert">Insert</SelectItem>
                <SelectItem value="none">Don't Import</SelectItem>
              </SelectContent>
            </Select>
          </label>

          <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
            Spawn Import Behaviour
            <Select value={spawnMode} onValueChange={(v) => setSpawnMode(v as SpawnImportMode)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="merge">Merge</SelectItem>
                <SelectItem value="none">Don't Import</SelectItem>
              </SelectContent>
            </Select>
          </label>
        </div>
        <DialogFooter>
          <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={!path} onClick={submit}>
            {placeGhost ? 'Place' : 'Ok'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ImportMapDialog;
