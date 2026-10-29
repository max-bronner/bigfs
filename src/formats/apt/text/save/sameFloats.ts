import { f32Bits } from '../numbers';

/** Whether two lists of floats hold the same 32-bit floats */
export const sameFloats = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length &&
  a.every((value, index) => f32Bits(value) === f32Bits(b[index]));

/** Whether two optional floats are the same 32-bit float, or both missing */
export const sameFloat = (a: number | undefined, b: number | undefined) =>
  a === undefined || b === undefined ? a === b : f32Bits(a) === f32Bits(b);
