import type { ThingCategory } from '~/lib/formats/tibia/types';

export type ThingAttrs = Record<string, number | boolean | string>;

export interface Thing {
  id: number;
  width: number;
  height: number;
  layers: number;
  frames: number;
  patternX: number;
  patternY: number;
  patternZ: number;
  offsetX: number;
  offsetY: number;
  elevation: number;
  groundSpeed: number;
  exactSize: number;
  spriteIndex: number[];
  isGround: boolean;
  isGroundBorder: boolean;
  isOnBottom: boolean;
  isOnTop: boolean;
  hasOffset: boolean;
  hasElevation: boolean;
  stackable: boolean;
  isUnpassable: boolean;
  miniMap: boolean;
  miniMapColor: number;
  category: ThingCategory;
  attrs?: ThingAttrs;
}
