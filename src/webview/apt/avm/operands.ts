import { Halt } from './halt';
import { toNumber } from './value';
import type { Value } from './value';
import type { Frame, VmState } from './vmState';

/** Operand stack, register and constant access of a running frame, with the bounds a movie cannot pass */

const MAX_STACK = 1024;
const MAX_STRING = 65_536;

/** Pushes a value on the operand stack */
export const push = (frame: Frame, value: Value): void => {
  if (frame.stack.length >= MAX_STACK) {
    throw new Halt('the operand stack overflowed');
  }
  frame.stack.push(value);
};

/** Pops a value off the operand stack */
export const pop = (frame: Frame): Value => {
  if (!frame.stack.length) {
    throw new Halt('the operand stack ran out');
  }
  return frame.stack.pop();
};

/** Gets the value on top of the operand stack, leaving it there */
export const peek = (frame: Frame): Value => {
  if (!frame.stack.length) {
    throw new Halt('the operand stack ran out');
  }
  return frame.stack[frame.stack.length - 1];
};

/** Pops a count, bounded so it cannot size a runaway loop */
export const popCount = (frame: Frame): number => {
  const n = toNumber(pop(frame));

  if (!(n >= 0 && n <= 65_536)) {
    throw new Halt('an argument count out of range');
  }
  return Math.trunc(n);
};

/** Pops a count and then that many values */
export const popArgs = (frame: Frame): Value[] => {
  const count = popCount(frame);

  return Array.from({ length: count }, () => pop(frame));
};

/** Reads a register of the frame's function, or the machine's outside one */
export const readRegister = (
  vm: VmState,
  frame: Frame,
  index: number,
): Value => (frame.registers ?? vm.registers)[index];

/** Writes a register of the frame's function, or the machine's outside one */
export const writeRegister = (
  vm: VmState,
  frame: Frame,
  index: number,
  value: Value,
): void => {
  if (index < 0 || index >= 256) {
    throw new Halt('a register index out of range');
  }
  (frame.registers ?? vm.registers)[index] = value;
};

/** Reads an item of the movie's `.const` file */
export const readConstItem = (frame: Frame, index: number): Value => {
  const consts = frame.movie.consts ?? [];

  if (index < 0 || index >= consts.length) {
    throw new Halt(`constant ${index} is not in the .const file`);
  }
  return consts[index];
};

/** Reads an entry of the constant pool in force */
export const readPoolItem = (frame: Frame, index: number): Value => {
  if (index < 0 || index >= frame.pool.length) {
    throw new Halt(`pool entry ${index} was never set`);
  }
  return frame.pool[index];
};

/** Joins two strings, bounded so a loop cannot grow one without end */
export const concatStrings = (a: string, b: string): string => {
  if (a.length + b.length > MAX_STRING) {
    throw new Halt('a string grew too long');
  }
  return a + b;
};
