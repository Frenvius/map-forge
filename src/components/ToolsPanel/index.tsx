import { useRef, useState, useEffect, ComponentType } from 'react';
import { Brush, Check, Eraser, Layers2, PenTool, Crosshair, MousePointer2, GripHorizontal, Skull } from 'lucide-react';
import {
  IconHome,
  IconFlag3,
  IconSpider,
  IconSwords,
  IconLogout,
  IconDoorExit,
  IconSwordOff,
  IconMessage2,
  IconViewfinder,
  IconShieldHalf,
  IconScanLetterA
} from '@tabler/icons-react';

import { cn } from '~/usecase/classNames';
import { Hint } from '~/components/commons/ui/tooltip';
import { useTool } from '~/usecase/context/ToolContext';
import { Slider } from '~/components/commons/ui/slider';
import BrushImage from '~/components/PalettePanel/BrushImage';
import BrushSelect from '~/components/PalettePanel/BrushSelect';
import { BrushOption, loadBrushOptions } from '~/adapter/biomes';
import { DragHandleProps } from '~/components/Dock/DockablePanel';
import { useAssetsBundle } from '~/usecase/context/AssetsContext';
import { useEditorSettings } from '~/usecase/context/EditorSettingsContext';
import { TOOLS, ToolId, EraserMode, isZoneTool, isHouseTool, ERASER_MODES } from '~/domain/tools';

const ICONS: Record<ToolId, ComponentType<{ className?: string }>> = {
  select: MousePointer2,
  brush: Brush,
  pen: PenTool,
  eraser: Eraser,
  spawn: Crosshair,
  zone_pz: IconShieldHalf,
  zone_nopvp: IconSwordOff,
  zone_nologout: IconLogout,
  zone_pvp: IconSwords,
  house: IconHome,
  house_exit: IconDoorExit
};

const ERASER_MODE_ICONS: Record<EraserMode, ComponentType<{ className?: string }>> = {
  items: Eraser,
  ground: Layers2,
  creatures: Skull
};

interface EraserToolProps {
  selected: boolean;
  mode: EraserMode;
  onActivate: () => void;
  onPickMode: (mode: EraserMode) => void;
}

const EraserTool = ({ selected, mode, onActivate, onPickMode }: EraserToolProps) => {
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  const holdTimer = useRef<number | undefined>(undefined);
  const btnRef = useRef<HTMLButtonElement>(null);
  const Icon = ERASER_MODE_ICONS[mode];

  const open = (e?: { currentTarget: HTMLButtonElement }) => {
    const el = e?.currentTarget ?? btnRef.current;
    const r = el?.getBoundingClientRect();
    if (r) setAnchor({ top: r.top, left: r.right + 4 });
  };

  const cancelHold = () => {
    if (holdTimer.current !== undefined) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = undefined;
    }
  };

  const onPointerDown = () => {
    holdTimer.current = window.setTimeout(() => {
      holdTimer.current = undefined;
      open();
    }, 250);
  };

  const onPointerUp = () => {
    if (holdTimer.current !== undefined) {
      cancelHold();
      onActivate();
    }
  };

  const pick = (next: EraserMode) => {
    onPickMode(next);
    setAnchor(null);
  };

  return (
    <div className="relative flex w-full flex-col items-center">
      <Hint side="right" label={ERASER_MODES.find((m) => m.id === mode)?.label ?? 'Eraser'}>
        <button
          ref={btnRef}
          onPointerUp={onPointerUp}
          onPointerLeave={cancelHold}
          onPointerDown={onPointerDown}
          onContextMenu={(e) => {
            e.preventDefault();
            cancelHold();
            open(e);
          }}
          className={cn(
            'relative flex h-8 w-8 flex-shrink-0 items-center justify-center rounded transition-colors',
            selected ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-item-hover hover:text-foreground'
          )}
        >
          <Icon className="h-[18px] w-[18px]" />
          <span className="absolute bottom-0.5 right-0.5 h-0 w-0 border-b-[4px] border-l-[4px] border-b-current border-l-transparent opacity-70" />
        </button>
      </Hint>

      {anchor && (
        <>
          <div className="fixed inset-0 z-40" onMouseDown={() => setAnchor(null)} />
          <div
            style={{ top: anchor.top, left: anchor.left }}
            className="fixed z-50 min-w-44 rounded-md border border-border bg-popover p-1 shadow-island"
          >
            {ERASER_MODES.map((m) => {
              const ModeIcon = ERASER_MODE_ICONS[m.id];
              return (
                <button
                  key={m.id}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    pick(m.id);
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-item-hover',
                    m.id === mode ? 'text-foreground' : 'text-muted-foreground'
                  )}
                >
                  <ModeIcon className="h-4 w-4 flex-shrink-0" />
                  <span className="flex-1">{m.label}</span>
                  {m.id === mode && <Check className="h-3.5 w-3.5 flex-shrink-0 text-primary" />}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};

const TileSwatch = () => {
  const { dataDir } = useAssetsBundle();
  const { activeTile, setActiveTile, penWidth, setPenWidth } = useTool();
  const [options, setOptions] = useState<BrushOption[]>([]);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    loadBrushOptions(dataDir)
      .then((list) => setOptions(list.filter((o) => o.kind === 'ground')))
      .catch((err) => console.error('Failed to load tile options', err));
  }, [dataDir]);

  const open = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setAnchor({ top: r.top, left: r.right + 8 });
  };

  const pick = (name: string) => setActiveTile(options.find((o) => o.name === name) ?? null);

  return (
    <div className="relative flex w-full flex-col items-center">
      <Hint side="right" label={activeTile ? `Active tile: ${activeTile.name}` : 'Pick an active tile'}>
        <button
          ref={btnRef}
          onClick={open}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded border border-border/60 bg-muted/40 hover:bg-item-hover"
        >
          {activeTile ? (
            <BrushImage size={26} option={activeTile} />
          ) : (
            <Brush className="h-[18px] w-[18px] text-muted-foreground" />
          )}
        </button>
      </Hint>

      {anchor && (
        <>
          <div className="fixed inset-0 z-40" onMouseDown={() => setAnchor(null)} />
          <div
            style={{ top: anchor.top, left: anchor.left }}
            className="fixed z-50 flex w-56 flex-col gap-2 rounded-md border border-border bg-popover p-2 shadow-island"
          >
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Active tile</span>
            <BrushSelect onChange={pick} options={options} placeholder="Select ground" value={activeTile?.name ?? ''} />
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Pen width {penWidth}</span>
            <Slider max={5} min={1} step={0.5} value={[penWidth]} onValueChange={([v]) => setPenWidth(v)} />
          </div>
        </>
      )}
    </div>
  );
};

interface ToolsPanelProps {
  dragHandle?: DragHandleProps;
}

const ToolsPanel = ({ dragHandle }: ToolsPanelProps) => {
  const { activeTool, setActiveTool, ctrlErase, eraserMode, setEraserMode } = useTool();

  const erasing = ctrlErase && (activeTool === 'brush' || isHouseTool(activeTool) || isZoneTool(activeTool));
  const isSelected = (id: ToolId) => {
    if (erasing) return id === 'eraser';
    if (id === 'brush') return activeTool === 'brush' || isHouseTool(activeTool);
    return activeTool === id;
  };
  const {
    automagic,
    showSpawns,
    showCreatures,
    showWaypoints,
    showHouses,
    showTooltips,
    toggleSpawns,
    toggleAutomagic,
    toggleCreatures,
    toggleWaypoints,
    toggleHouses,
    toggleTooltips
  } = useEditorSettings();

  return (
    <div className="flex h-full flex-col items-center gap-0.5 overflow-y-auto rounded-lg bg-card p-1 shadow-island">
      <div
        ref={dragHandle?.ref}
        {...dragHandle?.attributes}
        {...dragHandle?.listeners}
        className={cn('flex w-full justify-center py-1 text-muted-foreground/60', dragHandle?.className)}
      >
        <GripHorizontal className="h-3.5 w-3.5" />
      </div>

      {TOOLS.map((tool) => {
        const Icon = ICONS[tool.id];
        const selected = isSelected(tool.id);
        if (tool.id === 'eraser') {
          return (
            <EraserTool
              key={tool.id}
              mode={eraserMode}
              selected={selected}
              onActivate={() => setActiveTool('eraser')}
              onPickMode={(mode) => {
                setEraserMode(mode);
                setActiveTool('eraser');
              }}
            />
          );
        }
        return (
          <div key={tool.id} className="flex w-full flex-col items-center">
            {tool.id === 'zone_pz' && <div className="my-1 h-px w-5 bg-border/60" />}
            <Hint side="right" label={tool.label}>
              <button
                onClick={() => setActiveTool(tool.id)}
                className={cn(
                  'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded transition-colors',
                  selected ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-item-hover hover:text-foreground'
                )}
              >
                <Icon className="h-[18px] w-[18px]" />
              </button>
            </Hint>
          </div>
        );
      })}

      <div className="mt-auto flex w-full flex-col items-center gap-0.5 pt-1">
        <div className="my-1 h-px w-5 bg-border/60" />
        <TileSwatch />
        <div className="my-1 h-px w-5 bg-border/60" />
        <Hint side="right" label="Show creatures and NPCs">
          <button
            onClick={toggleCreatures}
            className={cn(
              'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded transition-colors',
              showCreatures ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-item-hover hover:text-foreground'
            )}
          >
            <IconSpider className="h-[18px] w-[18px]" />
          </button>
        </Hint>
        <Hint side="right" label="Show spawn areas">
          <button
            onClick={toggleSpawns}
            className={cn(
              'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded transition-colors',
              showSpawns ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-item-hover hover:text-foreground'
            )}
          >
            <IconViewfinder className="h-[18px] w-[18px]" />
          </button>
        </Hint>
        <Hint side="right" label="Show waypoints">
          <button
            onClick={toggleWaypoints}
            className={cn(
              'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded transition-colors',
              showWaypoints ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-item-hover hover:text-foreground'
            )}
          >
            <IconFlag3 className="h-[18px] w-[18px]" />
          </button>
        </Hint>
        <Hint side="right" label="Show houses">
          <button
            onClick={toggleHouses}
            className={cn(
              'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded transition-colors',
              showHouses ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-item-hover hover:text-foreground'
            )}
          >
            <IconHome className="h-[18px] w-[18px]" />
          </button>
        </Hint>
        <Hint side="right" label="Show tooltips">
          <button
            onClick={toggleTooltips}
            className={cn(
              'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded transition-colors',
              showTooltips ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-item-hover hover:text-foreground'
            )}
          >
            <IconMessage2 className="h-[18px] w-[18px]" />
          </button>
        </Hint>
        <Hint side="right" label="Automatic borders - auto-border, walls, tables, carpets, mountains">
          <button
            onClick={toggleAutomagic}
            className={cn(
              'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded transition-colors',
              automagic ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-item-hover hover:text-foreground'
            )}
          >
            <IconScanLetterA className="h-[18px] w-[18px]" />
          </button>
        </Hint>
      </div>
    </div>
  );
};

export default ToolsPanel;
