import { ThingType, ThingCategory, createThingType } from '~/lib/formats/tibia/types';

const FLAG_IS_GROUND = 1 << 0;
const FLAG_IS_GROUND_BORDER = 1 << 1;
const FLAG_IS_ON_BOTTOM = 1 << 2;
const FLAG_IS_ON_TOP = 1 << 3;
const FLAG_IS_CONTAINER = 1 << 4;
const FLAG_STACKABLE = 1 << 5;
const FLAG_FORCE_USE = 1 << 6;
const FLAG_MULTI_USE = 1 << 7;
const FLAG_HAS_CHARGES = 1 << 8;
const FLAG_WRITABLE = 1 << 9;
const FLAG_WRITABLE_ONCE = 1 << 10;
const FLAG_IS_FLUID_CONTAINER = 1 << 11;
const FLAG_IS_FLUID = 1 << 12;
const FLAG_IS_UNPASSABLE = 1 << 13;
const FLAG_IS_UNMOVEABLE = 1 << 14;
const FLAG_BLOCK_MISSILE = 1 << 15;
const FLAG_BLOCK_PATHFIND = 1 << 16;
const FLAG_NO_MOVE_ANIMATION = 1 << 17;
const FLAG_PICKUPABLE = 1 << 18;
const FLAG_HANGABLE = 1 << 19;
const FLAG_IS_VERTICAL = 1 << 20;
const FLAG_IS_HORIZONTAL = 1 << 21;
const FLAG_ROTATABLE = 1 << 22;
const FLAG_HAS_LIGHT = 1 << 23;
const FLAG_DONT_HIDE = 1 << 24;
const FLAG_FLOOR_CHANGE = 1 << 25;
const FLAG_IS_TRANSLUCENT = 1 << 26;
const FLAG_HAS_OFFSET = 1 << 27;
const FLAG_HAS_ELEVATION = 1 << 28;
const FLAG_IS_LYING_OBJECT = 1 << 29;
const FLAG_ANIMATE_ALWAYS = 1 << 30;
const FLAG_MINI_MAP = 1 << 31;

const FLAG_IS_LENS_HELP_HIGH = 1 << 0;
const FLAG_IS_FULL_GROUND_HIGH = 1 << 1;
const FLAG_IGNORE_LOOK_HIGH = 1 << 2;
const FLAG_CLOTH_HIGH = 1 << 3;
const FLAG_IS_MARKET_ITEM_HIGH = 1 << 4;
const FLAG_HAS_DEFAULT_ACTION_HIGH = 1 << 5;
const FLAG_USABLE_HIGH = 1 << 6;
const FLAG_WRAPPABLE_HIGH = 1 << 7;
const FLAG_UNWRAPPABLE_HIGH = 1 << 8;
const FLAG_TOP_EFFECT_HIGH = 1 << 9;
const FLAG_IS_ANIMATION_HIGH = 1 << 10;
const FLAG_HAS_BONES_HIGH = 1 << 11;

export interface DatParseResult {
  signature: number;
  itemsCount: number;
  outfitsCount: number;
  effectsCount: number;
  missilesCount: number;
  items: Map<number, ThingType>;
  outfits: Map<number, ThingType>;
  effects: Map<number, ThingType>;
  missiles: Map<number, ThingType>;
}

export function decodeDatResponse(buffer: Uint8Array): DatParseResult {
  if (!buffer || buffer.byteLength < 20) {
    throw new Error(`Invalid DAT response: buffer is ${buffer?.byteLength || 0} bytes (expected at least 20)`);
  }

  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let offset = 0;

  const signature = view.getUint32(offset, true);
  offset += 4;
  const itemsCount = view.getUint32(offset, true);
  offset += 4;
  const outfitsCount = view.getUint32(offset, true);
  offset += 4;
  const effectsCount = view.getUint32(offset, true);
  offset += 4;
  const missilesCount = view.getUint32(offset, true);
  offset += 4;

  const items = new Map<number, ThingType>();
  const outfits = new Map<number, ThingType>();
  const effects = new Map<number, ThingType>();
  const missiles = new Map<number, ThingType>();

  for (let i = 0; i < itemsCount; i++) {
    try {
      const [thing, newOffset] = decodeThing(view, buffer, offset, ThingCategory.ITEM);
      items.set(thing.id, thing);
      offset = newOffset;
    } catch (e) {
      throw new Error(`Failed to decode item ${i + 1}/${itemsCount} at offset ${offset}: ${e}`);
    }
  }

  for (let i = 0; i < outfitsCount; i++) {
    try {
      const [thing, newOffset] = decodeThing(view, buffer, offset, ThingCategory.OUTFIT);
      outfits.set(thing.id, thing);
      offset = newOffset;
    } catch (e) {
      throw new Error(`Failed to decode outfit ${i + 1}/${outfitsCount} at offset ${offset}: ${e}`);
    }
  }

  for (let i = 0; i < effectsCount; i++) {
    try {
      const [thing, newOffset] = decodeThing(view, buffer, offset, ThingCategory.EFFECT);
      effects.set(thing.id, thing);
      offset = newOffset;
    } catch (e) {
      throw new Error(`Failed to decode effect ${i + 1}/${effectsCount} at offset ${offset}: ${e}`);
    }
  }

  for (let i = 0; i < missilesCount; i++) {
    try {
      const [thing, newOffset] = decodeThing(view, buffer, offset, ThingCategory.MISSILE);
      missiles.set(thing.id, thing);
      offset = newOffset;
    } catch (e) {
      throw new Error(`Failed to decode missile ${i + 1}/${missilesCount} at offset ${offset}: ${e}`);
    }
  }

  return {
    items,
    outfits,
    effects,
    missiles,
    signature,
    itemsCount,
    outfitsCount,
    effectsCount,
    missilesCount
  };
}

function decodeThing(view: DataView, buffer: Uint8Array, offset: number, category: ThingCategory): [ThingType, number] {
  const thing = createThingType(0, category);

  thing.id = view.getUint32(offset, true);
  offset += 4;
  thing.width = view.getUint8(offset);
  offset += 1;
  thing.height = view.getUint8(offset);
  offset += 1;
  thing.exactSize = view.getUint8(offset);
  offset += 1;
  thing.layers = view.getUint8(offset);
  offset += 1;
  thing.patternX = view.getUint8(offset);
  offset += 1;
  thing.patternY = view.getUint8(offset);
  offset += 1;
  thing.patternZ = view.getUint8(offset);
  offset += 1;
  thing.frames = view.getUint8(offset);
  offset += 1;

  const flagsLow = view.getUint32(offset, true);
  offset += 4;
  const flagsHigh = view.getUint32(offset, true);
  offset += 4;

  thing.isGround = (flagsLow & FLAG_IS_GROUND) !== 0;
  thing.isGroundBorder = (flagsLow & FLAG_IS_GROUND_BORDER) !== 0;
  thing.isOnBottom = (flagsLow & FLAG_IS_ON_BOTTOM) !== 0;
  thing.isOnTop = (flagsLow & FLAG_IS_ON_TOP) !== 0;
  thing.isContainer = (flagsLow & FLAG_IS_CONTAINER) !== 0;
  thing.stackable = (flagsLow & FLAG_STACKABLE) !== 0;
  thing.forceUse = (flagsLow & FLAG_FORCE_USE) !== 0;
  thing.multiUse = (flagsLow & FLAG_MULTI_USE) !== 0;
  thing.hasCharges = (flagsLow & FLAG_HAS_CHARGES) !== 0;
  thing.writable = (flagsLow & FLAG_WRITABLE) !== 0;
  thing.writableOnce = (flagsLow & FLAG_WRITABLE_ONCE) !== 0;
  thing.isFluidContainer = (flagsLow & FLAG_IS_FLUID_CONTAINER) !== 0;
  thing.isFluid = (flagsLow & FLAG_IS_FLUID) !== 0;
  thing.isUnpassable = (flagsLow & FLAG_IS_UNPASSABLE) !== 0;
  thing.isUnmoveable = (flagsLow & FLAG_IS_UNMOVEABLE) !== 0;
  thing.blockMissile = (flagsLow & FLAG_BLOCK_MISSILE) !== 0;
  thing.blockPathfind = (flagsLow & FLAG_BLOCK_PATHFIND) !== 0;
  thing.noMoveAnimation = (flagsLow & FLAG_NO_MOVE_ANIMATION) !== 0;
  thing.pickupable = (flagsLow & FLAG_PICKUPABLE) !== 0;
  thing.hangable = (flagsLow & FLAG_HANGABLE) !== 0;
  thing.isVertical = (flagsLow & FLAG_IS_VERTICAL) !== 0;
  thing.isHorizontal = (flagsLow & FLAG_IS_HORIZONTAL) !== 0;
  thing.rotatable = (flagsLow & FLAG_ROTATABLE) !== 0;
  thing.hasLight = (flagsLow & FLAG_HAS_LIGHT) !== 0;
  thing.dontHide = (flagsLow & FLAG_DONT_HIDE) !== 0;
  thing.floorChange = (flagsLow & FLAG_FLOOR_CHANGE) !== 0;
  thing.isTranslucent = (flagsLow & FLAG_IS_TRANSLUCENT) !== 0;
  thing.hasOffset = (flagsLow & FLAG_HAS_OFFSET) !== 0;
  thing.hasElevation = (flagsLow & FLAG_HAS_ELEVATION) !== 0;
  thing.isLyingObject = (flagsLow & FLAG_IS_LYING_OBJECT) !== 0;
  thing.animateAlways = (flagsLow & FLAG_ANIMATE_ALWAYS) !== 0;
  thing.miniMap = (flagsLow & FLAG_MINI_MAP) !== 0;

  thing.isLensHelp = (flagsHigh & FLAG_IS_LENS_HELP_HIGH) !== 0;
  thing.isFullGround = (flagsHigh & FLAG_IS_FULL_GROUND_HIGH) !== 0;
  thing.ignoreLook = (flagsHigh & FLAG_IGNORE_LOOK_HIGH) !== 0;
  thing.cloth = (flagsHigh & FLAG_CLOTH_HIGH) !== 0;
  thing.isMarketItem = (flagsHigh & FLAG_IS_MARKET_ITEM_HIGH) !== 0;
  thing.hasDefaultAction = (flagsHigh & FLAG_HAS_DEFAULT_ACTION_HIGH) !== 0;
  thing.usable = (flagsHigh & FLAG_USABLE_HIGH) !== 0;
  thing.wrappable = (flagsHigh & FLAG_WRAPPABLE_HIGH) !== 0;
  thing.unwrappable = (flagsHigh & FLAG_UNWRAPPABLE_HIGH) !== 0;
  thing.topEffect = (flagsHigh & FLAG_TOP_EFFECT_HIGH) !== 0;
  thing.isAnimation = (flagsHigh & FLAG_IS_ANIMATION_HIGH) !== 0;
  thing.hasBones = (flagsHigh & FLAG_HAS_BONES_HIGH) !== 0;

  const spriteCount = view.getUint16(offset, true);
  offset += 2;
  thing.spriteIndex = [];
  for (let i = 0; i < spriteCount; i++) {
    thing.spriteIndex.push(view.getUint32(offset, true));
    offset += 4;
  }

  if (thing.isGround) {
    thing.groundSpeed = view.getUint16(offset, true);
    offset += 2;
  }
  if (thing.hasLight) {
    thing.lightLevel = view.getUint16(offset, true);
    offset += 2;
    thing.lightColor = view.getUint16(offset, true);
    offset += 2;
  }
  if (thing.hasOffset) {
    thing.offsetX = view.getInt16(offset, true);
    offset += 2;
    thing.offsetY = view.getInt16(offset, true);
    offset += 2;
  }
  if (thing.hasElevation) {
    thing.elevation = view.getUint16(offset, true);
    offset += 2;
  }
  if (thing.miniMap) {
    thing.miniMapColor = view.getUint16(offset, true);
    offset += 2;
  }
  if (thing.isLensHelp) {
    thing.lensHelp = view.getUint16(offset, true);
    offset += 2;
  }
  if (thing.cloth) {
    thing.clothSlot = view.getUint16(offset, true);
    offset += 2;
  }
  if (thing.isMarketItem) {
    thing.marketCategory = view.getUint16(offset, true);
    offset += 2;
    thing.marketTradeAs = view.getUint16(offset, true);
    offset += 2;
    thing.marketShowAs = view.getUint16(offset, true);
    offset += 2;
    thing.marketRestrictProfession = view.getUint16(offset, true);
    offset += 2;
    thing.marketRestrictLevel = view.getUint16(offset, true);
    offset += 2;
    const nameLen = view.getUint16(offset, true);
    offset += 2;
    const nameBytes = buffer.slice(offset, offset + nameLen);
    thing.marketName = new TextDecoder().decode(nameBytes);
    offset += nameLen;
  }
  if (thing.hasDefaultAction) {
    thing.defaultAction = view.getUint16(offset, true);
    offset += 2;
  }
  if (thing.writable || thing.writableOnce) {
    thing.maxTextLength = view.getUint16(offset, true);
    offset += 2;
  }
  if (thing.hasBones) {
    thing.bonesOffsetX = [];
    thing.bonesOffsetY = [];
    for (let d = 0; d < 4; d++) {
      thing.bonesOffsetX.push(view.getInt16(offset, true));
      offset += 2;
      thing.bonesOffsetY.push(view.getInt16(offset, true));
      offset += 2;
    }
  }

  if (thing.isAnimation) {
    thing.animationMode = view.getUint8(offset);
    offset += 1;
    thing.loopCount = view.getInt32(offset, true);
    offset += 4;
    thing.startFrame = view.getInt8(offset);
    offset += 1;
    const durationCount = view.getUint8(offset);
    offset += 1;
    thing.frameDurations = [];
    for (let i = 0; i < durationCount; i++) {
      const minimum = view.getUint32(offset, true);
      offset += 4;
      const maximum = view.getUint32(offset, true);
      offset += 4;
      thing.frameDurations.push({ minimum, maximum });
    }
  }

  const hasFrameGroups = view.getUint8(offset);
  offset += 1;
  if (hasFrameGroups === 1) {
    const groupCount = view.getUint8(offset);
    offset += 1;
    thing.frameGroupsData = [];
    for (let g = 0; g < groupCount; g++) {
      const type = view.getUint8(offset);
      offset += 1;
      const width = view.getUint8(offset);
      offset += 1;
      const height = view.getUint8(offset);
      offset += 1;
      const exactSize = view.getUint8(offset);
      offset += 1;
      const layers = view.getUint8(offset);
      offset += 1;
      const patternX = view.getUint8(offset);
      offset += 1;
      const patternY = view.getUint8(offset);
      offset += 1;
      const patternZ = view.getUint8(offset);
      offset += 1;
      const frames = view.getUint8(offset);
      offset += 1;

      const groupSpriteCount = view.getUint16(offset, true);
      offset += 2;
      const spriteIndex: number[] = [];
      for (let i = 0; i < groupSpriteCount; i++) {
        spriteIndex.push(view.getUint32(offset, true));
        offset += 4;
      }

      const hasAnim = view.getUint8(offset);
      offset += 1;
      let isAnimation = false;
      let animationMode: number | undefined;
      let loopCount: number | undefined;
      let startFrame: number | undefined;
      let frameDurations: undefined | { minimum: number; maximum: number }[];
      if (hasAnim === 1) {
        isAnimation = true;
        animationMode = view.getUint8(offset);
        offset += 1;
        loopCount = view.getInt32(offset, true);
        offset += 4;
        startFrame = view.getInt8(offset);
        offset += 1;
        const durCount = view.getUint8(offset);
        offset += 1;
        frameDurations = [];
        for (let i = 0; i < durCount; i++) {
          const minimum = view.getUint32(offset, true);
          offset += 4;
          const maximum = view.getUint32(offset, true);
          offset += 4;
          frameDurations.push({ minimum, maximum });
        }
      }

      thing.frameGroupsData.push({
        type,
        width,
        height,
        layers,
        frames,
        patternX,
        patternY,
        patternZ,
        exactSize,
        loopCount,
        startFrame,
        spriteIndex,
        isAnimation,
        animationMode,
        frameDurations
      });
    }
  }

  return [thing, offset];
}
