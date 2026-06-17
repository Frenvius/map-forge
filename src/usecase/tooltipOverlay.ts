import { TileTooltip } from '~/domain/map';
import { TooltipTypes } from '~/domain/tooltips';

export interface TooltipField {
  label: string;
  value: string;
}

export interface TooltipTheme {
  bg: string;
  border: string;
  label: string;
  value: string;
  shadow: string;
}

const FONT_SIZE = 11;
const LINE_HEIGHT = 15;
const PAD_X = 9;
const PAD_Y = 7;
const FIELD_GAP = 4;
const MIN_WIDTH = 78;
const MAX_WIDTH = 248;
const CORNER = 6;

export function resolveTooltipTheme(): TooltipTheme {
  const s = getComputedStyle(document.documentElement);
  const v = (n: string) => s.getPropertyValue(n).trim();
  return {
    bg: `hsl(${v('--card')} / 0.97)`,
    border: `hsl(${v('--border')})`,
    label: `hsl(${v('--muted-foreground')})`,
    value: `hsl(${v('--primary')})`,
    shadow: 'rgba(0, 0, 0, 0.45)'
  };
}

export function buildTooltipFields(tt: TileTooltip, types: TooltipTypes): TooltipField[] {
  const fields: TooltipField[] = [];
  if (types.actionId && tt.actionId > 0) fields.push({ label: 'Action ID', value: String(tt.actionId) });
  if (types.uniqueId && tt.uniqueId > 0) fields.push({ label: 'Unique ID', value: String(tt.uniqueId) });
  if (types.doorId && tt.doorId > 0) fields.push({ label: 'Door ID', value: String(tt.doorId) });
  if (types.description && tt.desc) fields.push({ label: 'Description', value: tt.desc });
  if (types.text && tt.text) fields.push({ label: 'Text', value: `"${tt.text}"` });
  return fields;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  if (ctx.measureText(text).width <= maxWidth) return [text];
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(next).width <= maxWidth || !cur) {
      cur = next;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

const VERTICAL_OFFSET = 8;

interface TooltipRow {
  text: string;
  kind: 'label' | 'value';
  gap: number;
}

export interface TooltipBox {
  x: number;
  y: number;
  width: number;
  height: number;
  rows: TooltipRow[];
}

function setFont(ctx: CanvasRenderingContext2D) {
  ctx.font = `${FONT_SIZE}px ui-sans-serif, system-ui, sans-serif`;
}

export function layoutTooltip(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  fields: TooltipField[]
): TooltipBox | null {
  if (fields.length === 0) return null;
  setFont(ctx);

  const valueMax = MAX_WIDTH - PAD_X * 2;
  const rows: TooltipRow[] = [];
  let textW = 0;
  fields.forEach((f, fi) => {
    const lines = wrap(ctx, f.value, valueMax);
    textW = Math.max(textW, ctx.measureText(f.label).width);
    rows.push({ text: f.label, kind: 'label', gap: fi === 0 ? 0 : FIELD_GAP });
    for (const line of lines) {
      textW = Math.max(textW, ctx.measureText(line).width);
      rows.push({ text: line, kind: 'value', gap: 0 });
    }
  });

  const width = Math.ceil(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, textW + PAD_X * 2)));
  const height = rows.length * LINE_HEIGHT + rows.reduce((sum, r) => sum + r.gap, 0) + PAD_Y * 2;
  const x = Math.round(centerX - width / 2);
  const y = Math.round(centerY - height - VERTICAL_OFFSET);
  return { x, y, width, height, rows };
}

export function drawTooltipBox(ctx: CanvasRenderingContext2D, box: TooltipBox, theme: TooltipTheme) {
  const { x, y, width, height, rows } = box;
  setFont(ctx);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, CORNER);
  ctx.fillStyle = theme.bg;
  ctx.shadowColor = theme.shadow;
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 3;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.lineWidth = 1;
  ctx.strokeStyle = theme.border;
  ctx.stroke();
  ctx.restore();

  const cx = Math.round(x + width / 2);
  let ty = y + PAD_Y + LINE_HEIGHT / 2;
  for (const r of rows) {
    ty += r.gap;
    ctx.fillStyle = r.kind === 'label' ? theme.label : theme.value;
    ctx.fillText(r.text, cx, ty);
    ty += LINE_HEIGHT;
  }
  ctx.textAlign = 'left';
}
