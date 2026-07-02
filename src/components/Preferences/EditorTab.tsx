import { Button } from '~/components/commons/ui/button';
import { Checkbox } from '~/components/commons/ui/checkbox';
import { EditorConfig, defaultEditorConfig } from '~/adapter/preferences';
import { Select, SelectItem, SelectContent, SelectTrigger } from '~/components/commons/ui/select';

const FLOORS = Array.from({ length: 16 }, (_, i) => i);

interface EditorTabProps {
  config: EditorConfig;
  onChange: (config: EditorConfig) => void;
}

const EditorTab = ({ config, onChange }: EditorTabProps) => {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col">
          <span className="text-xs font-medium">Auto-create spawn when placing a creature</span>
          <span className="text-[10px] text-muted-foreground">
            Place the required spawn automatically when dropping a creature
          </span>
        </div>
        <Checkbox
          checked={config.autoCreateSpawn}
          onCheckedChange={(v) => onChange({ ...config, autoCreateSpawn: v === true })}
        />
      </div>
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col">
          <span className="text-xs font-medium">Creature eraser removes monsters</span>
          <span className="text-[10px] text-muted-foreground">Let the creature eraser delete placed creatures</span>
        </div>
        <Checkbox checked={config.eraseMonsters} onCheckedChange={(v) => onChange({ ...config, eraseMonsters: v === true })} />
      </div>
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col">
          <span className="text-xs font-medium">Creature eraser removes spawns</span>
          <span className="text-[10px] text-muted-foreground">Let the creature eraser delete spawn areas</span>
        </div>
        <Checkbox checked={config.eraseSpawns} onCheckedChange={(v) => onChange({ ...config, eraseSpawns: v === true })} />
      </div>
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col">
          <span className="text-xs font-medium">Undo steps</span>
          <span className="text-[10px] text-muted-foreground">Maximum number of actions kept in the undo history</span>
        </div>
        <input
          min={1}
          type="number"
          value={config.undoSteps}
          onChange={(e) => onChange({ ...config, undoSteps: Math.max(1, Number(e.target.value)) })}
          className="h-7 w-20 rounded border border-input bg-background px-2 text-sm text-foreground outline-none focus:border-ring"
        />
      </div>
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col">
          <span className="text-xs font-medium">Undo memory (MB)</span>
          <span className="text-[10px] text-muted-foreground">
            History is trimmed when it exceeds this size (a huge paste is one step)
          </span>
        </div>
        <input
          min={16}
          type="number"
          value={config.undoMemoryMb}
          onChange={(e) => onChange({ ...config, undoMemoryMb: Math.max(16, Number(e.target.value)) })}
          className="h-7 w-20 rounded border border-input bg-background px-2 text-sm text-foreground outline-none focus:border-ring"
        />
      </div>
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col">
          <span className="text-xs font-medium">Default floor</span>
          <span className="text-[10px] text-muted-foreground">Floor shown when opening a map with no saved view</span>
        </div>
        <div className="flex items-center gap-2">
          {config.defaultFloor !== defaultEditorConfig.defaultFloor && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-[10px] text-muted-foreground"
              onClick={() => onChange({ ...config, defaultFloor: defaultEditorConfig.defaultFloor })}
            >
              Reset
            </Button>
          )}
          <Select value={String(config.defaultFloor)} onValueChange={(v) => onChange({ ...config, defaultFloor: Number(v) })}>
            <SelectTrigger className="h-7 w-28 px-2 py-0 tabular-nums">
              <span>Floor {config.defaultFloor}</span>
            </SelectTrigger>
            <SelectContent className="max-h-none">
              {FLOORS.map((z) => (
                <SelectItem key={z} value={String(z)}>
                  Floor {z}
                  {z === config.defaultFloor ? <span className="ml-1.5 text-muted-foreground/70">(sea level)</span> : null}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
};

export default EditorTab;
