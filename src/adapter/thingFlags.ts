import { Thing } from '~/domain/thing';
import { mapClientIds } from '~/adapter/assets';

export const THING_FLAGS = [
  'isGround',
  'isGroundBorder',
  'isOnBottom',
  'isOnTop',
  'isContainer',
  'stackable',
  'pickupable',
  'isUnpassable',
  'isUnmoveable',
  'blockMissile',
  'blockPathfind',
  'writable',
  'writableOnce',
  'isFluidContainer',
  'isFluid',
  'hangable',
  'isVertical',
  'isHorizontal',
  'rotatable',
  'hasLight',
  'floorChange',
  'isTranslucent',
  'hasOffset',
  'hasElevation',
  'isLyingObject',
  'animateAlways',
  'forceUse',
  'multiUse',
  'usable',
  'cloth',
  'isMarketItem',
  'hasDefaultAction',
  'dontHide',
  'miniMap'
] as const;

export type ThingFlag = (typeof THING_FLAGS)[number];

export const FLAG_LABELS: Record<ThingFlag, string> = {
  isGround: 'Ground',
  isGroundBorder: 'Ground border',
  isOnBottom: 'On bottom',
  isOnTop: 'On top',
  isContainer: 'Container',
  stackable: 'Stackable',
  pickupable: 'Pickupable',
  isUnpassable: 'Unpassable',
  isUnmoveable: 'Unmovable',
  blockMissile: 'Blocks missiles',
  blockPathfind: 'Blocks path',
  writable: 'Writable',
  writableOnce: 'Readable',
  isFluidContainer: 'Fluid container',
  isFluid: 'Splash / fluid',
  hangable: 'Hangable',
  isVertical: 'Hook east',
  isHorizontal: 'Hook south',
  rotatable: 'Rotatable',
  hasLight: 'Has light',
  floorChange: 'Floor change',
  isTranslucent: 'Translucent',
  hasOffset: 'Has offset',
  hasElevation: 'Has elevation',
  isLyingObject: 'Lying object',
  animateAlways: 'Always animate',
  forceUse: 'Force use',
  multiUse: 'Multi use',
  usable: 'Usable',
  cloth: 'Equipable',
  isMarketItem: 'Market item',
  hasDefaultAction: 'Default action',
  dontHide: "Don't hide",
  miniMap: 'On minimap'
};

export type FlagIndex = Map<string, number[]>;

export async function buildFlagIndex(serverIds: number[], items: Map<number, Thing>): Promise<FlagIndex> {
  const index: FlagIndex = new Map(THING_FLAGS.map((f) => [f, []]));
  if (!serverIds.length) return index;
  const clientIds = await mapClientIds(serverIds);
  serverIds.forEach((sid, i) => {
    const thing = items.get(clientIds[i] ?? 0) as unknown as Record<string, unknown> | undefined;
    if (!thing) return;
    for (const f of THING_FLAGS) {
      const hit = f === 'isGround' ? thing.isGround || thing.isFullGround : thing[f];
      if (hit) index.get(f)!.push(sid);
    }
  });
  return index;
}
