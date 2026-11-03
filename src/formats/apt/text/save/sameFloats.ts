import { toF32Bits } from '../numbers';

/** Whether two lists of floats hold the same 32-bit floats */
export const areSameFloats = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length &&
  a.every((value, index) => toF32Bits(value) === toF32Bits(b[index]));

/** Whether two optional floats are the same 32-bit float, or both missing */
export const isSameFloat = (a: number | undefined, b: number | undefined) =>
  a === undefined || b === undefined ? a === b : toF32Bits(a) === toF32Bits(b);
