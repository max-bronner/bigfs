import { toAvmString } from '../calls';
import { getMember } from '../displayObjects';
import { setMember } from '../memberWrites';
import { createArray, getClipOf } from '../objects';
import { pop, popCount, push, readPoolItem } from '../operands';
import { AsObject } from '../value';
import type { Value } from '../value';
import { getVariable } from '../variables';
import type { Frame, OperationGroup } from '../vmState';

/** Pushes the end marker and a value's names, as `for..in` walks them */
const enumerate = (frame: Frame, value: Value): void => {
  push(frame, undefined);
  if (!(value instanceof AsObject)) {
    return;
  }

  const keys: string[] = [];
  const seen = new Set<string>();
  const chain: AsObject[] = [];

  for (
    let at: AsObject | undefined = value;
    at && chain.length < 256;
    at = at.proto
  ) {
    chain.push(at);
  }
  for (const object of chain.reverse()) {
    for (const key of object.keys()) {
      if (!seen.has(key.toLowerCase())) {
        seen.add(key.toLowerCase());
        keys.push(key);
      }
    }
  }

  const clip = getClipOf(value);

  for (const child of clip ? [...clip.children.values()].reverse() : []) {
    if (child.name) {
      keys.push(child.name);
    }
  }
  for (const key of keys.reverse()) {
    push(frame, key);
  }
};

/** Object and array members, literals and enumeration */
export const MEMBER_OPS: OperationGroup = {
  GetMember: (vm, frame) => {
    const key = toAvmString(vm, pop(frame));

    push(frame, getMember(vm, pop(frame), key));
    return undefined;
  },
  SetMember: (vm, frame) => {
    const value = pop(frame);
    const key = toAvmString(vm, pop(frame));

    setMember(vm, pop(frame), key, value);
    return undefined;
  },
  EA_GetNamedMember: (vm, frame, { operand }) => {
    const object = pop(frame);
    const key = toAvmString(vm, readPoolItem(frame, operand as number));

    push(frame, getMember(vm, object, key));
    return undefined;
  },
  EA_GetStringMember: (vm, frame, { operand }) => {
    push(frame, getMember(vm, pop(frame), operand as string));
    return undefined;
  },
  EA_SetStringMember: (vm, frame, { operand }) => {
    const key = toAvmString(vm, pop(frame));

    setMember(vm, pop(frame), key, operand as string);
    return undefined;
  },
  InitObject: (vm, frame) => {
    const count = popCount(frame);
    const object = vm.object();

    for (let at = 0; at < count; at++) {
      const value = pop(frame);

      setMember(vm, object, toAvmString(vm, pop(frame)), value);
    }
    push(frame, object);
    return undefined;
  },
  InitArray: (vm, frame) => {
    const count = popCount(frame);
    const values = Array.from({ length: count }, () => pop(frame));

    push(frame, createArray(vm, values));
    return undefined;
  },
  Enumerate: (vm, frame) => {
    const path = toAvmString(vm, pop(frame));

    enumerate(frame, getVariable(vm, frame, path).value);
    return undefined;
  },
  Enumerate2: (_vm, frame) => {
    enumerate(frame, pop(frame));
    return undefined;
  },
};
