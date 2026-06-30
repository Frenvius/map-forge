import { EditorConfig } from '~/adapter/preferences';
import { Checkbox } from '~/components/commons/ui/checkbox';

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
        <Checkbox
          checked={config.eraseMonsters}
          onCheckedChange={(v) => onChange({ ...config, eraseMonsters: v === true })}
        />
      </div>
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col">
          <span className="text-xs font-medium">Creature eraser removes spawns</span>
          <span className="text-[10px] text-muted-foreground">Let the creature eraser delete spawn areas</span>
        </div>
        <Checkbox checked={config.eraseSpawns} onCheckedChange={(v) => onChange({ ...config, eraseSpawns: v === true })} />
      </div>
    </div>
  );
};

export default EditorTab;
