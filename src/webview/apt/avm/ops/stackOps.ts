import {
  peek,
  pop,
  push,
  readConstItem,
  readPoolItem,
  readRegister,
  writeRegister,
} from '../operands';
import type { Value } from '../value';
import type { Operation, OperationGroup } from '../vmState';

const pushConstant =
  (value: Value): Operation =>
  (_vm, frame) => {
    push(frame, value);
    return undefined;
  };

const pushOperand: Operation = (_vm, frame, { operand }) => {
  push(frame, operand as number | string);
  return undefined;
};

const pushPoolItem: Operation = (_vm, frame, { operand }) => {
  push(frame, readPoolItem(frame, operand as number));
  return undefined;
};

/** Pushes and the operand stack, the constant pool and the registers */
export const STACK_OPS: OperationGroup = {
  EA_PushZero: pushConstant(0),
  EA_PushOne: pushConstant(1),
  EA_PushTrue: pushConstant(true),
  EA_PushFalse: pushConstant(false),
  EA_PushNull: pushConstant(null),
  EA_PushUndefined: pushConstant(undefined),
  EA_PushByte: pushOperand,
  EA_PushShort: pushOperand,
  EA_PushLong: pushOperand,
  EA_PushFloat: pushOperand,
  EA_PushString: pushOperand,
  EA_PushThis: (_vm, frame) => {
    push(frame, frame.self);
    return undefined;
  },
  EA_PushGlobal: (vm, frame) => {
    push(frame, vm.global);
    return undefined;
  },
  EA_PushConstant: pushPoolItem,
  EA_PushWordConstant: pushPoolItem,
  EA_PushRegister: (vm, frame, { operand }) => {
    push(frame, readRegister(vm, frame, operand as number));
    return undefined;
  },
  PushData: (vm, frame, { operand }) => {
    for (const at of operand as number[]) {
      const item = readConstItem(frame, at);

      // A number item is a register (apt-format.md, "PushData pushes a register")
      push(
        frame,
        typeof item === 'number' && item >= 0
          ? readRegister(vm, frame, item)
          : item,
      );
    }
    return undefined;
  },
  ConstantPool: (_vm, frame, { operand }) => {
    frame.pool = (operand as number[]).map((at) => readConstItem(frame, at));
    return undefined;
  },
  Pop: (_vm, frame) => {
    pop(frame);
    return undefined;
  },
  Dup: (_vm, frame) => {
    push(frame, peek(frame));
    return undefined;
  },
  Swap: (_vm, frame) => {
    const a = pop(frame);
    const b = pop(frame);

    push(frame, a);
    push(frame, b);
    return undefined;
  },
  SetRegister: (vm, frame, { operand }) => {
    writeRegister(vm, frame, operand as number, peek(frame));
    return undefined;
  },
};
