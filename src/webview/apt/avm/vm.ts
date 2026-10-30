import type {
  AptFunction,
  AptInstruction,
} from '../../../formats/apt/aptBytecode';
import type { PageMovie } from '../protocol';
import type { Instance } from '../player';
import { isWindowTarget, parseLevel } from './movieLoad';
import { installNatives } from './natives';
import {
  AsObject,
  formatNumber,
  looseEquals,
  SCRIPT_DEPTH_BIAS,
  toBoolean,
  toInt32,
  toNumber,
} from './value';
import type {
  BytecodeFunction,
  NativeFunction,
  NativeHost,
  Scope,
  StageHost,
  Value,
} from './value';
import { describeError } from '../../../core/errors';

/**
 * Runs the movie's ActionScript bytecode against the preview's clips: an
 * AVM1 interpreter ported from mint's `apt-player/src/avm/interp.rs`
 * (itself after Ruffle's `avm1`), with its readings of the EA opcodes:
 *
 * - `PushData` pushes `.const` items, and a number item is a register
 * - the EA call forms without `Pop` assign their result to the variable
 *   named under the arguments
 * - scopes are Global <- Target (the clip) <- Local, functions close over
 *   the scope that defined them, and a clip's object falls through to its
 *   children by instance name and to `_x` and friends
 * - gotos, `play` and `stop` act on the clips at once
 *
 * Where the movie reaches past itself to the game, nothing answers but
 * the engine boundary (`EngineHooks`): `GetExtern` and the `extern`
 * object, `GameCode`, `FSCommand:` URLs, calls to functions nothing
 * defines, and names nothing sets. The preview's engine panel supplies
 * their values.
 */

/** Engine boundary of the AVM: what the movie asks of the game, answered by the engine panel */
export interface EngineHooks {
  /** Binds the machine asking, told once when it starts */
  bind(vm: Vm): void;
  /** Answers `GetExtern(name)` and `extern.name` */
  extern(name: string): Value;
  /** Records the movie's own write to an extern */
  setExtern(name: string, value: Value): void;
  /** Answers a call nothing in the movie defines: `GameCode`, an engine function */
  call(name: string, args: string[]): Value;
  /** Takes a `getURL("FSCommand:...")` */
  command(command: string, args: string): void;
  /**
   * Notes every variable read, with what the movie holds (`found` says whether
   * it holds anything), and returns what the script sees: the engine may
   * override it. `counted` is false for reads the preview makes itself, such
   * as a text field's bound variable. `local` says a function's own local or parameter answered, which is
   * never the game's to override.
   */
  read(
    path: string,
    value: Value,
    found: boolean,
    counted: boolean,
    local: boolean,
  ): Value;
  /**
   * Writes the engine's sticky values back into the movie; called around each
   * top-level script, with the machine idle
   */
  sync(): void;
  /** Notes a function the movie stores where the engine can call it */
  defined(owner: AsObject, name: string, fn: AsObject): void;
  /** Logs a line from the machine */
  log(line: string): void;
}

/** Instructions a top-level action may run, nested calls included */
const MAX_STEPS = 100_000;
const MAX_STACK = 1024;
const MAX_CALL_DEPTH = 64;
const MAX_STRING = 65_536;
/** Scripts started inside other scripts, by gotos and calls, at most */
const MAX_NESTING = 32;

/** Display properties in `GetProperty`/`SetProperty` index order */
export const DISPLAY_PROPERTIES = [
  '_x',
  '_y',
  '_xscale',
  '_yscale',
  '_currentframe',
  '_totalframes',
  '_alpha',
  '_visible',
  '_width',
  '_height',
  '_rotation',
  '_target',
  '_framesloaded',
  '_name',
  '_droptarget',
  '_url',
  '_highquality',
  '_focusrect',
  '_soundbuftime',
  '_quality',
  '_xmouse',
  '_ymouse',
];

class Halt extends Error {}

/** Paths that name their start, so no local variable is the way in */
const ROOTED = /^(\/|_root[.:]|_level\d+[.:]|_global[.:]|this[.:])/i;

/** One running activation */
interface Frame {
  movie: PageMovie;
  scope: Scope;
  pool: Value[];
  self: Value;
  /** The clip timeline actions act on; `SetTarget` changes it */
  target?: Instance;
  /** The clip whose code this is */
  base?: Instance;
  registers?: Value[];
  stack: Value[];
  depth: number;
}

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

/** SWF DefineFunction2 flags */
const PRELOAD = {
  this: 0x01,
  suppressThis: 0x02,
  arguments: 0x04,
  suppressArguments: 0x08,
  super: 0x10,
  root: 0x40,
  parent: 0x80,
  global: 0x100,
};

/** AVM1 interpreter running one movie's scripts against the player's clips */
export class Vm implements NativeHost {
  /** The `_global` object */
  public readonly global: AsObject;
  /** Prototypes of the built-in classes, each inheriting from `object` */
  public readonly protos: Record<
    | 'object'
    | 'function'
    | 'array'
    | 'string'
    | 'number'
    | 'boolean'
    | 'movieClip'
    | 'button'
    | 'textField',
    AsObject
  >;
  /** The `extern` object, whose members the engine answers */
  public readonly externObject: AsObject;
  private readonly clips = new WeakMap<Instance, AsObject>();
  private readonly registers: Value[] = [];
  private budget = MAX_STEPS;
  /** Entries into the machine in progress: a goto's frame script runs inside the script that went */
  private nesting = 0;
  private seed = 0x2545f491;
  private nextInterval = 1;
  /** Ticks of the player, which `getTimer` counts at 30 a second */
  public ticks = 0;
  /** Timers `setInterval` started, by id; `every` and `due` count ticks */
  public readonly intervals = new Map<
    number,
    { callee: Value; self: Value; every: number; due: number; args: Value[] }
  >();
  /** Init actions already run, by movie and sprite */
  public readonly initialised = new Set<string>();

  public constructor(
    public readonly stage: StageHost,
    private readonly engine: EngineHooks,
  ) {
    const object = new AsObject();
    const proto = (parent = object) => new AsObject(parent);

    this.protos = {
      object,
      function: proto(),
      array: proto(),
      string: proto(),
      number: proto(),
      boolean: proto(),
      movieClip: proto(),
      button: proto(),
      textField: proto(),
    };
    this.global = new AsObject(object);
    this.externObject = new AsObject(object);
    this.global.define('extern', this.externObject);
    installNatives(this);
    engine.bind(this);
  }

  // ---- what the player and the panel call

  /** Runs an action block on a clip: a frame's, a button's, a clip event's */
  public runBlock(clip: Instance, block: number, owner = clip): void {
    const code = owner.movie.code?.[block];

    if (!code) {
      return;
    }
    this.settled(() =>
      this.guard(`block ${block}`, () =>
        this.exec(code, {
          movie: owner.movie,
          scope: this.targetScope(clip),
          pool: [],
          self: this.objectOf(clip),
          target: clip,
          base: clip,
          stack: [],
          depth: 0,
        }),
      ),
    );
  }

  /** Runs a top-level script between the engine's sticky writes */
  private settled<T>(run: () => T): T {
    if (this.nesting > 0) {
      return run();
    }
    this.engine.sync();
    try {
      return run();
    } finally {
      this.engine.sync();
    }
  }

  /**
   * Writes a value at a path from the root, as the engine's override of it:
   * `side` is `_root.side`. Nothing is written where it already holds, or
   * over a clip or object the movie keeps under the name.
   */
  public assertValue(path: string, value: Value): void {
    const frame = this.frameOn(this.stage.root);
    const target = `_root.${path}`;
    const held = this.lookupVariable(frame, target).value;

    if (held instanceof AsObject || Object.is(held, value)) {
      return;
    }
    this.setVariable(frame, target, value);
  }

  /** Calls a function value from outside, as the engine calls into a movie */
  public callFromEngine(callee: Value, self: Value, args: Value[]): Value {
    return this.settled(() =>
      this.guard('a call', () => this.call(callee, self, args, 'engine')),
    ) as Value;
  }

  /** Reads a variable a text field is bound to, from the clip it sits in */
  public readBound(clip: Instance, name: string): Value {
    return this.guard(
      'a text field',
      () =>
        this.getVariable(
          {
            movie: clip.movie,
            scope: this.targetScope(clip),
            pool: [],
            self: this.objectOf(clip),
            target: clip,
            base: clip,
            stack: [],
            depth: 0,
          },
          name,
          false,
        ).value,
    ) as Value;
  }

  /** Gets the script object of a clip, made on first use */
  public objectOf(instance: Instance): AsObject {
    let object = this.clips.get(instance);

    if (!object) {
      const type = instance.character?.type;

      object = new AsObject(
        type === 'button'
          ? this.protos.button
          : type === 'editText'
            ? this.protos.textField
            : this.protos.movieClip,
        { type: 'clip', instance },
      );
      this.clips.set(instance, object);
    }
    return object;
  }

  /** Whether a script is running, so a frame entered now waits its turn */
  public get isBusy(): boolean {
    return this.nesting > 0;
  }

  /** A frame with nothing running, for resolving paths from a clip */
  private frameOn(clip: Instance): Frame {
    return {
      movie: clip.movie,
      scope: this.targetScope(clip),
      pool: [],
      self: this.objectOf(clip),
      target: clip,
      base: clip,
      stack: [],
      depth: 0,
    };
  }

  /** Finds the clip a target path or clip value names, a path read from `from` */
  public clipAt(target: Value, from: Instance): Instance | undefined {
    return this.targetClip(this.frameOn(from), from, target, false);
  }

  /** Gets a clip's script object if a script has touched it, without making one */
  public peekObject(instance: Instance): AsObject | undefined {
    return this.clips.get(instance);
  }

  /** Gets the clip a value is the script object of, if it is one */
  public clipOf(value: Value): Instance | undefined {
    return value instanceof AsObject && value.kind.type === 'clip'
      ? value.kind.instance
      : undefined;
  }

  // ---- NativeHost

  /** Converts a value to a string as AVM1 does */
  public string(value: Value): string {
    if (value === undefined) {
      return 'undefined';
    }
    if (value === null) {
      return 'null';
    }
    if (typeof value === 'boolean') {
      return value ? 'true' : 'false';
    }
    if (typeof value === 'number') {
      return formatNumber(value);
    }
    if (typeof value === 'string') {
      return value;
    }
    switch (value.kind.type) {
      case 'clip':
        return this.targetPath(value.kind.instance, '.');
      case 'function':
      case 'native':
        return '[type Function]';
      case 'array':
        return this.join(value, ',');
      default: {
        const toString = this.member(value, 'toString');

        return toString instanceof AsObject &&
          toString !== this.protos.object.get('toString')
          ? this.string(this.call(toString, value, [], 'toString'))
          : '[object Object]';
      }
    }
  }

  /** Joins an array's items as `Array.join` does; the length read is capped */
  public join(array: AsObject, separator: string): string {
    const length = Math.min(100_000, Math.max(0, toInt32(array.get('length'))));
    const parts: string[] = [];

    for (let index = 0; index < length; index++) {
      const value = array.get(String(index));

      parts.push(
        value === undefined || value === null || value === array
          ? ''
          : this.string(value),
      );
    }
    return parts.join(separator);
  }

  /** Creates an array object holding the values */
  public array(values: Value[]): AsObject {
    const array = new AsObject(this.protos.array, { type: 'array' });

    values.forEach((value, index) => array.set(String(index), value));
    array.define('length', values.length);
    return array;
  }

  /** Creates an empty plain object */
  public object(): AsObject {
    return new AsObject(this.protos.object);
  }

  /** Gets the next random number in `0..1`, the same sequence every run */
  public random(): number {
    // xorshift: the same sequence every run
    let x = this.seed;

    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.seed = x >>> 0;
    return this.seed / 0x1_0000_0000;
  }

  /** Gets the milliseconds since the run started, counted from ticks at 30 a second */
  public now(): number {
    return Math.trunc((this.ticks * 1000) / 30);
  }

  /** Starts a `setInterval` timer, rounded to whole ticks, and returns its id */
  public interval(
    callee: Value,
    self: Value,
    ms: number,
    args: Value[],
  ): number {
    const id = this.nextInterval++;
    const every = Math.max(1, Math.round((ms * 30) / 1000));

    this.intervals.set(id, {
      callee,
      self,
      every,
      due: this.ticks + every,
      args,
    });
    return id;
  }

  /** Stops a `setInterval` timer */
  public clearInterval(id: number): void {
    this.intervals.delete(id);
  }

  /** Runs the intervals that are due; the player calls it every tick */
  public runIntervals(): void {
    for (const [id, interval] of [...this.intervals]) {
      if (interval.due <= this.ticks && this.intervals.has(id)) {
        interval.due = this.ticks + interval.every;
        this.callFromEngine(interval.callee, interval.self, interval.args);
      }
    }
  }

  /** Gets a member of a value, through prototypes, clip children and display properties */
  public member(object: Value, name: string): Value {
    if (typeof object === 'string' && name.toLowerCase() === 'length') {
      return object.length;
    }
    if (object === this.externObject) {
      return this.engine.extern(name);
    }

    let current: AsObject | undefined =
      object instanceof AsObject ? object : this.protoOf(object);

    for (let hops = 0; current && hops < 256; hops++) {
      if (current.has(name)) {
        return current.get(name);
      }
      if (current.kind.type === 'clip') {
        const found = this.displayLookup(current.kind.instance, name);

        if (found.found) {
          return found.value;
        }
      }
      current = current.proto;
    }
    return undefined;
  }

  /** Sets a member of an object; a clip's display property moves the clip */
  public setMember(object: Value, name: string, value: Value): void {
    if (!(object instanceof AsObject) || !name) {
      return;
    }
    if (object === this.externObject) {
      this.engine.setExtern(name, value);
      return;
    }
    if (object.kind.type === 'clip' && !object.has(name)) {
      const instance = object.kind.instance;
      const lower = name.toLowerCase();

      if (DISPLAY_PROPERTIES.includes(lower)) {
        this.setDisplayProperty(instance, lower, value);
        return;
      }
      if (
        instance.character?.type === 'editText' &&
        (lower === 'text' || lower === 'htmltext')
      ) {
        instance.text = this.string(value);
        return;
      }
    }
    if (object.kind.type === 'array') {
      if (name.toLowerCase() === 'length') {
        const length = Math.max(0, Math.trunc(toNumber(value)) || 0);

        for (let at = length; at < toInt32(object.get('length')); at++) {
          object.delete(String(at));
        }
        object.define('length', length);
        return;
      }
      if (/^\d+$/.test(name) && Number(name) >= toInt32(object.get('length'))) {
        object.define('length', Number(name) + 1);
      }
    }
    if (value instanceof AsObject && value.kind.type === 'function') {
      this.engine.defined(object, name, value);
    }
    object.set(name, value);
  }

  /** Calls a function value; one nothing defines is asked of the engine under `name` */
  public call(callee: Value, self: Value, args: Value[], name: string): Value {
    if (callee instanceof AsObject && callee.kind.type === 'function') {
      return this.callBytecode(callee, callee.kind.fn, self, args);
    }
    if (callee instanceof AsObject && callee.kind.type === 'native') {
      return callee.kind.call(this, self, args);
    }

    // Nothing defines it: the game's to answer
    const texts = args.map((arg) => this.string(arg));
    const lower = name.toLowerCase();

    if (lower === 'getextern') {
      return this.engine.extern(texts[0] ?? '');
    }
    if (lower === 'toggleextern') {
      const key = texts[0] ?? '';

      this.engine.setExtern(key, !toBoolean(this.engine.extern(key)));
      return undefined;
    }
    return this.engine.call(name, texts);
  }

  // ---- display objects

  private protoOf(value: Value): AsObject | undefined {
    switch (typeof value) {
      case 'string':
        return this.protos.string;
      case 'number':
        return this.protos.number;
      case 'boolean':
        return this.protos.boolean;
      default:
        return undefined;
    }
  }

  private childByName(instance: Instance, name: string): Instance | undefined {
    const lower = name.toLowerCase();

    for (const child of instance.children.values()) {
      if (child.name?.toLowerCase() === lower) {
        return child;
      }
    }
    return undefined;
  }

  private displayLookup(
    instance: Instance,
    name: string,
  ): { found: boolean; value?: Value } {
    const lower = name.toLowerCase();

    if (lower === '_root' || lower === '_level0') {
      return { found: true, value: this.objectOf(this.stage.root) };
    }
    if (lower === '_parent') {
      return {
        found: true,
        value: instance.parent && this.objectOf(instance.parent),
      };
    }

    const level = this.levelClip(lower);

    if (level) {
      return { found: true, value: this.objectOf(level) };
    }
    if (lower === '_global') {
      return { found: true, value: this.global };
    }

    const child = this.childByName(instance, name);

    if (child) {
      return { found: true, value: this.objectOf(child) };
    }
    if (DISPLAY_PROPERTIES.includes(lower)) {
      return { found: true, value: this.displayProperty(instance, lower) };
    }
    if (
      instance.character?.type === 'editText' &&
      (lower === 'text' || lower === 'htmltext')
    ) {
      return {
        found: true,
        value: instance.text ?? instance.character.text ?? '',
      };
    }
    return { found: false };
  }

  /** The clip a script loaded into a level (`_level1`), if one is there */
  private levelClip(lower: string): Instance | undefined {
    const level = parseLevel(lower);

    return level
      ? [...this.stage.root.children.values()].find(
          (child) => child.name?.toLowerCase() === lower,
        )
      : undefined;
  }

  /** Gets the target path of a clip, as `_level0.a.b` or `/a/b` */
  public targetPath(instance: Instance, separator: '.' | '/'): string {
    const names: string[] = [];

    for (let at: Instance | undefined = instance; at?.parent; at = at.parent) {
      names.unshift(at.name ?? '');
    }

    // A level is not below `_level0`: its path starts at itself
    const level = names[0] && parseLevel(names[0]) ? names[0] : undefined;

    return separator === '/'
      ? `/${names.join('/')}`
      : [level ? '' : '_level0', ...names].filter(Boolean).join('.');
  }

  private displayProperty(instance: Instance, name: string): Value {
    const [a, b, c, d] = instance.matrix;
    const bounds =
      instance.character && 'bounds' in instance.character
        ? instance.character.bounds
        : undefined;

    switch (name) {
      case '_x':
        return instance.translate[0];
      case '_y':
        return instance.translate[1];
      case '_xscale':
        return Math.hypot(a, b) * 100;
      case '_yscale':
        return Math.hypot(c, d) * 100;
      case '_rotation':
        return (Math.atan2(b, a) * 180) / Math.PI;
      case '_alpha':
        return instance.alpha * 100;
      case '_visible':
        return instance.visible !== false;
      case '_currentframe':
        return instance.frame + 1;
      case '_totalframes':
      case '_framesloaded':
        return instance.frames.length;
      case '_name':
        return instance.name ?? '';
      case '_target':
        return this.targetPath(instance, '/');
      case '_width':
        return bounds ? (bounds[2] - bounds[0]) * Math.hypot(a, b) : 0;
      case '_height':
        return bounds ? (bounds[3] - bounds[1]) * Math.hypot(c, d) : 0;
      case '_url':
        return '';
      case '_quality':
        return 'HIGH';
      case '_highquality':
        return 1;
      default:
        return 0;
    }
  }

  private setDisplayProperty(
    instance: Instance,
    name: string,
    value: Value,
  ): void {
    const n = toNumber(value);
    const [a, b, c, d] = instance.matrix;
    const xScale = Math.hypot(a, b);
    const yScale = Math.hypot(c, d);
    const rotation = Math.atan2(b, a);
    const compose = (sx: number, sy: number, angle: number) => {
      instance.matrix = [
        sx * Math.cos(angle),
        sx * Math.sin(angle),
        -sy * Math.sin(angle),
        sy * Math.cos(angle),
      ];
    };

    // Once a script moves a clip, its timeline no longer does
    instance.scripted = true;
    switch (name) {
      case '_x':
        if (!Number.isNaN(n)) {
          instance.translate = [n, instance.translate[1]];
        }
        break;
      case '_y':
        if (!Number.isNaN(n)) {
          instance.translate = [instance.translate[0], n];
        }
        break;
      case '_xscale':
        if (!Number.isNaN(n)) {
          compose(n / 100, yScale, rotation);
        }
        break;
      case '_yscale':
        if (!Number.isNaN(n)) {
          compose(xScale, n / 100, rotation);
        }
        break;
      case '_rotation':
        if (!Number.isNaN(n)) {
          compose(xScale, yScale, (n * Math.PI) / 180);
        }
        break;
      case '_alpha':
        if (!Number.isNaN(n)) {
          instance.alpha = n / 100;
        }
        break;
      case '_visible':
        instance.visible = toBoolean(value);
        break;
      case '_name':
        instance.name = this.string(value);
        break;
      case '_width':
      case '_height': {
        const bounds =
          instance.character && 'bounds' in instance.character
            ? instance.character.bounds
            : undefined;
        const size = bounds
          ? name === '_width'
            ? bounds[2] - bounds[0]
            : bounds[3] - bounds[1]
          : 0;

        if (size && !Number.isNaN(n)) {
          compose(
            name === '_width' ? n / size : xScale,
            name === '_height' ? n / size : yScale,
            rotation,
          );
        }
        break;
      }
    }
  }

  // ---- variables and scopes

  private targetScope(clip: Instance): Scope {
    return {
      values: this.objectOf(clip),
      kind: 'target',
      parent: { values: this.global, kind: 'global' },
    };
  }

  private resolve(
    frame: Frame,
    name: string,
  ): { value: Value; on?: AsObject; local?: boolean } {
    if (name.toLowerCase() === 'this') {
      return { value: frame.self };
    }
    for (
      let scope: Scope | undefined = frame.scope;
      scope;
      scope = scope.parent
    ) {
      if (this.hasProperty(scope.values, name)) {
        return {
          value: this.member(scope.values, name),
          on: scope.values,
          local: scope.kind === 'local',
        };
      }
    }
    return { value: undefined };
  }

  private hasProperty(object: AsObject, name: string): boolean {
    let current: AsObject | undefined = object;

    for (let hops = 0; current && hops < 256; hops++) {
      if (current.has(name)) {
        return true;
      }
      if (
        current.kind.type === 'clip' &&
        this.displayLookup(current.kind.instance, name).found
      ) {
        return true;
      }
      current = current.proto;
    }
    return false;
  }

  /** `GetVariable`, as the engine may override it */
  private getVariable(
    frame: Frame,
    path: string,
    counted = true,
  ): { value: Value; on?: AsObject } {
    const found = this.lookupVariable(frame, path);

    return path.toLowerCase() === 'this'
      ? found
      : {
          value: this.engine.read(
            path,
            found.value,
            found.on !== undefined,
            counted,
            found.local === true,
          ),
          on: found.on,
        };
  }

  /** A variable: `a.b:c` paths through the clips, else a plain name */
  private lookupVariable(
    frame: Frame,
    path: string,
  ): { value: Value; on?: AsObject; local?: boolean } {
    const separator = Math.max(path.lastIndexOf(':'), path.lastIndexOf('.'));

    if (separator >= 0) {
      const target = path.slice(0, separator);
      const name = path.slice(separator + 1);

      if (!target) {
        return { value: undefined };
      }
      for (
        let scope: Scope | undefined = frame.scope;
        scope;
        scope = scope.parent
      ) {
        const object = this.resolvePath(frame, scope.values, target);

        if (object && this.hasProperty(object, name)) {
          return {
            value: this.member(object, name),
            on: object,
            // A path from a function's own variable is not the movie's
            local: scope.kind === 'local' && !ROOTED.test(path),
          };
        }
      }
      return { value: undefined };
    }
    if (path.includes('/')) {
      for (
        let scope: Scope | undefined = frame.scope;
        scope;
        scope = scope.parent
      ) {
        const object = this.resolvePath(frame, scope.values, path);

        if (object) {
          return { value: object, on: object };
        }
      }
    }

    return this.resolve(frame, path);
  }

  private setVariable(frame: Frame, path: string, value: Value): void {
    if (!path) {
      return;
    }

    const separator = Math.max(path.lastIndexOf(':'), path.lastIndexOf('.'));

    if (separator >= 0) {
      for (
        let scope: Scope | undefined = frame.scope;
        scope;
        scope = scope.parent
      ) {
        const object = this.resolvePath(
          frame,
          scope.values,
          path.slice(0, separator),
        );

        if (object) {
          this.setMember(object, path.slice(separator + 1), value);
          return;
        }
      }
      return;
    }

    let last = this.global;

    for (
      let scope: Scope | undefined = frame.scope;
      scope;
      scope = scope.parent
    ) {
      if (scope.kind === 'target' || this.hasProperty(scope.values, path)) {
        this.setMember(scope.values, path, value);
        return;
      }
      last = scope.values;
    }
    this.setMember(last, path, value);
  }

  private defineLocal(frame: Frame, name: string, value: Value): void {
    if (frame.scope.kind !== 'local' && /[.:]/.test(name)) {
      this.setVariable(frame, name, value);
      return;
    }
    this.setMember(frame.scope.values, name, value);
  }

  /** A target path through the clips: `_root.a.b`, `/a/b`, `../x`, `a:b` */
  private resolvePath(
    frame: Frame,
    start: AsObject,
    path: string,
  ): AsObject | undefined {
    if (!path) {
      return start;
    }

    let object: AsObject | undefined = start;
    let rest = path;
    let slash = false;
    let first = true;

    if (rest.startsWith('/')) {
      object = this.objectOf(this.stage.root);
      rest = rest.slice(1);
      slash = true;
      first = false;
    }
    for (let hops = 0; rest && object && hops < 256; hops++) {
      rest = rest.replace(/^:+/, '');
      if (rest.startsWith('..')) {
        const after = rest.slice(2);

        slash ||= after.startsWith('/');
        rest = after.slice(1);

        const parent: Instance | undefined = this.clipOf(object)?.parent;

        object = parent && this.objectOf(parent);
        first = false;
        continue;
      }

      let end = rest.length;

      for (let at = 0; at < rest.length; at++) {
        const char = rest[at];

        if (char === ':' || (char === '.' && !slash)) {
          end = at;
          break;
        }
        if (char === '/') {
          slash = true;
          end = at;
          break;
        }
      }

      const name = rest.slice(0, end);
      const lower = name.toLowerCase();

      rest = rest.slice(end + 1);

      let value: Value;

      if (lower === 'this') {
        value = frame.self;
      } else if (first && (lower === '_root' || lower === '_level0')) {
        value = this.objectOf(this.stage.root);
      } else if (first && this.levelClip(lower)) {
        value = this.objectOf(this.levelClip(lower)!);
      } else {
        const clip = this.clipOf(object);
        const child = clip && this.childByName(clip, name);

        value = child ? this.objectOf(child) : this.member(object, name);
      }
      first = false;
      object = value instanceof AsObject ? value : undefined;
    }
    return object;
  }

  /** The clip a target names: an object, or a path from `start` */
  private targetClip(
    frame: Frame,
    start: Instance,
    target: Value,
    allowEmpty: boolean,
  ): Instance | undefined {
    const clip = this.clipOf(target);

    if (clip) {
      return clip;
    }

    const path = this.string(target);

    if (!allowEmpty && !path) {
      return undefined;
    }
    return this.clipOf(this.resolvePath(frame, this.objectOf(start), path));
  }

  // ---- calls

  private callBytecode(
    callee: AsObject,
    fn: BytecodeFunction,
    self: Value,
    args: Value[],
    caller?: Frame,
  ): Value {
    const depth = (caller?.depth ?? 0) + 1;

    if (depth > MAX_CALL_DEPTH) {
      throw new Halt('calls nest too deep');
    }

    const def = fn.def;
    const selfClip = this.clipOf(self);
    const base = fn.base ?? selfClip;
    const locals = new AsObject();
    const frame: Frame = {
      movie: fn.movie,
      scope: { values: locals, kind: 'local', parent: fn.scope },
      pool: fn.pool,
      self,
      base,
      target: base,
      stack: [],
      depth,
    };
    const argumentsArray = this.array(args);

    argumentsArray.define('callee', callee);
    if (def.isVersion2) {
      // The SWF flags sit in the high half; the low byte is the register count
      const flags = def.flags >>> 16;
      const registers: Value[] = [undefined];
      const preload = (bit: number, value: () => Value) => {
        if (flags & bit) {
          registers.push(value());
        }
      };

      preload(PRELOAD.this, () =>
        flags & PRELOAD.suppressThis ? undefined : self,
      );
      if (flags & PRELOAD.arguments) {
        registers.push(argumentsArray);
      } else if (!(flags & PRELOAD.suppressArguments)) {
        locals.set('arguments', argumentsArray);
      }
      preload(PRELOAD.super, () => undefined);
      preload(PRELOAD.root, () => this.objectOf(this.stage.root));
      if (flags & PRELOAD.parent && base?.parent) {
        registers.push(this.objectOf(base.parent));
      }
      preload(PRELOAD.global, () => this.global);
      def.params.forEach((param, at) => {
        if (param.register > 0 && param.register < 256) {
          registers[param.register] = args[at];
        } else {
          locals.set(param.name, args[at]);
        }
      });
      frame.registers = registers;
    } else {
      locals.set('arguments', argumentsArray);
      def.params.forEach((param, at) => locals.set(param.name, args[at]));
    }

    const result = this.exec(def.body, frame);

    return result.returned ? result.value : undefined;
  }

  private construct(
    frame: Frame,
    ctor: Value,
    args: Value[],
    name: string,
  ): Value {
    const prototype = this.member(ctor, 'prototype');
    const made = new AsObject(
      prototype instanceof AsObject ? prototype : this.protos.object,
    );

    made.define('constructor', ctor);

    const result = this.callIn(frame, ctor, made, args, name);

    return result instanceof AsObject ? result : made;
  }

  /** A call made from running code, so nesting counts */
  private callIn(
    frame: Frame,
    callee: Value,
    self: Value,
    args: Value[],
    name: string,
  ): Value {
    if (callee instanceof AsObject && callee.kind.type === 'function') {
      return this.callBytecode(callee, callee.kind.fn, self, args, frame);
    }
    return this.call(callee, self, args, name);
  }

  private callNamed(frame: Frame, name: string, args: Value[]): Value {
    const found = this.lookupVariable(frame, name);
    const self =
      found.on ?? (frame.target ? this.objectOf(frame.target) : undefined);

    return this.callIn(frame, found.value, self, args, name);
  }

  private callMethod(
    frame: Frame,
    object: Value,
    name: Value,
    args: Value[],
  ): Value {
    if (object === undefined || object === null) {
      return undefined;
    }

    const method = name === undefined ? '' : this.string(name);

    if (!method) {
      return this.callIn(frame, object, undefined, args, '<blank>');
    }

    const callee = this.member(object, method);
    // A method nothing defines on an object nothing defines is the engine's
    const label =
      callee === undefined &&
      object instanceof AsObject &&
      object.kind.type !== 'clip'
        ? this.nameOf(object, method)
        : method;

    return this.callIn(frame, callee, object, args, label);
  }

  /** `owner.method` for the engine panel, naming the owner where it can */
  private nameOf(object: AsObject, method: string): string {
    for (const [name, value] of this.global.entries()) {
      if (value === object) {
        return `${name}.${method}`;
      }
    }
    return method;
  }

  // ---- execution

  /**
   * Runs one entry into the machine. Nothing a movie does may break the
   * page: a limit stops the script, and anything unexpected is reported
   * as the script's fault rather than thrown into the editor. The step
   * budget is the outermost entry's, so a frame script that gotos into
   * another cannot reset it, and entries nest only so deep.
   */
  private guard(what: string, run: () => unknown): unknown {
    if (this.nesting >= MAX_NESTING) {
      this.engine.log(
        `script skipped: ${what} nests ${MAX_NESTING} deep in other scripts`,
      );
      return undefined;
    }
    if (this.nesting === 0) {
      this.budget = MAX_STEPS;
    }
    this.nesting++;
    try {
      return run();
    } catch (error) {
      this.engine.log(
        error instanceof Halt
          ? `script stopped in ${what}: ${error.message}`
          : `script failed in ${what}: ${describeError(error)}`,
      );
      return undefined;
    } finally {
      this.nesting--;
      if (this.nesting === 0) {
        this.stage.idle();
      }
    }
  }

  private exec(
    code: AptInstruction[],
    frame: Frame,
  ): { returned: boolean; value?: Value } {
    const index = indexOf(code);
    // An unload handler runs on a clip already taken off; only a removal
    // during this code stops it
    const wasRemoved = frame.base?.removed;

    for (let pc = 0; pc < code.length; ) {
      if (--this.budget < 0) {
        throw new Halt(`over ${MAX_STEPS} instructions in one action`);
      }

      const instruction = code[pc++];
      const outcome = this.step(instruction, frame);

      if (outcome === 'end') {
        return { returned: false };
      }
      if (outcome && typeof outcome === 'object') {
        if ('jump' in outcome) {
          const to = index.get(outcome.jump);

          if (to === undefined) {
            if (outcome.jump >= (code.at(-1)?.offset ?? 0)) {
              return { returned: false };
            }
            throw new Halt(`a branch to ${outcome.jump} lands mid-instruction`);
          }
          pc = to;
        } else {
          return { returned: true, value: outcome.value };
        }
      }
      // Code of a clip that was removed stops (Ruffle continue_if_base_clip_exists)
      if (frame.base?.removed && !wasRemoved) {
        return { returned: false };
      }
    }
    return { returned: false };
  }

  private push(frame: Frame, value: Value): void {
    if (frame.stack.length >= MAX_STACK) {
      throw new Halt('the operand stack overflowed');
    }
    frame.stack.push(value);
  }

  private pop(frame: Frame): Value {
    if (!frame.stack.length) {
      throw new Halt('the operand stack ran out');
    }
    return frame.stack.pop();
  }

  private popCount(frame: Frame): number {
    const n = toNumber(this.pop(frame));

    if (!(n >= 0 && n <= 65_536)) {
      throw new Halt('an argument count out of range');
    }
    return Math.trunc(n);
  }

  private popArgs(frame: Frame): Value[] {
    const count = this.popCount(frame);

    return Array.from({ length: count }, () => this.pop(frame));
  }

  private readRegister(frame: Frame, index: number): Value {
    return (frame.registers ?? this.registers)[index];
  }

  private writeRegister(frame: Frame, index: number, value: Value): void {
    if (index < 0 || index >= 256) {
      throw new Halt('a register index out of range');
    }
    (frame.registers ?? this.registers)[index] = value;
  }

  private constItem(frame: Frame, index: number): Value {
    const consts = frame.movie.consts ?? [];

    if (index < 0 || index >= consts.length) {
      throw new Halt(`constant ${index} is not in the .const file`);
    }
    return consts[index];
  }

  private poolItem(frame: Frame, index: number): Value {
    if (index < 0 || index >= frame.pool.length) {
      throw new Halt(`pool entry ${index} was never set`);
    }
    return frame.pool[index];
  }

  private concat(a: string, b: string): string {
    if (a.length + b.length > MAX_STRING) {
      throw new Halt('a string grew too long');
    }
    return a + b;
  }

  /** Where a call's result goes: pushed, dropped, or into a named variable */
  private deliver(frame: Frame, name: string, value: Value): void {
    if (name.endsWith('Pop')) {
      return;
    }
    if (name.startsWith('EA_Call')) {
      this.setVariable(frame, this.string(this.pop(frame)), value);
      return;
    }
    this.push(frame, value);
  }

  private defineFunction(frame: Frame, def: AptFunction): void {
    const prototype = new AsObject(this.protos.object);
    const fn = new AsObject(this.protos.function, {
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
      this.defineLocal(frame, def.name, fn);
    } else {
      this.push(frame, fn);
    }
  }

  private gotoValue(
    frame: Frame,
    clip: Instance,
    target: Value,
    stop: boolean,
  ): void {
    if (typeof target === 'number' && Number.isInteger(target)) {
      if (target > 0) {
        this.stage.goTo(clip, target - 1, !stop);
      }
      return;
    }

    const text = this.string(target);
    const separator = Math.max(text.lastIndexOf(':'), text.lastIndexOf('.'));
    let on: Instance | undefined = clip;
    let label = text;

    if (separator >= 0) {
      on = this.clipOf(
        this.resolvePath(frame, this.objectOf(clip), text.slice(0, separator)),
      );
      label = text.slice(separator + 1);
    }
    if (!on) {
      return;
    }

    const number = Number(label);

    if (label.trim() && !Number.isNaN(number)) {
      if (number > 0) {
        this.stage.goTo(on, Math.trunc(number) - 1, !stop);
      }
      return;
    }

    const at = this.stage.labelFrame(on, label);

    if (at !== undefined) {
      this.stage.goTo(on, at, !stop);
    }
  }

  /** Native `gotoAndPlay` and friends reach here */
  public goto(clip: Instance, target: Value, stop: boolean): void {
    this.gotoValue(
      {
        movie: clip.movie,
        scope: this.targetScope(clip),
        pool: [],
        self: this.objectOf(clip),
        target: clip,
        base: clip,
        stack: [],
        depth: 0,
      },
      clip,
      target,
      stop,
    );
  }

  private getUrl(frame: Frame, url: string, target: string): void {
    if (/^fscommand:/i.test(url)) {
      this.engine.command(url.slice(10), target);
      return;
    }
    this.engine.call('getURL', [url, target]);

    // A target that names a clip or level is Flash's loadMovie (an empty
    // URL its unloadMovie); a window target is only the call above
    if (!isWindowTarget(target)) {
      const level = parseLevel(target);
      const into =
        level ??
        this.targetClip(frame, frame.target ?? this.stage.root, target, false);

      if (into === undefined) {
        this.engine.log(`loadMovie: no clip ${JSON.stringify(target)}`);
      } else {
        this.loadMovie(into, url);
      }
    }
  }

  /** Loads the movie a URL names into a clip or level; an empty URL unloads */
  public loadMovie(into: Instance | number, url: string): void {
    this.engine.log(
      `${url ? `loadMovie ${JSON.stringify(url)}` : 'unloadMovie'} into ${
        typeof into === 'number' ? `_level${into}` : this.targetPath(into, '.')
      }`,
    );
    this.stage.loadMovie(into, url.trim() || undefined);
  }

  private enumerate(frame: Frame, value: Value): void {
    this.push(frame, undefined);
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

    const clip = this.clipOf(value);

    for (const child of clip ? [...clip.children.values()].reverse() : []) {
      if (child.name) {
        keys.push(child.name);
      }
    }
    for (const key of keys.reverse()) {
      this.push(frame, key);
    }
  }

  private typeOf(value: Value): string {
    if (value === undefined) {
      return 'undefined';
    }
    if (value === null) {
      return 'null';
    }
    if (typeof value !== 'object') {
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
  }

  private step(
    instruction: AptInstruction,
    frame: Frame,
  ): undefined | 'end' | { jump: number } | { value: Value } {
    const { name, operand } = instruction;
    const pop = () => this.pop(frame);
    const push = (value: Value) => this.push(frame, value);
    const num = () => toNumber(pop());
    const text = () => this.string(pop());

    switch (name) {
      case 'End':
        return 'end';
      case 'Return':
        return { value: pop() };

      // ---- pushes
      case 'EA_PushZero':
        push(0);
        break;
      case 'EA_PushOne':
        push(1);
        break;
      case 'EA_PushTrue':
        push(true);
        break;
      case 'EA_PushFalse':
        push(false);
        break;
      case 'EA_PushNull':
        push(null);
        break;
      case 'EA_PushUndefined':
        push(undefined);
        break;
      case 'EA_PushByte':
      case 'EA_PushShort':
      case 'EA_PushLong':
      case 'EA_PushFloat':
        push(operand as number);
        break;
      case 'EA_PushString':
        push(operand as string);
        break;
      case 'EA_PushThis':
        push(frame.self);
        break;
      case 'EA_PushGlobal':
        push(this.global);
        break;
      case 'EA_PushConstant':
      case 'EA_PushWordConstant':
        push(this.poolItem(frame, operand as number));
        break;
      case 'EA_PushRegister':
        push(this.readRegister(frame, operand as number));
        break;
      case 'PushData':
        for (const at of operand as number[]) {
          const item = this.constItem(frame, at);

          // A number item is a register (apt-format.md, "PushData pushes a register")
          push(
            typeof item === 'number' && item >= 0
              ? this.readRegister(frame, item)
              : item,
          );
        }
        break;
      case 'ConstantPool':
        frame.pool = (operand as number[]).map((at) =>
          this.constItem(frame, at),
        );
        break;
      case 'Pop':
        pop();
        break;
      case 'Dup': {
        if (!frame.stack.length) {
          throw new Halt('the operand stack ran out');
        }
        push(frame.stack[frame.stack.length - 1]);
        break;
      }
      case 'Swap': {
        const a = pop();
        const b = pop();

        push(a);
        push(b);
        break;
      }
      case 'SetRegister':
        if (!frame.stack.length) {
          throw new Halt('the operand stack ran out');
        }
        this.writeRegister(
          frame,
          operand as number,
          frame.stack[frame.stack.length - 1],
        );
        break;

      // ---- variables
      case 'GetVariable':
        push(this.getVariable(frame, text()).value);
        break;
      case 'SetVariable': {
        const value = pop();
        const target = text();

        if (target.toLowerCase() === 'this') {
          frame.self = value;
        } else {
          this.setVariable(frame, target, value);
        }
        break;
      }
      case 'EA_PushValueOfVar':
        push(
          this.getVariable(
            frame,
            this.string(this.poolItem(frame, operand as number)),
          ).value,
        );
        break;
      case 'EA_GetStringVar':
        push(this.getVariable(frame, operand as string).value);
        break;
      case 'EA_SetStringVar':
        this.setVariable(frame, text(), operand as string);
        break;
      case 'EA_ZeroVariable':
        this.setVariable(frame, text(), 0);
        break;
      case 'DefineLocal': {
        const value = pop();

        this.defineLocal(frame, text(), value);
        break;
      }
      case 'Var': {
        const local = text();

        if (!frame.scope.values.has(local)) {
          this.defineLocal(frame, local, undefined);
        }
        break;
      }
      case 'Delete': {
        const key = text();
        const object = pop();

        push(object instanceof AsObject && object.delete(key));
        break;
      }
      case 'Delete2': {
        const key = text();
        let removed = false;

        for (
          let scope: Scope | undefined = frame.scope;
          scope && !removed;
          scope = scope.parent
        ) {
          removed = scope.values.delete(key);
        }
        push(removed);
        break;
      }

      // ---- members
      case 'GetMember': {
        const key = text();

        push(this.member(pop(), key));
        break;
      }
      case 'SetMember': {
        const value = pop();
        const key = text();

        this.setMember(pop(), key, value);
        break;
      }
      case 'EA_GetNamedMember':
        push(
          this.member(
            pop(),
            this.string(this.poolItem(frame, operand as number)),
          ),
        );
        break;
      case 'EA_GetStringMember':
        push(this.member(pop(), operand as string));
        break;
      case 'EA_SetStringMember': {
        const key = text();

        this.setMember(pop(), key, operand as string);
        break;
      }
      case 'InitObject': {
        const count = this.popCount(frame);
        const object = this.object();

        for (let at = 0; at < count; at++) {
          const value = pop();

          this.setMember(object, text(), value);
        }
        push(object);
        break;
      }
      case 'InitArray': {
        const count = this.popCount(frame);

        push(this.array(Array.from({ length: count }, () => pop())));
        break;
      }
      case 'Enumerate':
        this.enumerate(frame, this.getVariable(frame, text()).value);
        break;
      case 'Enumerate2':
        this.enumerate(frame, pop());
        break;

      // ---- arithmetic and comparison
      case 'Add':
      case 'Subtract':
      case 'Multiply':
      case 'Divide':
      case 'Modulo': {
        const b = num();
        const a = num();

        push(
          name === 'Add'
            ? a + b
            : name === 'Subtract'
              ? a - b
              : name === 'Multiply'
                ? a * b
                : name === 'Divide'
                  ? a / b
                  : a % b,
        );
        break;
      }
      case 'NewAdd': {
        const b = pop();
        const a = pop();

        push(
          typeof a === 'string' || typeof b === 'string'
            ? this.concat(this.string(a), this.string(b))
            : toNumber(a) + toNumber(b),
        );
        break;
      }
      case 'StringConcat': {
        const b = text();

        push(this.concat(text(), b));
        break;
      }
      case 'Increment':
        push(num() + 1);
        break;
      case 'Decrement':
        push(num() - 1);
        break;
      case 'Equals':
      case 'LessThan': {
        const b = num();
        const a = num();

        push(name === 'Equals' ? a === b : a < b);
        break;
      }
      case 'NewEquals': {
        const b = pop();

        push(looseEquals(pop(), b));
        break;
      }
      case 'StrictEquals': {
        const b = pop();

        push(pop() === b);
        break;
      }
      case 'NewLessThan':
      case 'Greater': {
        const b = pop();
        const a = pop();
        const greater = name === 'Greater';

        push(
          typeof a === 'string' && typeof b === 'string'
            ? greater
              ? a > b
              : a < b
            : greater
              ? toNumber(a) > toNumber(b)
              : toNumber(a) < toNumber(b),
        );
        break;
      }
      case 'StringEquals':
      case 'StringGreater':
      case 'StringCompare': {
        const b = text();
        const a = text();

        push(
          name === 'StringEquals'
            ? a === b
            : name === 'StringGreater'
              ? a > b
              : a < b,
        );
        break;
      }
      case 'StringLength':
      case 'MbLength':
        push([...text()].length);
        break;
      case 'Substring':
      case 'MbSubstring': {
        const count = toInt32(pop());
        const at = toInt32(pop());
        const from = [...text()];

        push(
          from
            .slice(
              Math.max(0, at - 1),
              Math.max(0, at - 1) + Math.max(0, count),
            )
            .join(''),
        );
        break;
      }
      case 'Ord':
      case 'MbOrd':
        push(text().codePointAt(0) ?? 0);
        break;
      case 'Chr':
      case 'MbChr': {
        const code = toInt32(pop());

        push(code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '');
        break;
      }
      case 'LogicalNot':
        push(!toBoolean(pop()));
        break;
      case 'LogicalAnd':
      case 'LogicalOr': {
        const b = toBoolean(pop());
        const a = toBoolean(pop());

        push(name === 'LogicalAnd' ? a && b : a || b);
        break;
      }
      case 'BitwiseAnd':
      case 'BitwiseOr':
      case 'BitwiseXor':
      case 'ShiftLeft':
      case 'ShiftRight':
      case 'ShiftRight2': {
        const y = toInt32(pop());
        const x = toInt32(pop());

        push(
          name === 'BitwiseAnd'
            ? x & y
            : name === 'BitwiseOr'
              ? x | y
              : name === 'BitwiseXor'
                ? x ^ y
                : name === 'ShiftLeft'
                  ? x << (y & 31)
                  : name === 'ShiftRight'
                    ? x >> (y & 31)
                    : x >>> (y & 31),
        );
        break;
      }
      case 'ToNumber':
        push(num());
        break;
      case 'ToInteger': {
        const n = num();

        push(Number.isNaN(n) ? 0 : Math.trunc(n));
        break;
      }
      case 'ToString':
        push(text());
        break;
      case 'TypeOf':
        push(this.typeOf(pop()));
        break;
      case 'Random': {
        const max = toInt32(pop());

        push(max > 0 ? Math.floor(this.random() * max) : 0);
        break;
      }
      case 'GetTimer':
        push(this.now());
        break;
      case 'Trace':
        this.engine.log(`trace: ${text()}`);
        break;
      case 'ToggleQuality':
      case 'StopSounds':
      case 'StartDragMovie':
      case 'StopDragMovie':
        break;

      // ---- control flow
      case 'BranchAlways':
        return { jump: instruction.target! };
      case 'BranchIfTrue':
        if (toBoolean(pop())) {
          return { jump: instruction.target! };
        }
        break;
      case 'EA_BranchIfFalse':
        if (!toBoolean(pop())) {
          return { jump: instruction.target! };
        }
        break;

      // ---- timelines
      case 'Stop':
      case 'Play':
        if (frame.target) {
          this.stage.setPlaying(frame.target, name === 'Play');
        }
        break;
      case 'NextFrame':
      case 'PrevFrame':
        if (frame.target) {
          this.stage.goTo(
            frame.target,
            frame.target.frame + (name === 'NextFrame' ? 1 : -1),
            false,
          );
        }
        break;
      case 'GotoFrame':
        if (frame.target) {
          this.stage.goTo(frame.target, operand as number, false);
        }
        break;
      case 'GotoLabel':
        if (frame.target) {
          const at = this.stage.labelFrame(frame.target, operand as string);

          if (at !== undefined) {
            this.stage.goTo(frame.target, at, false);
          }
        }
        break;
      case 'GotoExpression': {
        const target = pop();
        const clip = frame.target ?? this.stage.root;

        this.gotoValue(frame, clip, target, !((operand as number) & 1));
        break;
      }
      case 'SetTarget':
        this.setTarget(frame, operand as string);
        break;
      case 'SetTargetExpression':
        this.setTarget(frame, pop());
        break;
      case 'GetUrl': {
        const [url, target] = operand as [string, string];

        this.getUrl(frame, url, target);
        break;
      }
      case 'GetUrl2': {
        const target = text();

        this.getUrl(frame, text(), target);
        break;
      }
      case 'TargetPath': {
        const clip = this.clipOf(pop());

        push(clip ? this.targetPath(clip, '.') : undefined);
        break;
      }
      case 'GetProperty': {
        const index = toInt32(pop());
        const path = pop();
        const clip = this.targetClip(
          frame,
          frame.target ?? this.stage.root,
          path,
          true,
        );
        const property = DISPLAY_PROPERTIES[index];

        push(
          clip && property ? this.displayProperty(clip, property) : undefined,
        );
        break;
      }
      case 'SetProperty': {
        const value = pop();
        const index = toInt32(pop());
        const path = pop();
        const clip = this.targetClip(
          frame,
          frame.target ?? this.stage.root,
          path,
          true,
        );
        const property = DISPLAY_PROPERTIES[index];

        if (clip && property) {
          this.setDisplayProperty(clip, property, value);
        }
        break;
      }
      case 'DuplicateClip': {
        const depth = toInt32(pop());
        const newName = text();
        const target = pop();
        const clip = this.targetClip(
          frame,
          frame.target ?? this.stage.root,
          target,
          false,
        );

        if (clip?.parent) {
          this.stage.attach(
            clip.parent,
            `#${clip.id}`,
            newName,
            depth + SCRIPT_DEPTH_BIAS,
          );
        }
        break;
      }
      case 'RemoveClip': {
        const clip = this.targetClip(
          frame,
          frame.target ?? this.stage.root,
          pop(),
          true,
        );

        if (clip) {
          this.stage.remove(clip);
        }
        break;
      }

      // ---- functions
      case 'DefineFunction':
      case 'DefineFunction2':
        this.defineFunction(frame, operand as AptFunction);
        break;
      case 'CallFunction':
      case 'EA_CallFunction':
      case 'EA_CallFunctionPop': {
        const callee = text();

        this.deliver(
          frame,
          name,
          this.callNamed(frame, callee, this.popArgs(frame)),
        );
        break;
      }
      case 'EA_CallNamedFunction':
      case 'EA_CallNamedFunctionPop': {
        const callee = this.string(this.poolItem(frame, operand as number));

        this.deliver(
          frame,
          name,
          this.callNamed(frame, callee, this.popArgs(frame)),
        );
        break;
      }
      case 'CallMethod':
      case 'EA_CallMethod':
      case 'EA_CallMethodPop': {
        const method = pop();
        const object = pop();

        this.deliver(
          frame,
          name,
          this.callMethod(frame, object, method, this.popArgs(frame)),
        );
        break;
      }
      case 'EA_CallNamedMethod':
      case 'EA_CallNamedMethodPop': {
        const method = this.poolItem(frame, operand as number);
        const object = pop();

        this.deliver(
          frame,
          name,
          this.callMethod(frame, object, method, this.popArgs(frame)),
        );
        break;
      }
      case 'New': {
        const ctorName = text();
        const args = this.popArgs(frame);

        push(
          this.construct(
            frame,
            this.resolve(frame, ctorName).value,
            args,
            ctorName,
          ),
        );
        break;
      }
      case 'NewMethod': {
        const method = pop();
        const object = pop();
        const args = this.popArgs(frame);

        if (object === undefined || object === null) {
          push(undefined);
        } else {
          const key = method === undefined ? '' : this.string(method);

          push(
            this.construct(
              frame,
              key ? this.member(object, key) : object,
              args,
              key,
            ),
          );
        }
        break;
      }
      case 'InstanceOf': {
        const ctor = pop();
        const object = pop();
        const prototype = this.member(ctor, 'prototype');
        let found = false;

        for (
          let at =
              object instanceof AsObject ? object.proto : this.protoOf(object),
            hops = 0;
          at && hops < 256;
          at = at.proto, hops++
        ) {
          if (at === prototype) {
            found = true;
            break;
          }
        }
        push(found);
        break;
      }
      case 'With':
      case 'Try':
      case 'Throw':
      case 'CastOp':
      case 'ImplementsOp':
      case 'Extends':
      case 'WaitForFrame':
      case 'WaitForFrameExpression':
      case 'CallFrame':
        throw new Halt(`${name} is not run by the preview`);
      default:
        throw new Halt(`${name} is not run by the preview`);
    }
    return undefined;
  }

  private setTarget(frame: Frame, target: Value): void {
    const empty =
      target === undefined || (typeof target === 'string' && !target);

    frame.target = empty
      ? frame.base
      : frame.base && this.targetClip(frame, frame.base, target, false);

    const values = frame.target ? this.objectOf(frame.target) : this.global;
    const replace = (scope: Scope): Scope =>
      scope.kind === 'target'
        ? { ...scope, values }
        : scope.kind === 'local' && scope.parent
          ? { ...scope, parent: replace(scope.parent) }
          : scope;

    frame.scope = replace(frame.scope);
  }

  /** Creates the function object of a native, named `name` */
  public native(name: string, call: NativeFunction): AsObject {
    const fn = new AsObject(this.protos.function, { type: 'native', call });

    fn.define('name', name);
    return fn;
  }
}
