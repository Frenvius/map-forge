import React from 'react';

import { Label } from '~/components/commons/ui/label';
import { Input } from '~/components/commons/ui/input';
import { Button } from '~/components/commons/ui/button';
import { MapProperties as MapProps } from '~/domain/map';
import { getMapProperties, setMapProperties } from '~/adapter/map';
import { Dialog, DialogTitle, DialogHeader, DialogFooter, DialogContent } from '~/components/commons/ui/dialog';

interface MapPropertiesDialogProps {
  open: boolean;
  mapId: number | null;
  onSaved?: () => void;
  onOpenChange: (open: boolean) => void;
}

const MIN_MAP_SIZE = 64;
const MAX_MAP_SIZE = 65000;

const OTBM_VERSIONS: { value: number; label: string }[] = [
  { value: 1, label: 'OTServ 0.5.0' },
  { value: 2, label: 'OTServ 0.6.0' },
  { value: 3, label: 'OTServ 0.6.1' },
  { value: 4, label: 'OTServ 0.7.0 (revscriptsys)' }
];

const selectClass =
  'flex h-8 w-full rounded-md border border-border bg-input px-2.5 py-1 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

const MapPropertiesDialog = ({ open, mapId, onSaved, onOpenChange }: MapPropertiesDialogProps) => {
  const [props, setProps] = React.useState<MapProps | null>(null);

  React.useEffect(() => {
    if (!open || mapId === null) return;
    void getMapProperties(mapId).then(setProps);
  }, [open, mapId]);

  const patch = (next: Partial<MapProps>) => setProps((p) => (p ? { ...p, ...next } : p));

  const save = () => {
    if (mapId === null || !props) return;
    void setMapProperties(mapId, {
      width: props.width,
      height: props.height,
      description: props.description,
      spawnFile: props.spawnFile,
      houseFile: props.houseFile,
      otbmVersion: props.otbmVersion,
      itemsMinor: props.itemsMinor
    }).then(() => {
      onSaved?.();
      onOpenChange(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Map Properties</DialogTitle>
        </DialogHeader>
        {props && (
          <div className="flex flex-col gap-3 p-4">
            <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
              Description
              <textarea
                rows={3}
                value={props.description}
                onChange={(e) => patch({ description: e.target.value })}
                className="w-full resize-none rounded-md border border-border bg-input px-2.5 py-1.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
                Map Version
                <select
                  className={selectClass}
                  value={props.otbmVersion}
                  onChange={(e) => patch({ otbmVersion: Number(e.target.value) })}
                >
                  {OTBM_VERSIONS.map((v) => (
                    <option key={v.value} value={v.value}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
                Client Version
                <Input type="number" value={props.itemsMinor} onChange={(e) => patch({ itemsMinor: Number(e.target.value) })} />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
                Width
                <Input
                  type="number"
                  min={MIN_MAP_SIZE}
                  max={MAX_MAP_SIZE}
                  value={props.width}
                  onChange={(e) => patch({ width: Number(e.target.value) })}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
                Height
                <Input
                  type="number"
                  min={MIN_MAP_SIZE}
                  max={MAX_MAP_SIZE}
                  value={props.height}
                  onChange={(e) => patch({ height: Number(e.target.value) })}
                />
              </label>
            </div>

            <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
              External House File
              <Input value={props.houseFile} onChange={(e) => patch({ houseFile: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
              External Spawn File
              <Input value={props.spawnFile} onChange={(e) => patch({ spawnFile: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              External Waypoint File
              <Input disabled value={props.waypointFile} />
            </label>

            <div className="flex items-center justify-between">
              <Label className="text-muted-foreground">{props.townCount} towns</Label>
              <Label className="text-muted-foreground">{props.waypointCount} waypoints</Label>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={!props}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default MapPropertiesDialog;
