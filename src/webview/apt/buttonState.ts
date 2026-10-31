/** Button up state, as record flags and event dispatch use it */
export const UP = 1;
/** Button over state: the pointer is on it */
export const OVER = 2;
/** Button down state: the pointer is pressed on it */
export const DOWN = 4;
/** Button hit state: the record is the pressable area, never drawn */
export const HIT = 8;

/** SWF button conditions, bit by bit (mint's apt-format research) */
export const CONDITION = {
  rollOver: 0x1,
  rollOut: 0x2,
  press: 0x4,
  release: 0x8,
  releaseOutside: 0x40,
};
