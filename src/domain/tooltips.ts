export interface TooltipTypes {
  actionId: boolean;
  uniqueId: boolean;
  doorId: boolean;
  description: boolean;
  text: boolean;
}

export type TooltipTypeKey = keyof TooltipTypes;

export const DEFAULT_TOOLTIP_TYPES: TooltipTypes = {
  actionId: true,
  uniqueId: true,
  doorId: false,
  description: true,
  text: true
};

export const TOOLTIP_TYPE_GROUPS: { keys: TooltipTypeKey[]; label: string }[] = [
  { keys: ['actionId', 'uniqueId'], label: 'Action / Unique ID' },
  { keys: ['doorId'], label: 'Door ID' },
  { keys: ['description', 'text'], label: 'Text' }
];
