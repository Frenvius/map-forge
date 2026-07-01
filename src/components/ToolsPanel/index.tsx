import { useRef, useState, useEffect, ComponentType } from 'react';
import { Brush, Check, Frame, Skull, Eraser, Layers2, PenTool, Repeat2, Crosshair, MousePointer2, GripHorizontal } from 'lucide-react';
import {
  IconHome,
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
  borderize: Frame,
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
  const { activeTile, setActiveTile, secondaryTile, setSecondaryTile, swapTiles, penWidth, setPenWidth } = useTool();
  const [options, setOptions] = useState<BrushOption[]>([]);
  const [open, setOpen] = useState<'primary' | 'secondary' | null>(null);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const secondaryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    loadBrushOptions(dataDir)
      .then((list) => setOptions(list.filter((o) => o.kind === 'ground')))
      .catch((err) => console.error('Failed to load tile options', err));
  }, [dataDir]);

  const openFor = (which: 'primary' | 'secondary') => {
    const r = (which === 'primary' ? primaryRef : secondaryRef).current?.getBoundingClientRect();
    if (r) {
      setAnchor({ top: r.top, left: r.right + 8 });
      setOpen(which);
    }
  };

  const close = () => {
    setOpen(null);
    setAnchor(null);
  };

  const pick = (name: string) => {
    const tile = options.find((o) => o.name === name) ?? null;
    if (open === 'primary') setActiveTile(tile);
    else setSecondaryTile(tile);
  };

  const current = open === 'primary' ? activeTile : secondaryTile;

  return (
    <div className="relative flex w-full flex-col items-center">
      <div className="relative h-9 w-9">
        <Hint side="right" label={secondaryTile ? `Secondary tile: ${secondaryTile.name}` : 'Pick a secondary tile'}>
          <button
            ref={secondaryRef}
            onClick={() => openFor('secondary')}
            className="absolute bottom-0 right-0 flex h-[22px] w-[22px] items-center justify-center overflow-hidden rounded border border-border/60 bg-muted/40 hover:bg-item-hover"
          >
            {secondaryTile ? (
              <BrushImage size={20} option={secondaryTile} />
            ) : (
              <Brush className="h-3 w-3 text-muted-foreground" />
            )}
          </button>
        </Hint>
        <Hint side="right" label={activeTile ? `Active tile: ${activeTile.name} (X to swap)` : 'Pick an active tile (X to swap)'}>
          <button
            ref={primaryRef}
            onClick={() => openFor('primary')}
            className="absolute left-0 top-0 z-10 flex h-[22px] w-[22px] items-center justify-center overflow-hidden rounded border border-primary/70 bg-muted/40 shadow-sm hover:bg-item-hover"
          >
            {activeTile ? <BrushImage size={20} option={activeTile} /> : <Brush className="h-3 w-3 text-muted-foreground" />}
          </button>
        </Hint>
        <button
          onClick={swapTiles}
          title="Swap tiles (X)"
          className="absolute right-0 top-0 z-20 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-popover text-muted-foreground shadow-sm hover:text-foreground"
        >
          <Repeat2 className="h-2.5 w-2.5" />
        </button>
      </div>

      {open && anchor && (
        <>
          <div onMouseDown={close} className="fixed inset-0 z-40" />
          <div
            style={{ top: anchor.top, left: anchor.left }}
            className="fixed z-50 flex w-56 flex-col gap-2 rounded-md border border-border bg-popover p-2 shadow-island"
          >
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {open === 'primary' ? 'Active tile' : 'Secondary tile'}
            </span>
            <BrushSelect onChange={pick} options={options} placeholder="Select ground" value={current?.name ?? ''} />
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
    showHouses,
    showTooltips,
    toggleSpawns,
    toggleAutomagic,
    toggleCreatures,
    toggleHouses,
    toggleTooltips,
    zoneVisibility,
    setAllZones
  } = useEditorSettings();
  const anyZoneVisible = zoneVisibility.pz || zoneVisibility.nopvp || zoneVisibility.nologout || zoneVisibility.pvp;

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
        <Hint side="right" label="Show creatures and NPCs (F)">
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
        <Hint side="right" label="Show spawn areas (Alt+S)">
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
        <Hint side="right" label="Show houses (Ctrl+H)">
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
        <Hint side="right" label="Show tooltips (Y)">
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
        <Hint side="right" label={anyZoneVisible ? 'Hide all zones' : 'Show all zones'}>
          <button
            onClick={() => setAllZones(!anyZoneVisible)}
            className={cn(
              'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded transition-colors',
              anyZoneVisible ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-item-hover hover:text-foreground'
            )}
          >
            <IconShieldHalf className="h-[18px] w-[18px]" />
          </button>
        </Hint>
        <Hint side="right" label="Automatic borders - auto-border, walls, tables, carpets, mountains (Ctrl+A)">
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
