import { describeError } from '../../../core/errors';
import type { Instance } from '../instance';
import { callValue, joinArray, toAvmString } from './calls';
import { getMember, getTargetPath } from './displayObjects';
import { execute, MAX_STEPS } from './execution';
import { Halt } from './halt';
import { setMember } from './memberWrites';
import { installNatives } from './natives';
import {
  createArray,
  createClipFrame,
  getClipObject,
  getClipOf,
} from './objects';
import { OPERATIONS } from './ops/operations';
import { gotoValue } from './ops/timelineOps';
import { AsObject } from './value';
import type {
  BuiltinProtos,
  NativeFunction,
  StageHost,
  Value,
} from './value';
import {
  findTargetClip,
  getVariable,
  lookupVariable,
  setVariable,
} from './variables';
import type {
  EngineHooks,
  EngineVm,
  Operation,
  VmState,
} from './vmState';

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
 *
 * This class holds the machine's state and its entries from outside. The
 * interpreter is functions over that state: `execution.ts` is the loop,
 * `ops/*` the opcodes by group.
 */

/** Scripts started inside other scripts, by gotos and calls, at most */
const MAX_NESTING = 32;

/** AVM1 interpreter running one movie's scripts against the player's clips */
export class Vm implements VmState, EngineVm {
  /** The `_global` object */
  public readonly global: AsObject;
  /** Prototypes of the built-in classes, each inheriting from `object` */
  public readonly protos: BuiltinProtos;
  /** The `extern` object, whose members the engine answers */
  public readonly externObject: AsObject;
  /** Script objects of the clips scripts have touched */
  public readonly clips = new WeakMap<Instance, AsObject>();
  /** The registers of code outside a `DefineFunction2` */
  public readonly registers: Value[] = [];
  /** Instructions left to the outermost entry into the machine */
  public budget = MAX_STEPS;
  /** The dispatch table `execute` runs instructions through */
  public readonly operations: ReadonlyMap<string, Operation> = OPERATIONS;
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
    public readonly engine: EngineHooks,
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
        execute(this, code, createClipFrame(this, clip, owner.movie)),
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

  /**
   * Writes a value at a path from the root, as the engine's override of it:
   * `side` is `_root.side`. Nothing is written where it already holds, or
   * over a clip or object the movie keeps under the name.
   */
  public assertValue(path: string, value: Value): void {
    const frame = createClipFrame(this, this.stage.root);
    const target = `_root.${path}`;
    const held = lookupVariable(this, frame, target).value;

    if (held instanceof AsObject || Object.is(held, value)) {
      return;
    }
    setVariable(this, frame, target, value);
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
      () => getVariable(this, createClipFrame(this, clip), name, false).value,
    ) as Value;
  }

  /** Whether a script is running, so a frame entered now waits its turn */
  public get isBusy(): boolean {
    return this.nesting > 0;
  }

  /** Gets a clip's script object if a script has touched it, without making one */
  public peekObject(instance: Instance): AsObject | undefined {
    return this.clips.get(instance);
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

  /** Gets the target path of a clip, as `_level0.a.b` or `/a/b` */
  public targetPath(instance: Instance, separator: '.' | '/'): string {
    return getTargetPath(instance, separator);
  }

  // ---- NativeHost

  /** Gets the script object of a clip, made on first use */
  public objectOf(instance: Instance): AsObject {
    return getClipObject(this, instance);
  }

  /** Finds the clip a target path or clip value names, a path read from `from` */
  public clipAt(target: Value, from: Instance): Instance | undefined {
    return findTargetClip(
      this,
      createClipFrame(this, from),
      from,
      target,
      false,
    );
  }

  /** Gets the clip a value is the script object of, if it is one */
  public clipOf(value: Value): Instance | undefined {
    return getClipOf(value);
  }

  /** Converts a value to a string as AVM1 does */
  public string(value: Value): string {
    return toAvmString(this, value);
  }

  /** Joins an array's items as `Array.join` does; the length read is capped */
  public join(array: AsObject, separator: string): string {
    return joinArray(this, array, separator);
  }

  /** Creates an array object holding the values */
  public array(values: Value[]): AsObject {
    return createArray(this, values);
  }

  /** Creates an empty plain object */
  public object(): AsObject {
    return new AsObject(this.protos.object);
  }

  /** Creates the function object of a native, named `name` */
  public native(name: string, call: NativeFunction): AsObject {
    const fn = new AsObject(this.protos.function, { type: 'native', call });

    fn.define('name', name);
    return fn;
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

  /** Gets a member of a value, through prototypes, clip children and display properties */
  public member(object: Value, name: string): Value {
    return getMember(this, object, name);
  }

  /** Sets a member of an object; a clip's display property moves the clip */
  public setMember(object: Value, name: string, value: Value): void {
    setMember(this, object, name, value);
  }

  /** Calls a function value; one nothing defines is asked of the engine under `name` */
  public call(callee: Value, self: Value, args: Value[], name: string): Value {
    return callValue(this, callee, self, args, name);
  }

  /** Native `gotoAndPlay` and friends reach here */
  public goto(clip: Instance, target: Value, stop: boolean): void {
    gotoValue(this, createClipFrame(this, clip), clip, target, stop);
  }

  /** Loads the movie a URL names into a clip or level; an empty URL unloads */
  public loadMovie(into: Instance | number, url: string): void {
    this.engine.log(
      `${url ? `loadMovie ${JSON.stringify(url)}` : 'unloadMovie'} into ${
        typeof into === 'number' ? `_level${into}` : getTargetPath(into, '.')
      }`,
    );
    this.stage.loadMovie(into, url.trim() || undefined);
  }
}
