import { AsObject, toBoolean, toInt32, toNumber } from './value';
import type { NativeFunction, Value } from './value';
import type { Vm } from './vm';

/**
 * The built-in objects and functions a movie finds: `Object`, `Array`,
 * `String`, `Math`, the MovieClip methods and the global functions, as
 * mint's `avm/natives.rs` installs them. Anything else the movie calls is
 * the engine's, and goes to the engine panel.
 */

const arg = (args: Value[], at: number): Value => args[at];

const chars = (vm: Vm, self: Value) => [...vm.string(self)];

/** An index argument clamped into a string or array, negatives from the end */
const relative = (value: Value, length: number, fallback: number) => {
  if (value === undefined) {
    return fallback;
  }

  const n = toInt32(value);

  return n < 0 ? Math.max(0, length + n) : Math.min(n, length);
};

const valuesOf = (vm: Vm, array: Value): Value[] => {
  if (!(array instanceof AsObject)) {
    return [];
  }

  const length = Math.min(100_000, Math.max(0, toInt32(array.get('length'))));

  return Array.from({ length }, (_, at) => array.get(String(at)));
};

const setValues = (array: AsObject, values: Value[]) => {
  for (let at = values.length; at < toInt32(array.get('length')); at++) {
    array.delete(String(at));
  }
  values.forEach((value, at) => array.set(String(at), value));
  array.define('length', values.length);
};

export const installNatives = (vm: Vm): void => {
  const { protos, global } = vm;
  const method = (on: AsObject, name: string, call: NativeFunction) =>
    on.define(name, vm.native(name, call));
  const constructor = (name: string, proto: AsObject, call: NativeFunction) => {
    const ctor = vm.native(name, call);

    ctor.define('prototype', proto);
    proto.define('constructor', ctor);
    global.define(name, ctor);
    return ctor;
  };
  const clip = (self: Value) => vm.clipOf(self);

  constructor('Object', protos.object, () => vm.object());
  constructor('Function', protos.function, () => undefined);
  constructor('Array', protos.array, (_, self, args) => {
    const array =
      self instanceof AsObject && self.kind.type === 'plain'
        ? self
        : vm.array([]);

    array.kind = { type: 'array' };
    array.proto = protos.array;
    if (args.length === 1 && typeof args[0] === 'number') {
      array.define('length', Math.max(0, toInt32(args[0])));
    } else {
      setValues(array, args);
    }
    return array;
  });
  const string = constructor('String', protos.string, (_, __, args) =>
    args.length ? vm.string(args[0]) : '',
  );

  constructor('Number', protos.number, (_, __, args) =>
    args.length ? toNumber(args[0]) : 0,
  );
  constructor('Boolean', protos.boolean, (_, __, args) => toBoolean(args[0]));
  constructor('MovieClip', protos.movieClip, () => undefined);
  constructor('Button', protos.button, () => undefined);
  constructor('TextField', protos.textField, () => undefined);

  method(string, 'fromCharCode', (_, __, args) =>
    args.map((code) => String.fromCharCode(toInt32(code) & 0xffff)).join(''),
  );

  method(protos.object, 'toString', () => '[object Object]');
  method(protos.object, 'valueOf', (_, self) => self);
  method(
    protos.object,
    'hasOwnProperty',
    (_, self, args) =>
      self instanceof AsObject && self.has(vm.string(arg(args, 0))),
  );
  method(protos.function, 'call', (_, self, args) =>
    vm.call(self, args[0], args.slice(1), 'call'),
  );
  method(protos.function, 'apply', (_, self, args) =>
    vm.call(self, args[0], valuesOf(vm, args[1]), 'apply'),
  );

  // ---- MovieClip
  const goto =
    (stop: boolean): NativeFunction =>
    (_, self, args) => {
      const at = clip(self);

      if (at) {
        vm.goto(at, arg(args, 0), stop);
      }
      return undefined;
    };

  method(protos.movieClip, 'gotoAndPlay', goto(false));
  method(protos.movieClip, 'gotoAndStop', goto(true));
  method(protos.movieClip, 'play', (_, self) => {
    const at = clip(self);

    if (at) {
      vm.stage.setPlaying(at, true);
    }
    return undefined;
  });
  method(protos.movieClip, 'stop', (_, self) => {
    const at = clip(self);

    if (at) {
      vm.stage.setPlaying(at, false);
    }
    return undefined;
  });
  method(protos.movieClip, 'nextFrame', (_, self) => {
    const at = clip(self);

    if (at) {
      vm.stage.goTo(at, at.frame + 1, false);
    }
    return undefined;
  });
  method(protos.movieClip, 'prevFrame', (_, self) => {
    const at = clip(self);

    if (at) {
      vm.stage.goTo(at, at.frame - 1, false);
    }
    return undefined;
  });
  const depthOf: NativeFunction = (_, self) => {
    const at = clip(self);

    return at ? Number(at.path.split('/').pop()) || 0 : undefined;
  };

  method(protos.movieClip, 'getDepth', depthOf);
  method(protos.button, 'getDepth', depthOf);
  method(protos.textField, 'getDepth', depthOf);
  method(protos.movieClip, 'attachMovie', (_, self, args) => {
    const at = clip(self);
    const made =
      at &&
      vm.stage.attach(
        at,
        vm.string(arg(args, 0)),
        vm.string(arg(args, 1)),
        toInt32(arg(args, 2)),
      );

    return made && vm.objectOf(made);
  });
  method(protos.movieClip, 'createEmptyMovieClip', (_, self, args) => {
    const at = clip(self);
    const made =
      at &&
      vm.stage.createEmpty(at, vm.string(arg(args, 0)), toInt32(arg(args, 1)));

    return made && vm.objectOf(made);
  });
  method(protos.movieClip, 'duplicateMovieClip', (_, self, args) => {
    const at = clip(self);
    const made =
      at?.parent &&
      vm.stage.attach(
        at.parent,
        `#${at.id}`,
        vm.string(arg(args, 0)),
        toInt32(arg(args, 1)),
      );

    return made && vm.objectOf(made);
  });
  method(protos.movieClip, 'removeMovieClip', (_, self) => {
    const at = clip(self);

    if (at) {
      vm.stage.remove(at);
    }
    return undefined;
  });
  method(protos.movieClip, 'swapDepths', () => undefined);
  method(protos.movieClip, 'getBytesLoaded', () => 1);
  method(protos.movieClip, 'getBytesTotal', () => 1);
  method(protos.movieClip, 'hitTest', () => false);
  method(protos.movieClip, 'startDrag', () => undefined);
  method(protos.movieClip, 'stopDrag', () => undefined);
  method(protos.movieClip, 'localToGlobal', () => undefined);
  method(protos.movieClip, 'globalToLocal', () => undefined);
  method(protos.movieClip, 'getNextHighestDepth', (_, self) => {
    const at = clip(self);

    return at
      ? Math.max(
          0,
          ...[...at.children.keys()]
            .map((key) => Number(key))
            .filter(Number.isFinite),
        ) + 1
      : undefined;
  });
  method(protos.movieClip, 'getInstanceAtDepth', (_, self, args) => {
    const child = clip(self)?.children.get(String(toInt32(arg(args, 0))));

    return child && vm.objectOf(child);
  });

  // ---- Color, enough to set a clip's tint without failing
  constructor('Color', new AsObject(protos.object), (_, self, args) => {
    if (self instanceof AsObject) {
      self.set('target', args[0]);
    }
    return undefined;
  });

  // ---- String
  method(protos.string, 'toString', (_, self) => vm.string(self));
  method(protos.string, 'valueOf', (_, self) => vm.string(self));
  method(
    protos.string,
    'charAt',
    (_, self, args) => chars(vm, self)[toInt32(arg(args, 0))] ?? '',
  );
  method(protos.string, 'charCodeAt', (_, self, args) => {
    const char = chars(vm, self)[toInt32(arg(args, 0))];

    return char === undefined ? NaN : (char.codePointAt(0) ?? NaN);
  });
  method(protos.string, 'indexOf', (_, self, args) =>
    vm
      .string(self)
      .indexOf(vm.string(arg(args, 0)), args.length > 1 ? toInt32(args[1]) : 0),
  );
  method(protos.string, 'lastIndexOf', (_, self, args) =>
    vm
      .string(self)
      .lastIndexOf(
        vm.string(arg(args, 0)),
        args.length > 1 ? toInt32(args[1]) : Infinity,
      ),
  );
  method(protos.string, 'substring', (_, self, args) => {
    const text = chars(vm, self);
    const from = Math.max(0, Math.min(text.length, toInt32(arg(args, 0))));
    const to =
      args.length > 1
        ? Math.max(0, Math.min(text.length, toInt32(args[1])))
        : text.length;

    return text.slice(Math.min(from, to), Math.max(from, to)).join('');
  });
  method(protos.string, 'substr', (_, self, args) => {
    const text = chars(vm, self);
    const from = relative(arg(args, 0), text.length, 0);
    const count = args.length > 1 ? Math.max(0, toInt32(args[1])) : text.length;

    return text.slice(from, from + count).join('');
  });
  method(protos.string, 'slice', (_, self, args) => {
    const text = chars(vm, self);

    return text
      .slice(
        relative(arg(args, 0), text.length, 0),
        relative(arg(args, 1), text.length, text.length),
      )
      .join('');
  });
  method(protos.string, 'toUpperCase', (_, self) =>
    vm.string(self).toUpperCase(),
  );
  method(protos.string, 'toLowerCase', (_, self) =>
    vm.string(self).toLowerCase(),
  );
  method(protos.string, 'split', (_, self, args) =>
    vm.array(
      args[0] === undefined
        ? [vm.string(self)]
        : vm.string(self).split(vm.string(args[0])),
    ),
  );
  method(protos.string, 'concat', (_, self, args) =>
    [vm.string(self), ...args.map((each) => vm.string(each))].join(''),
  );
  method(protos.number, 'toString', (_, self, args) => {
    const radix = args.length ? toInt32(args[0]) : 10;

    return radix >= 2 && radix <= 36
      ? toNumber(self).toString(radix)
      : vm.string(self);
  });
  method(protos.boolean, 'toString', (_, self) => vm.string(self));

  // ---- Array
  const array = (self: Value) => (self instanceof AsObject ? self : undefined);
  const update = (self: Value, change: (values: Value[]) => Value): Value => {
    const target = array(self);

    if (!target) {
      return undefined;
    }

    const values = valuesOf(vm, target);
    const result = change(values);

    setValues(target, values);
    return result;
  };

  method(protos.array, 'push', (_, self, args) =>
    update(self, (values) => values.push(...args)),
  );
  method(protos.array, 'pop', (_, self) =>
    update(self, (values) => values.pop()),
  );
  method(protos.array, 'shift', (_, self) =>
    update(self, (values) => values.shift()),
  );
  method(protos.array, 'unshift', (_, self, args) =>
    update(self, (values) => values.unshift(...args)),
  );
  method(protos.array, 'reverse', (_, self) =>
    update(self, (values) => {
      values.reverse();
      return self;
    }),
  );
  method(protos.array, 'sort', (_, self) =>
    update(self, (values) => {
      values.sort((a, b) =>
        vm.string(a) < vm.string(b) ? -1 : vm.string(a) > vm.string(b) ? 1 : 0,
      );
      return self;
    }),
  );
  method(protos.array, 'splice', (_, self, args) =>
    update(self, (values) => {
      const from = relative(arg(args, 0), values.length, 0);
      const count =
        args.length > 1 ? Math.max(0, toInt32(args[1])) : values.length - from;

      return vm.array(values.splice(from, count, ...args.slice(2)));
    }),
  );
  method(protos.array, 'join', (_, self, args) => {
    const target = array(self);

    return target
      ? vm.join(target, args[0] === undefined ? ',' : vm.string(args[0]))
      : '';
  });
  method(protos.array, 'toString', (_, self) => {
    const target = array(self);

    return target ? vm.join(target, ',') : '';
  });
  method(protos.array, 'concat', (_, self, args) =>
    vm.array([
      ...valuesOf(vm, self),
      ...args.flatMap((each) =>
        each instanceof AsObject && each.kind.type === 'array'
          ? valuesOf(vm, each)
          : [each],
      ),
    ]),
  );
  method(protos.array, 'slice', (_, self, args) => {
    const values = valuesOf(vm, self);

    return vm.array(
      values.slice(
        relative(arg(args, 0), values.length, 0),
        relative(arg(args, 1), values.length, values.length),
      ),
    );
  });

  // ---- Math
  const math = vm.object();
  const numeric = (name: string, call: (...n: number[]) => number) =>
    method(math, name, (_, __, args) => call(...args.map(toNumber)));

  global.define('Math', math);
  math.define('PI', Math.PI);
  math.define('E', Math.E);
  for (const name of [
    'abs',
    'floor',
    'ceil',
    'round',
    'sqrt',
    'sin',
    'cos',
    'tan',
    'atan',
    'atan2',
    'pow',
    'exp',
    'log',
    'asin',
    'acos',
  ] as const) {
    numeric(name, Math[name] as (...n: number[]) => number);
  }
  numeric('min', (...n) => (n.length ? Math.min(...n) : Infinity));
  numeric('max', (...n) => (n.length ? Math.max(...n) : -Infinity));
  method(math, 'random', () => vm.random());

  // ---- global functions
  method(global, 'parseInt', (_, __, args) => {
    const text = vm.string(arg(args, 0)).trim();
    const radix = args.length > 1 ? toInt32(args[1]) : undefined;

    return parseInt(text, radix);
  });
  method(global, 'parseFloat', (_, __, args) =>
    parseFloat(vm.string(arg(args, 0))),
  );
  method(global, 'isNaN', (_, __, args) =>
    Number.isNaN(toNumber(arg(args, 0))),
  );
  method(global, 'isFinite', (_, __, args) =>
    Number.isFinite(toNumber(arg(args, 0))),
  );
  method(global, 'escape', (_, __, args) => vm.string(arg(args, 0)));
  method(global, 'unescape', (_, __, args) => vm.string(arg(args, 0)));
  method(global, 'setInterval', (_, __, args) => {
    // setInterval(fn, ms, ...) or setInterval(object, "method", ms, ...)
    if (typeof args[1] === 'string' && args[0] instanceof AsObject) {
      return vm.interval(
        vm.member(args[0], args[1]),
        args[0],
        toNumber(args[2]),
        args.slice(3),
      );
    }
    return vm.interval(args[0], undefined, toNumber(args[1]), args.slice(2));
  });
  method(global, 'clearInterval', (_, __, args) => {
    vm.clearInterval(toInt32(arg(args, 0)));
    return undefined;
  });
  global.define('NaN', NaN);
  global.define('Infinity', Infinity);
};
