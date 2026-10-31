import type { AptFunction } from '../../../../formats/apt/aptBytecode';
import { callFromFrame, toAvmString } from '../calls';
import { getMember } from '../displayObjects';
import { getClipObject, getPrimitiveProto } from '../objects';
import { pop, popArgs, push, readPoolItem } from '../operands';
import { AsObject } from '../value';
import type { Value } from '../value';
import {
  defineLocal,
  lookupVariable,
  resolveName,
  setVariable,
} from '../variables';
import type { Frame, Operation, OperationGroup, VmState } from '../vmState';

const callNamed = (
  vm: VmState,
  frame: Frame,
  name: string,
  args: Value[],
): Value => {
  const found = lookupVariable(vm, frame, name);
  const self =
    found.on ?? (frame.target ? getClipObject(vm, frame.target) : undefined);

  return callFromFrame(vm, frame, found.value, self, args, name);
};

/** Names a method `owner.method` for the engine panel, naming the owner where it can */
const nameMethod = (vm: VmState, object: AsObject, method: string): string => {
  for (const [name, value] of vm.global.entries()) {
    if (value === object) {
      return `${name}.${method}`;
    }
  }
  return method;
};

const callMethod = (
  vm: VmState,
  frame: Frame,
  object: Value,
  name: Value,
  args: Value[],
): Value => {
  if (object === undefined || object === null) {
    return undefined;
  }

  const method = name === undefined ? '' : toAvmString(vm, name);

  if (!method) {
    return callFromFrame(vm, frame, object, undefined, args, '<blank>');
  }

  const callee = getMember(vm, object, method);
  // A method nothing defines on an object nothing defines is the engine's
  const label =
    callee === undefined &&
    object instanceof AsObject &&
    object.kind.type !== 'clip'
      ? nameMethod(vm, object, method)
      : method;

  return callFromFrame(vm, frame, callee, object, args, label);
};

const construct = (
  vm: VmState,
  frame: Frame,
  ctor: Value,
  args: Value[],
  name: string,
): Value => {
  const prototype = getMember(vm, ctor, 'prototype');
  const made = new AsObject(
    prototype instanceof AsObject ? prototype : vm.protos.object,
  );

  made.define('constructor', ctor);

  const result = callFromFrame(vm, frame, ctor, made, args, name);

  return result instanceof AsObject ? result : made;
};

/** Sends a call's result where its opcode says: pushed, dropped, or into a named variable */
const deliver = (
  vm: VmState,
  frame: Frame,
  name: string,
  value: Value,
): void => {
  if (name.endsWith('Pop')) {
    return;
  }
  if (name.startsWith('EA_Call')) {
    setVariable(vm, frame, toAvmString(vm, pop(frame)), value);
    return;
  }
  push(frame, value);
};

const defineFunction: Operation = (vm, frame, { operand }) => {
  const def = operand as AptFunction;
  const prototype = new AsObject(vm.protos.object);
  const fn = new AsObject(vm.protos.function, {
    type: 'function',
    fn: {
      def,
      scope: frame.scope,
      pool: frame.pool,
      movie: frame.movie,
      base: frame.base,
    },
  });

  fn.define('prototype', prototype);
  prototype.define('constructor', fn);
  if (def.name) {
    defineLocal(vm, frame, def.name, fn);
  } else {
    push(frame, fn);
  }
  return undefined;
};

const callFunctionOnStack: Operation = (vm, frame, { name }) => {
  const callee = toAvmString(vm, pop(frame));

  deliver(vm, frame, name, callNamed(vm, frame, callee, popArgs(frame)));
  return undefined;
};

const callFunctionInPool: Operation = (vm, frame, { name, operand }) => {
  const callee = toAvmString(vm, readPoolItem(frame, operand as number));

  deliver(vm, frame, name, callNamed(vm, frame, callee, popArgs(frame)));
  return undefined;
};

const callMethodOnStack: Operation = (vm, frame, { name }) => {
  const method = pop(frame);
  const object = pop(frame);

  deliver(
    vm,
    frame,
    name,
    callMethod(vm, frame, object, method, popArgs(frame)),
  );
  return undefined;
};

const callMethodInPool: Operation = (vm, frame, { name, operand }) => {
  const method = readPoolItem(frame, operand as number);
  const object = pop(frame);

  deliver(
    vm,
    frame,
    name,
    callMethod(vm, frame, object, method, popArgs(frame)),
  );
  return undefined;
};

/** Defining, calling and constructing functions */
export const FUNCTION_OPS: OperationGroup = {
  DefineFunction: defineFunction,
  DefineFunction2: defineFunction,
  CallFunction: callFunctionOnStack,
  EA_CallFunction: callFunctionOnStack,
  EA_CallFunctionPop: callFunctionOnStack,
  EA_CallNamedFunction: callFunctionInPool,
  EA_CallNamedFunctionPop: callFunctionInPool,
  CallMethod: callMethodOnStack,
  EA_CallMethod: callMethodOnStack,
  EA_CallMethodPop: callMethodOnStack,
  EA_CallNamedMethod: callMethodInPool,
  EA_CallNamedMethodPop: callMethodInPool,
  New: (vm, frame) => {
    const ctorName = toAvmString(vm, pop(frame));
    const args = popArgs(frame);

    push(
      frame,
      construct(
        vm,
        frame,
        resolveName(vm, frame, ctorName).value,
        args,
        ctorName,
      ),
    );
    return undefined;
  },
  NewMethod: (vm, frame) => {
    const method = pop(frame);
    const object = pop(frame);
    const args = popArgs(frame);

    if (object === undefined || object === null) {
      push(frame, undefined);
    } else {
      const key = method === undefined ? '' : toAvmString(vm, method);

      push(
        frame,
        construct(
          vm,
          frame,
          key ? getMember(vm, object, key) : object,
          args,
          key,
        ),
      );
    }
    return undefined;
  },
  InstanceOf: (vm, frame) => {
    const ctor = pop(frame);
    const object = pop(frame);
    const prototype = getMember(vm, ctor, 'prototype');
    let found = false;

    for (
      let at =
          object instanceof AsObject
            ? object.proto
            : getPrimitiveProto(vm, object),
        hops = 0;
      at && hops < 256;
      at = at.proto, hops++
    ) {
      if (at === prototype) {
        found = true;
        break;
      }
    }
    push(frame, found);
    return undefined;
  },
};
