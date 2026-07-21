export interface FluidType {
  value: number;
  name: string;
}

export const TIBIA_FLUIDS: FluidType[] = [
  { value: 0, name: 'None' },
  { value: 1, name: 'Water' },
  { value: 2, name: 'Blood' },
  { value: 3, name: 'Beer' },
  { value: 4, name: 'Slime' },
  { value: 5, name: 'Lemonade' },
  { value: 6, name: 'Milk' },
  { value: 7, name: 'Mana' },
  { value: 10, name: 'Life' },
  { value: 11, name: 'Oil' },
  { value: 13, name: 'Urine' },
  { value: 14, name: 'Coconut Milk' },
  { value: 15, name: 'Wine' },
  { value: 19, name: 'Mud' },
  { value: 21, name: 'Fruit Juice' },
  { value: 26, name: 'Lava' },
  { value: 27, name: 'Rum' },
  { value: 28, name: 'Swamp' },
  { value: 35, name: 'Tea' },
  { value: 43, name: 'Mead' }
];

export function fluidName(value: number): string {
  return TIBIA_FLUIDS.find((f) => f.value === value)?.name ?? `#${value}`;
}
