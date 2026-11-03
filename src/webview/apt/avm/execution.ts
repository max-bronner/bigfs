import type { AptInstruction } from '../../../formats/apt/aptBytecode';
import { Halt } from './halt';
import type { Value } from './value';
import type { Frame, VmState } from './vmState';

/** Instructions a top-level action may run, nested calls included */
export const MAX_STEPS = 100_000;

/** Instruction index by offset, per code array, for branches */
const indexes = new WeakMap<AptInstruction[], Map<number, number>>();

const indexOf = (code: AptInstruction[]) => {
  let index = indexes.get(code);

  if (!index) {
    index = new Map(code.map((instruction, at) => [instruction.offset, at]));
    indexes.set(code, index);
  }
  return index;
};

/** Runs code on a frame to its end or a `Return`, drawing on the step budget */
export const execute = (
  vm: VmState,
  code: AptInstruction[],
  frame: Frame,
): { returned: boolean; value?: Value } => {
  const index = indexOf(code);
  const { operations } = vm;
  // An unload handler runs on a clip already taken off; only a removal
  // during this code stops it
  const wasRemoved = frame.base?.removed;

  for (let pc = 0; pc < code.length; ) {
    if (--vm.budget < 0) {
      throw new Halt(`over ${MAX_STEPS} instructions in one action`);
    }

    const instruction = code[pc++];
    const operation = operations.get(instruction.name);

    if (!operation) {
      throw new Halt(`${instruction.name} is not run by the preview`);
    }

    const outcome = operation(vm, frame, instruction);

    if (outcome === 'end') {
      return { returned: false };
    }
    if (outcome === 'return') {
      return { returned: true, value: frame.returnValue };
    }
    if (outcome === 'jump') {
      // A branch without a target halts below, like one that lands badly
      const jumpTo = frame.jumpTo as number;
      const to = index.get(jumpTo);

      if (to === undefined) {
        if (jumpTo >= (code.at(-1)?.offset ?? 0)) {
          return { returned: false };
        }
        throw new Halt(`a branch to ${jumpTo} lands mid-instruction`);
      }
      pc = to;
    }
    // Code of a clip that was removed stops (Ruffle continue_if_base_clip_exists)
    if (frame.base?.removed && !wasRemoved) {
      return { returned: false };
    }
  }
  return { returned: false };
};
