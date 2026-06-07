export type ToolId = 'select' | 'brush' | 'eraser';

export interface ToolMeta {
  id: ToolId;
  label: string;
}

export const TOOLS: ToolMeta[] = [
  { id: 'select', label: 'Select' },
  { id: 'brush', label: 'Brush' },
  { id: 'eraser', label: 'Eraser' }
];
