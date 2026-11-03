import { toAvmString } from '../calls';
import { concatStrings, pop, push } from '../operands';
import {
  AsObject,
  looseEquals,
  toBoolean,
  toInt32,
  toNumber,
} from '../value';
import type { Value } from '../value';
import type { Operation, OperationGroup } from '../vmState';

const onNumbers =
  (combine: (a: number, b: number) => Value): Operation =>
  (_vm, frame) => {
    const b = toNumber(pop(frame));
    const a = toNumber(pop(frame));

    push(frame, combine(a, b));
    return undefined;
  };

const onIntegers =
  (combine: (x: number, y: number) => number): Operation =>
  (_vm, frame) => {
    const y = toInt32(pop(frame));
    const x = toInt32(pop(frame));

    push(frame, combine(x, y));
    return undefined;
  };

const onBooleans =
  (combine: (a: boolean, b: boolean) => boolean): Operation =>
  (_vm, frame) => {
    const b = toBoolean(pop(frame));
    const a = toBoolean(pop(frame));

    push(frame, combine(a, b));
    return undefined;
  };

const onStrings =
  (combine: (a: string, b: string) => Value): Operation =>
  (vm, frame) => {
    const b = toAvmString(vm, pop(frame));
    const a = toAvmString(vm, pop(frame));

    push(frame, combine(a, b));
    return undefined;
  };

/** Creates the `<` or `>` of AVM1: two strings compare as text, anything else as numbers */
const compareLoosely =
  (isGreater: boolean): Operation =>
  (_vm, frame) => {
    const b = pop(frame);
    const a = pop(frame);

    push(
      frame,
      typeof a === 'string' && typeof b === 'string'
        ? isGreater
          ? a > b
          : a < b
        : isGreater
          ? toNumber(a) > toNumber(b)
          : toNumber(a) < toNumber(b),
    );
    return undefined;
  };

const pushLength: Operation = (vm, frame) => {
  push(frame, [...toAvmString(vm, pop(frame))].length);
  return undefined;
};

const pushSubstring: Operation = (vm, frame) => {
  const count = toInt32(pop(frame));
  const at = toInt32(pop(frame));
  const from = [...toAvmString(vm, pop(frame))];

  push(
    frame,
    from
      .slice(Math.max(0, at - 1), Math.max(0, at - 1) + Math.max(0, count))
      .join(''),
  );
  return undefined;
};

const pushCodePoint: Operation = (vm, frame) => {
  push(frame, toAvmString(vm, pop(frame)).codePointAt(0) ?? 0);
  return undefined;
};

const pushCharacter: Operation = (_vm, frame) => {
  const code = toInt32(pop(frame));

  push(frame, code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '');
  return undefined;
};

const getTypeName = (value: Value): string => {
  if (value === undefined) {
    return 'undefined';
  }
  if (value === null) {
    return 'null';
  }
  if (!(value instanceof AsObject)) {
    return typeof value;
  }
  if (value.kind.type === 'function' || value.kind.type === 'native') {
    return 'function';
  }
  if (value.kind.type === 'clip') {
    return value.kind.instance.character?.type === 'editText'
      ? 'object'
      : 'movieclip';
  }
  return 'object';
};

const doNothing: Operation = () => undefined;

/** Arithmetic, comparison, logic, strings and conversions, and the small built-ins beside them */
export const ARITHMETIC_OPS: OperationGroup = {
  Add: onNumbers((a, b) => a + b),
  Subtract: onNumbers((a, b) => a - b),
  Multiply: onNumbers((a, b) => a * b),
  Divide: onNumbers((a, b) => a / b),
  Modulo: onNumbers((a, b) => a % b),
  NewAdd: (vm, frame) => {
    const b = pop(frame);
    const a = pop(frame);

    push(
      frame,
      typeof a === 'string' || typeof b === 'string'
        ? concatStrings(toAvmString(vm, a), toAvmString(vm, b))
        : toNumber(a) + toNumber(b),
    );
    return undefined;
  },
  StringConcat: onStrings(concatStrings),
  Increment: (_vm, frame) => {
    push(frame, toNumber(pop(frame)) + 1);
    return undefined;
  },
  Decrement: (_vm, frame) => {
    push(frame, toNumber(pop(frame)) - 1);
    return undefined;
  },
  Equals: onNumbers((a, b) => a === b),
  LessThan: onNumbers((a, b) => a < b),
  NewEquals: (_vm, frame) => {
    const b = pop(frame);

    push(frame, looseEquals(pop(frame), b));
    return undefined;
  },
  StrictEquals: (_vm, frame) => {
    const b = pop(frame);

    push(frame, pop(frame) === b);
    return undefined;
  },
  NewLessThan: compareLoosely(false),
  Greater: compareLoosely(true),
  StringEquals: onStrings((a, b) => a === b),
  StringGreater: onStrings((a, b) => a > b),
  StringCompare: onStrings((a, b) => a < b),
  StringLength: pushLength,
  MbLength: pushLength,
  Substring: pushSubstring,
  MbSubstring: pushSubstring,
  Ord: pushCodePoint,
  MbOrd: pushCodePoint,
  Chr: pushCharacter,
  MbChr: pushCharacter,
  LogicalNot: (_vm, frame) => {
    push(frame, !toBoolean(pop(frame)));
    return undefined;
  },
  LogicalAnd: onBooleans((a, b) => a && b),
  LogicalOr: onBooleans((a, b) => a || b),
  BitwiseAnd: onIntegers((x, y) => x & y),
  BitwiseOr: onIntegers((x, y) => x | y),
  BitwiseXor: onIntegers((x, y) => x ^ y),
  ShiftLeft: onIntegers((x, y) => x << (y & 31)),
  ShiftRight: onIntegers((x, y) => x >> (y & 31)),
  ShiftRight2: onIntegers((x, y) => x >>> (y & 31)),
  ToNumber: (_vm, frame) => {
    push(frame, toNumber(pop(frame)));
    return undefined;
  },
  ToInteger: (_vm, frame) => {
    const n = toNumber(pop(frame));

    push(frame, Number.isNaN(n) ? 0 : Math.trunc(n));
    return undefined;
  },
  ToString: (vm, frame) => {
    push(frame, toAvmString(vm, pop(frame)));
    return undefined;
  },
  TypeOf: (_vm, frame) => {
    push(frame, getTypeName(pop(frame)));
    return undefined;
  },
  Random: (vm, frame) => {
    const max = toInt32(pop(frame));

    push(frame, max > 0 ? Math.floor(vm.random() * max) : 0);
    return undefined;
  },
  GetTimer: (vm, frame) => {
    push(frame, vm.now());
    return undefined;
  },
  Trace: (vm, frame) => {
    vm.engine.log(`trace: ${toAvmString(vm, pop(frame))}`);
    return undefined;
  },
  ToggleQuality: doNothing,
  StopSounds: doNothing,
  StartDragMovie: doNothing,
  StopDragMovie: doNothing,
};
