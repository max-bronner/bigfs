import { toAvmString } from '../calls';
import { pop, push, readPoolItem } from '../operands';
import { AsObject } from '../value';
import type { Scope } from '../value';
import { defineLocal, getVariable, setVariable } from '../variables';
import type { OperationGroup } from '../vmState';

/** Reading, writing and deleting variables */
export const VARIABLE_OPS: OperationGroup = {
  GetVariable: (vm, frame) => {
    const path = toAvmString(vm, pop(frame));

    push(frame, getVariable(vm, frame, path).value);
    return undefined;
  },
  SetVariable: (vm, frame) => {
    const value = pop(frame);
    const target = toAvmString(vm, pop(frame));

    if (target.toLowerCase() === 'this') {
      frame.self = value;
    } else {
      setVariable(vm, frame, target, value);
    }
    return undefined;
  },
  EA_PushValueOfVar: (vm, frame, { operand }) => {
    const path = toAvmString(vm, readPoolItem(frame, operand as number));

    push(frame, getVariable(vm, frame, path).value);
    return undefined;
  },
  EA_GetStringVar: (vm, frame, { operand }) => {
    push(frame, getVariable(vm, frame, operand as string).value);
    return undefined;
  },
  EA_SetStringVar: (vm, frame, { operand }) => {
    setVariable(vm, frame, toAvmString(vm, pop(frame)), operand as string);
    return undefined;
  },
  EA_ZeroVariable: (vm, frame) => {
    setVariable(vm, frame, toAvmString(vm, pop(frame)), 0);
    return undefined;
  },
  DefineLocal: (vm, frame) => {
    const value = pop(frame);

    defineLocal(vm, frame, toAvmString(vm, pop(frame)), value);
    return undefined;
  },
  Var: (vm, frame) => {
    const local = toAvmString(vm, pop(frame));

    if (!frame.scope.values.has(local)) {
      defineLocal(vm, frame, local, undefined);
    }
    return undefined;
  },
  Delete: (vm, frame) => {
    const key = toAvmString(vm, pop(frame));
    const object = pop(frame);

    push(frame, object instanceof AsObject && object.delete(key));
    return undefined;
  },
  Delete2: (vm, frame) => {
    const key = toAvmString(vm, pop(frame));
    let removed = false;

    for (
      let scope: Scope | undefined = frame.scope;
      scope && !removed;
      scope = scope.parent
    ) {
      removed = scope.values.delete(key);
    }
    push(frame, removed);
    return undefined;
  },
};
