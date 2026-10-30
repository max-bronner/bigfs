import type { AptFunction } from '../../../formats/apt/aptBytecode';
import type { Instance } from '../player';
import type { PageMovie } from '../protocol';

/**
 * AVM1 values as the APT preview runs them, after mint's
 * `apt-player/src/avm/value.rs` and Ruffle's `avm1/value.rs` (SWF 6):
 * names are matched without casing, `undefined` is `NaN` as a number, and
 * a string is true when it reads as a non-zero number.
 */

/** Depth a script's number 0 is on the display list, above anything a timeline places */
export const SCRIPT_DEPTH_BIAS = 16384;

/** An AVM1 value: a primitive, or an object */
export type Value = undefined | null | boolean | number | string | AsObject;

/** A function the movie's bytecode defines, with the scope it closes over */
export interface BytecodeFunction {
  def: AptFunction;
  scope: Scope;
  pool: Value[];
  movie: PageMovie;
  /** The clip whose code defined it, which its body targets */
  base?: Instance;
}

/** Signature of a native function: it receives the VM, `this` and the arguments */
export type NativeFunction = (
  vm: NativeHost,
  self: Value,
  args: Value[],
) => Value;

/** View of the VM handed to natives, kept narrow so they stay small */
export interface NativeHost {
  string(value: Value): string;
  member(object: Value, name: string): Value;
  setMember(object: Value, name: string, value: Value): void;
  call(callee: Value, self: Value, args: Value[], name: string): Value;
  array(values: Value[]): AsObject;
  object(): AsObject;
  clipOf(value: Value): Instance | undefined;
  /** The clip a target path or clip value names, a path read from `from` */
  clipAt(target: Value, from: Instance): Instance | undefined;
  objectOf(instance: Instance): AsObject;
  readonly stage: StageHost;
  random(): number;
  now(): number;
  interval(callee: Value, self: Value, ms: number, args: Value[]): number;
  clearInterval(id: number): void;
}

/** Operations the VM asks of the player that draws the clips */
export interface StageHost {
  goTo(clip: Instance, frame: number, play: boolean): void;
  labelFrame(clip: Instance, label: string): number | undefined;
  setPlaying(clip: Instance, playing: boolean): void;
  attach(
    parent: Instance,
    linkage: string,
    name: string,
    depth: number,
  ): Instance | undefined;
  createEmpty(
    parent: Instance,
    name: string,
    depth: number,
  ): Instance | undefined;
  remove(clip: Instance): void;
  /** Signals that the machine finished its outermost script, so what it queued may run */
  idle(): void;
  /**
   * Loads the movie a URL names into a clip, or into a level (a number), for
   * `loadMovie`/`unloadMovie`; no URL empties it
   */
  loadMovie(into: Instance | number, url: string | undefined): void;
  readonly root: Instance;
}

/** What an object is beyond its properties: plain, an array, a function or a clip's object */
export type Kind =
  | { type: 'plain' }
  | { type: 'array' }
  | { type: 'function'; fn: BytecodeFunction }
  | { type: 'native'; call: NativeFunction }
  | { type: 'clip'; instance: Instance };

/** A scope chain link: Global, a clip's Target scope, or a call's Local */
export interface Scope {
  values: AsObject;
  parent?: Scope;
  kind: 'global' | 'target' | 'local';
}

/** AVM1 object: properties by lowercased name, keeping the casing first written */
export class AsObject {
  private readonly props = new Map<
    string,
    { name: string; value: Value; hidden: boolean }
  >();

  public constructor(
    public proto?: AsObject,
    public kind: Kind = { type: 'plain' },
  ) {}

  /** Whether the object has an own property of the name, ignoring casing */
  public has(name: string): boolean {
    return this.props.has(name.toLowerCase());
  }

  /** Gets an own property's value, ignoring casing; the prototype is not consulted */
  public get(name: string): Value {
    return this.props.get(name.toLowerCase())?.value;
  }

  /** Sets an own property, keeping the casing it was first written with */
  public set(name: string, value: Value): void {
    const key = name.toLowerCase();
    const existing = this.props.get(key);

    if (existing) {
      existing.value = value;
    } else {
      this.props.set(key, { name, value, hidden: false });
    }
  }

  /** Defines a property `for..in` does not list */
  public define(name: string, value: Value): void {
    this.props.set(name.toLowerCase(), { name, value, hidden: true });
  }

  /** Deletes an own property, ignoring casing */
  public delete(name: string): boolean {
    return this.props.delete(name.toLowerCase());
  }

  /** Lists the own names `for..in` lists, in the order written */
  public keys(): string[] {
    return [...this.props.values()].filter((p) => !p.hidden).map((p) => p.name);
  }

  /** Lists every own property, hidden ones included, for the engine panel */
  public entries(): [string, Value][] {
    return [...this.props.values()].map((p) => [p.name, p.value]);
  }
}

/** Parses text as AVM1 does: empty is 0, and `0x` reads as hex */
export const parseNumber = (text: string): number => {
  const trimmed = text.trim();

  if (!trimmed) {
    return 0;
  }
  if (/^0x[0-9a-f]+$/i.test(trimmed)) {
    return parseInt(trimmed.slice(2), 16);
  }

  const n = Number(trimmed);

  return Number.isNaN(n) &&
    /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(trimmed)
    ? parseFloat(trimmed)
    : n;
};

/** Converts a value to a number as AVM1 does: `undefined` and objects are NaN, null is 0 */
export const toNumber = (value: Value): number =>
  value === undefined || value instanceof AsObject
    ? NaN
    : value === null
      ? 0
      : typeof value === 'boolean'
        ? Number(value)
        : typeof value === 'number'
          ? value
          : parseNumber(value);

/** Converts a value to a boolean as AVM1 does: a string is true when it reads as a non-zero number */
export const toBoolean = (value: Value): boolean => {
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (value instanceof AsObject) {
    return true;
  }

  const n = toNumber(value);

  return n !== 0 && !Number.isNaN(n);
};

/** Converts a value to a 32-bit integer, with anything not finite as 0 */
export const toInt32 = (value: Value): number => {
  const n = toNumber(value);

  return Number.isFinite(n) ? Math.trunc(n) | 0 : 0;
};

/** Formats a number as AVM1 prints it */
export const formatNumber = (n: number): string =>
  Number.isNaN(n)
    ? 'NaN'
    : !Number.isFinite(n)
      ? n > 0
        ? 'Infinity'
        : '-Infinity'
      : String(n);

/** Whether two values are equal under AVM1's `==` */
export const looseEquals = (a: Value, b: Value): boolean => {
  const absent = (v: Value) => v === undefined || v === null;

  if (absent(a) || absent(b)) {
    return absent(a) && absent(b);
  }
  if (typeof a === 'string' && typeof b === 'string') {
    return a === b;
  }
  if (a instanceof AsObject || b instanceof AsObject) {
    return a === b;
  }

  const x = toNumber(a);
  const y = toNumber(b);

  return !Number.isNaN(x) && x === y;
};
