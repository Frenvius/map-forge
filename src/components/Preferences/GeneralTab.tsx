import { MIN_STACK, MAX_STACK } from '~/domain/dock';
import { GeneralConfig } from '~/adapter/preferences';
import { Button } from '~/components/commons/ui/button';
import { Checkbox } from '~/components/commons/ui/checkbox';
import { formatPosition, COPY_POSITION_FORMATS } from '~/usecase/positionFormat';
import { Select, SelectItem, SelectValue, SelectContent, SelectTrigger } from '~/components/commons/ui/select';

interface GeneralTabProps {
  config: GeneralConfig;
  onResetLayout: () => void;
  onChange: (config: GeneralConfig) => void;
}

const STACK_OPTIONS = Array.from({ length: MAX_STACK - MIN_STACK + 1 }, (_, i) => MIN_STACK + i);
const SAMPLE_POSITION = { x: 1000, y: 1000, z: 7 };

const GeneralTab = ({ config, onResetLayout, onChange }: GeneralTabProps) => {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col">
          <span className="text-xs font-medium">Max vertical panel stack</span>
          <span className="text-[10px] text-muted-foreground">How many panels can stack in one docked column</span>
        </div>
        <Select value={String(config.maxStack)} onValueChange={(v) => onChange({ ...config, maxStack: Number(v) })}>
          <SelectTrigger className="h-7 w-16">
            <SelectValue>{config.maxStack}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {STACK_OPTIONS.map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="h-px bg-border" />

      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col">
          <span className="text-xs font-medium">Copy position format</span>
          <span className="text-[10px] text-muted-foreground">{formatPosition(config.copyPositionFormat, SAMPLE_POSITION)}</span>
        </div>
        <Select value={config.copyPositionFormat} onValueChange={(v) => onChange({ ...config, copyPositionFormat: v })}>
          <SelectTrigger className="h-7 w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {COPY_POSITION_FORMATS.map((f) => (
              <SelectItem key={f.id} value={f.id}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="h-px bg-border" />

      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col">
          <span className="text-xs font-medium">Default spawn size</span>
          <span className="text-[10px] text-muted-foreground">Radius used when placing creatures and spawns</span>
        </div>
        <input
          min={1}
          type="number"
          value={config.spawnSize}
          onChange={(e) => onChange({ ...config, spawnSize: Math.max(1, Number(e.target.value)) })}
          className="h-7 w-16 rounded border border-input bg-background px-2 text-sm text-foreground outline-none focus:border-ring"
        />
      </div>

      <div className="h-px bg-border" />

      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col">
          <span className="text-xs font-medium">Default spawn time</span>
          <span className="text-[10px] text-muted-foreground">Respawn time (seconds) for placed creatures</span>
        </div>
        <input
          min={1}
          type="number"
          value={config.spawnTime}
          onChange={(e) => onChange({ ...config, spawnTime: Math.max(1, Number(e.target.value)) })}
          className="h-7 w-16 rounded border border-input bg-background px-2 text-sm text-foreground outline-none focus:border-ring"
        />
      </div>

      <div className="h-px bg-border" />

      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col">
          <span className="text-xs font-medium">Boundless panning</span>
          <span className="text-[10px] text-muted-foreground">Wrap cursor at screen edges while panning the map</span>
        </div>
        <Checkbox checked={config.infiniteMouse} onCheckedChange={(v) => onChange({ ...config, infiniteMouse: v === true })} />
      </div>

      <div className="h-px bg-border" />

      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col">
          <span className="text-xs font-medium">Panel layout</span>
          <span className="text-[10px] text-muted-foreground">Restore docks and floating panels to defaults</span>
        </div>
        <Button size="sm" variant="outline" onClick={onResetLayout}>
          Reset layout
        </Button>
      </div>
    </div>
  );
};

export default GeneralTab;
