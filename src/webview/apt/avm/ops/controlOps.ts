import { pop } from '../operands';
import { toBoolean } from '../value';
import type { Operation, OperationGroup } from '../vmState';

const jump: Operation = (_vm, frame, { target }) => {
  frame.jumpTo = target;
  return 'jump';
};

/** Ending code and branching */
export const CONTROL_OPS: OperationGroup = {
  End: () => 'end',
  Return: (_vm, frame) => {
    frame.returnValue = pop(frame);
    return 'return';
  },
  BranchAlways: jump,
  BranchIfTrue: (vm, frame, instruction) =>
    toBoolean(pop(frame)) ? jump(vm, frame, instruction) : undefined,
  EA_BranchIfFalse: (vm, frame, instruction) =>
    toBoolean(pop(frame)) ? undefined : jump(vm, frame, instruction),
};
