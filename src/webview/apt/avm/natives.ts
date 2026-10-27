import type { Instance } from '../player';
import {
  apply,
  invert,
  multiply,
  placedColor,
  transformRect,
  union,
} from '../scene';
import type { Affine } from '../scene';
import type { Rect } from '../../../formats/apt/aptMovie';
import {
  AsObject,
  SCRIPT_DEPTH_BIAS,
  toBoolean,
  toInt32,
  toNumber,
} from './value';
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

/** Deepest depth a script may use, mint's `AVM_MAX_DEPTH` */
const MAX_SCRIPT_DEPTH = 2_130_706_428;
/** Depths a script may remove, mint's `AVM_MAX_REMOVE_DEPTH` */
const MAX_REMOVE_DEPTH = 2_130_706_416;
const MAX_TREE = 4096;

/** The depth a clip sits at, as the display list numbers it */
const listDepth = (clip: Instance) => Number(clip.path.split('/').pop());

const asAffine = (clip: Instance): Affine => [
  ...clip.matrix,
  ...clip.translate,
];

/** Clip space to the stage's */
const worldOf = (clip: Instance): Affine => {
  const chain: Instance[] = [];

  for (
    let at: Instance | undefined = clip;
    at && chain.length < 64;
    at = at.parent
  ) {
    chain.unshift(at);
  }
  return chain.reduce<Affine>(
    (sum, each) => multiply(sum, asAffine(each)),
    [1, 0, 0, 1, 0, 0],
  );
};

/** The box around what a clip draws, in the clip's own space */
const ownBounds = (clip: Instance): Rect | undefined => {
  const boxes: Rect[] = [];
  const visit = (at: Instance, matrix: Affine, count: { n: number }) => {
    if (at.visible === false || count.n++ > MAX_TREE) {
      return;
    }
    if (at.character && 'bounds' in at.character) {
      boxes.push(transformRect(matrix, at.character.bounds));
    }
    for (const child of at.children.values()) {
      visit(child, multiply(matrix, asAffine(child)), count);
    }
  };

  visit(clip, [1, 0, 0, 1, 0, 0], { n: 0 });
  return union(boxes);
};

/** Gives a subtree the paths its root's new depth implies */
const repath = (clip: Instance, path: string) => {
  clip.path = path;
  for (const child of clip.children.values()) {
    repath(child, `${path}/${child.path.split('/').pop()}`);
  }
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

    return at ? (listDepth(at) || 0) - SCRIPT_DEPTH_BIAS : undefined;
  };
  const scriptDepth = (value: Value) => toInt32(value) + SCRIPT_DEPTH_BIAS;
  const inRange = (depth: number) => depth >= 0 && depth <= MAX_SCRIPT_DEPTH;
  const initialise = (made: Instance, init: Value) => {
    if (init instanceof AsObject) {
      const object = vm.objectOf(made);

      init.keys().forEach((key) => object.set(key, init.get(key)));
    }
  };

  method(protos.movieClip, 'getDepth', depthOf);
  method(protos.button, 'getDepth', depthOf);
  method(protos.textField, 'getDepth', depthOf);
  method(protos.movieClip, 'attachMovie', (_, self, args) => {
    const at = clip(self);
    const depth = scriptDepth(arg(args, 2));
    const made =
      at && args.length >= 3 && inRange(depth)
        ? vm.stage.attach(
            at,
            vm.string(arg(args, 0)),
            vm.string(arg(args, 1)),
            depth,
          )
        : undefined;

    if (made) {
      initialise(made, args[3]);
    }
    return made && vm.objectOf(made);
  });
  method(protos.movieClip, 'createEmptyMovieClip', (_, self, args) => {
    const at = clip(self);
    const depth = scriptDepth(arg(args, 1));
    const made =
      at && args.length >= 2 && inRange(depth)
        ? vm.stage.createEmpty(at, vm.string(arg(args, 0)), depth)
        : undefined;

    return made && vm.objectOf(made);
  });
  method(protos.movieClip, 'duplicateMovieClip', (_, self, args) => {
    const at = clip(self);
    const depth = scriptDepth(arg(args, 1));
    const made =
      at?.parent && inRange(depth)
        ? vm.stage.attach(
            at.parent,
            `#${at.id}`,
            vm.string(arg(args, 0)),
            depth,
          )
        : undefined;

    if (at && made) {
      made.matrix = [...at.matrix];
      made.translate = [...at.translate];
      made.alpha = at.alpha;
      made.tint = at.tint;
      made.clipActions = at.clipActions;
      made.visible = at.visible;
      made.scripted = true;
      initialise(made, args[2]);
    }
    return made && vm.objectOf(made);
  });
  method(protos.movieClip, 'removeMovieClip', (_, self) => {
    const at = clip(self);
    const depth = at ? listDepth(at) : NaN;

    // Only depths a script can own: what the timeline placed stays
    if (at?.parent && depth >= SCRIPT_DEPTH_BIAS && depth < MAX_REMOVE_DEPTH) {
      vm.stage.remove(at);
    }
    return undefined;
  });
  method(protos.movieClip, 'loadMovie', (_, self, args) => {
    const at = clip(self);

    if (at) {
      vm.loadMovie(at, vm.string(arg(args, 0)));
    }
    return undefined;
  });
  method(protos.movieClip, 'unloadMovie', (_, self) => {
    const at = clip(self);

    if (at) {
      vm.loadMovie(at, '');
    }
    return undefined;
  });
  method(protos.movieClip, 'swapDepths', (_, self, args) => {
    const at = clip(self);
    const parent = at?.parent;

    if (!at || !parent) {
      return undefined;
    }

    const mine = listDepth(at);
    const other =
      typeof args[0] === 'number'
        ? scriptDepth(args[0])
        : (() => {
            const named = vm.clipAt(args[0], parent);

            return named?.parent === parent ? listDepth(named) : NaN;
          })();

    if (
      Number.isNaN(mine) ||
      Number.isNaN(other) ||
      other === mine ||
      !inRange(other)
    ) {
      return undefined;
    }

    const there = parent.children.get(String(other));
    const moved: [Instance, number][] = [[at, other]];

    if (there) {
      moved.push([there, mine]);
    }
    parent.children.delete(String(mine));
    parent.children.delete(String(other));
    for (const [each, depth] of moved) {
      // Placed by a script now, so the timeline no longer moves or drops it
      each.dynamic = true;
      each.scripted = true;
      parent.children.set(String(depth), each);
      repath(each, `${parent.path}/${depth}`);
    }
    parent.children = new Map(
      [...parent.children].sort(([a], [b]) => Number(a) - Number(b)),
    );
    return undefined;
  });
  method(protos.movieClip, 'getBytesLoaded', () => 1);
  method(protos.movieClip, 'getBytesTotal', () => 1);
  /** A point or clip argument as a box in the stage's space */
  const stageBox = (at: Instance): Rect | undefined => {
    const box = ownBounds(at);

    return box && transformRect(worldOf(at), box);
  };
  method(protos.movieClip, 'hitTest', (_, self, args) => {
    const at = clip(self);
    const mine = at && stageBox(at);

    if (!mine) {
      return false;
    }

    const other =
      clip(args[0]) ??
      (typeof args[0] === 'string' ? vm.clipAt(args[0], at) : undefined);

    if (other) {
      const theirs = stageBox(other);

      return (
        !!theirs &&
        mine[0] < theirs[2] &&
        theirs[0] < mine[2] &&
        mine[1] < theirs[3] &&
        theirs[1] < mine[3]
      );
    }

    const [x, y] = [toNumber(args[0]), toNumber(args[1])];

    return x >= mine[0] && x <= mine[2] && y >= mine[1] && y <= mine[3];
  });
  method(protos.movieClip, 'getBounds', (_, self, args) => {
    const at = clip(self);
    const box = at && ownBounds(at);
    const result = vm.object();
    const space =
      (at && (clip(args[0]) ?? (args.length ? vm.clipAt(args[0], at) : at))) ||
      at;

    if (!at || !box || !space) {
      return result;
    }

    const [l, t, r, b] = transformRect(
      multiply(invert(worldOf(space)), worldOf(at)),
      box,
    );

    result.set('xMin', l);
    result.set('xMax', r);
    result.set('yMin', t);
    result.set('yMax', b);
    return result;
  });
  method(protos.movieClip, 'startDrag', () => undefined);
  method(protos.movieClip, 'stopDrag', () => undefined);
  const convert =
    (toStage: boolean): NativeFunction =>
    (_, self, args) => {
      const at = clip(self);
      const point = args[0];

      if (at && point instanceof AsObject) {
        const world = worldOf(at);
        const [x, y] = apply(toStage ? world : invert(world), [
          toNumber(point.get('x')),
          toNumber(point.get('y')),
        ]);

        point.set('x', x);
        point.set('y', y);
      }
      return undefined;
    };

  method(protos.movieClip, 'localToGlobal', convert(true));
  method(protos.movieClip, 'globalToLocal', convert(false));
  method(protos.movieClip, 'getNextHighestDepth', (_, self) => {
    const at = clip(self);

    return at
      ? Math.max(
          0,
          ...[...at.children.keys()]
            .map((key) => Number(key) - SCRIPT_DEPTH_BIAS + 1)
            .filter(Number.isFinite),
        )
      : undefined;
  });
  method(protos.movieClip, 'getInstanceAtDepth', (_, self, args) => {
    const child = clip(self)?.children.get(String(scriptDepth(arg(args, 0))));

    return child && vm.objectOf(child);
  });

  // ---- Color
  const colorProto = new AsObject(protos.object);
  const colorTarget = (self: Value) => {
    const target = self instanceof AsObject ? self.get('target') : undefined;

    return clip(target) ?? vm.clipAt(target, vm.stage.root);
  };
  const byte = (unit: number) =>
    Math.max(-255, Math.min(255, Math.round(unit * 255)));
  const CHANNELS = [
    ['ra', 'rb'],
    ['ga', 'gb'],
    ['ba', 'bb'],
    ['aa', 'ab'],
  ] as const;

  constructor('Color', colorProto, (_, self, args) => {
    if (self instanceof AsObject) {
      self.set('target', args[0]);
    }
    return self;
  });
  method(colorProto, 'setRGB', (_, self, args) => {
    const at = colorTarget(self);
    const rgb = toInt32(arg(args, 0));

    if (at) {
      at.tint = {
        mult: [0, 0, 0, 1],
        add: [
          ((rgb >> 16) & 255) / 255,
          ((rgb >> 8) & 255) / 255,
          (rgb & 255) / 255,
          0,
        ],
      };
    }
    return undefined;
  });
  method(colorProto, 'getRGB', (_, self) => {
    const at = colorTarget(self);
    const add = at && placedColor(at).add;

    return add && (byte(add[0]) << 16) | (byte(add[1]) << 8) | byte(add[2]);
  });
  method(colorProto, 'setTransform', (_, self, args) => {
    const at = colorTarget(self);
    const given = args[0];

    if (at && given instanceof AsObject) {
      const { mult, add } = placedColor(at);
      const next = { mult: [...mult], add: [...add] } as typeof at.tint &
        object;

      CHANNELS.forEach(([m, a], channel) => {
        if (given.get(m) !== undefined) {
          next.mult[channel] = toNumber(given.get(m)) / 100;
        }
        if (given.get(a) !== undefined) {
          next.add[channel] = toNumber(given.get(a)) / 255;
        }
      });
      at.tint = next;
      // The instance's own alpha is what draws, so the alpha term lands there
      at.alpha = next.mult[3];
    }
    return undefined;
  });
  method(colorProto, 'getTransform', (_, self) => {
    const at = colorTarget(self);

    if (!at) {
      return undefined;
    }

    const { mult, add } = placedColor(at);
    const result = vm.object();

    CHANNELS.forEach(([m, a], channel) => {
      result.set(m, mult[channel] * 100);
      result.set(a, add[channel] * 255);
    });
    return result;
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
  // The level forms; `loadMovie(url, target)` as a statement is `GetUrl2`,
  // and called as a method it is the clip's own
  method(global, 'loadMovieNum', (_, __, args) => {
    vm.loadMovie(toInt32(arg(args, 1)), vm.string(arg(args, 0)));
    return undefined;
  });
  method(global, 'unloadMovieNum', (_, __, args) => {
    vm.loadMovie(toInt32(arg(args, 0)), '');
    return undefined;
  });
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
