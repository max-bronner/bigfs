import type { AptInstruction } from '../../../formats/apt/aptBytecode';
import type { PageMovie } from '../protocol';
import { soundEventOf } from './movieLoad';
import { AsObject } from './value';
import type { Value } from './value';
import type { EngineHooks, Vm } from './vm';

/**
 * The game's side of a movie, played by hand: everything the movie asks
 * of the engine is found while it runs, listed, and answered with values
 * the user types. Nothing here knows a particular movie or engine
 * function; what is listed is what this movie's own code reaches for:
 *
 * - **values**: names its code reads that nothing in it sets, and the
 *   keys it asks `GetExtern`/`extern.` for
 * - **calls**: `GameCode`, `FSCommand:` and functions nothing defines,
 *   counted with their last arguments, each with a value to return
 * - **sounds**: the events `PlaySound` asks for, played only on request
 *   or while `playMovieSounds` is ticked
 * - **entry points**: functions it stores that its own code never names
 *   again, so only the engine calls them (`SetPlayerFaction` in the
 *   palantir: mint's palantir research, point 7)
 */

export interface Seen {
  name: string;
  count: number;
  last?: string[];
}

/** A variable the movie read: what it held when last read */
export interface ReadValue {
  name: string;
  count: number;
  value: Value;
  /** Whether the movie holds it at all, or only an override could */
  found: boolean;
}

export interface FunctionEntry {
  /** Where it is stored, as a path: `_level0.SetPlayerFaction` */
  path: string;
  name: string;
  params: string[];
  owner: AsObject;
  fn: AsObject;
  /** Whether the movie's own code never names it, so the engine calls it */
  engineOnly: boolean;
}

/** A sound the movie asked the engine to play, with how often */
export interface SoundAsked {
  event: string;
  count: number;
}

/** What the user set, kept per movie between sessions */
export interface EngineValues {
  /** Values that win over what the movie holds, by path from the root */
  overrides?: Record<string, string>;
  /** Values `GetExtern`/`extern.` answer, by key */
  externs?: Record<string, string>;
  /** What calls into the engine return, by function name */
  returns: Record<string, string>;
  /** Before overrides: values only for names nothing set */
  values?: Record<string, string>;
}

const parseNumber = (text: string): number => {
  const sign = text.startsWith('-') ? -1 : 1;
  const body = text.replace(/^[+-]/, '');

  if (/^0x/i.test(body)) {
    return sign * parseInt(body.slice(2), 16);
  }
  return /^nan$/i.test(body) ? NaN : sign * Number(body);
};

/** Reads typed text as a value: number, boolean, quoted or bare string */
export const parseTyped = (text: string): Value => {
  const trimmed = text.trim();

  if (!trimmed || trimmed === 'undefined') {
    return undefined;
  }
  if (trimmed === 'null') {
    return null;
  }
  if (trimmed === 'true' || trimmed === 'false') {
    return trimmed === 'true';
  }
  if (
    /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(trimmed) ||
    /^[+-]?0x[0-9a-f]+$/i.test(trimmed) ||
    /^[+-]?(infinity|nan)$/i.test(trimmed)
  ) {
    return parseNumber(trimmed);
  }

  const quoted = /^"(.*)"$|^'(.*)'$/.exec(trimmed);

  return quoted ? (quoted[1] ?? quoted[2]) : trimmed;
};

/**
 * How often each string is named in a movie's code: pushed, or used from
 * a constant pool. A function its code stores under a name it never names
 * again is one only the engine can call.
 */
const usesByMovie = new WeakMap<PageMovie, Map<string, number>>();

export const stringUses = (movie: PageMovie): Map<string, number> => {
  const known = usesByMovie.get(movie);

  if (known) {
    return known;
  }

  const uses = new Map<string, number>();
  // The name the previous instruction pushed last: a function stored by
  // `name = function ...` is defined there, not used
  let pushed: string | undefined;
  const count = (value: unknown) => {
    if (typeof value === 'string') {
      const key = value.toLowerCase();

      uses.set(key, (uses.get(key) ?? 0) + 1);
      pushed = key;
    }
  };
  const consts = movie.consts ?? [];
  const walk = (code: AptInstruction[], pool: unknown[]) => {
    for (const { name, operand } of code) {
      const before = pushed;

      pushed = undefined;
      switch (name) {
        case 'ConstantPool':
          pool = (operand as number[]).map((at) => consts[at]);
          break;
        case 'PushData':
          (operand as number[]).forEach((at) => count(consts[at]));
          break;
        case 'EA_PushConstant':
        case 'EA_PushWordConstant':
        case 'EA_PushValueOfVar':
        case 'EA_GetNamedMember':
        case 'EA_CallNamedFunction':
        case 'EA_CallNamedFunctionPop':
        case 'EA_CallNamedMethod':
        case 'EA_CallNamedMethodPop':
          count(pool[operand as number]);
          break;
        case 'EA_PushString':
        case 'EA_GetStringVar':
        case 'EA_GetStringMember':
        case 'GotoLabel':
        case 'SetTarget':
          count(operand);
          break;
        case 'DefineFunction':
        case 'DefineFunction2': {
          const { body, name: own } = operand as {
            body: AptInstruction[];
            name: string;
          };

          if (!own && before) {
            uses.set(before, (uses.get(before) ?? 1) - 1);
          }
          walk(body, pool);
          pushed = undefined;
          break;
        }
      }
    }
  };

  for (const code of Object.values(movie.code ?? {})) {
    walk(code, []);
  }
  usesByMovie.set(movie, uses);
  return uses;
};

/** Handlers the player calls on events; the engine never calls them */
const EVENT_HANDLERS = new Set(
  [
    'onEnterFrame',
    'onLoad',
    'onUnload',
    'onPress',
    'onRelease',
    'onReleaseOutside',
    'onRollOver',
    'onRollOut',
    'onDragOver',
    'onDragOut',
    'onKeyDown',
    'onKeyUp',
    'onMouseDown',
    'onMouseUp',
    'onMouseMove',
    'onSetFocus',
    'onKillFocus',
    'onChanged',
    'onData',
    'onScroller',
    'onConstruct',
    'onInitialize',
  ].map((name) => name.toLowerCase()),
);

/** Variables listed at most, so a movie reading thousands stays quick */
const MAX_READS = 2000;

/**
 * The key an override is kept and matched by: the whole path from the root,
 * lowercased, with `:` as `.` and `_root.`/`_level0.` dropped, so `side`,
 * `_root.side` and `_level0:side` are one. The last name alone is never a
 * match: `menu.side` is not `side`.
 */
export const pathKey = (path: string): string =>
  path
    .trim()
    .toLowerCase()
    .replace(/(?<!:):(?!:)/g, '.')
    .replace(/^(_root|_level0)\./, '');

/** What `GetExtern` answers for a key: the key as the movie spells it, lowercased */
const externKey = (name: string) => name.trim().toLowerCase();

export class Engine implements EngineHooks {
  /** Values that win over the movie's, typed as written, by `pathKey` */
  public readonly overrides = new Map<string, string>();
  /** Values `GetExtern` answers before anything the movie wrote, by extern key */
  public readonly externOverrides = new Map<string, string>();
  /** What the movie itself wrote to externs, shown read-only */
  public readonly externWrites = new Map<
    string,
    { name: string; value: string }
  >();
  public readonly returns = new Map<string, string>();
  public readonly reads = new Map<string, ReadValue>();
  public readonly externs = new Map<string, Seen>();
  public readonly calls = new Map<string, Seen>();
  public readonly functions = new Map<string, FunctionEntry>();
  /** The sounds the movie asked for (`PlaySound`), by lowercased event */
  public readonly sounds = new Map<string, SoundAsked>();
  /**
   * Whether the sounds the movie asks for play as it asks. Off at the start
   * of every session and never kept: sound is opt-in.
   */
  public playMovieSounds = false;
  /** Overrides read back as values, made once per change */
  private parsed = new Map<string, Value>();
  private written = new Map<string, Value>();
  private parsedExterns = new Map<string, Value>();
  private vm?: Vm;
  private uses = new Map<string, number>();
  private pending = false;

  public constructor(
    private readonly onChange: () => void,
    private readonly onLog: (line: string) => void,
    private readonly onSound: (event: string) => void = () => {},
  ) {}

  /** The machine of the run being watched */
  public bind(vm: Vm): void {
    this.vm = vm;
  }

  /** A fresh run of a movie: what was seen goes, what the user set stays */
  public reset(movie: PageMovie): void {
    this.uses = stringUses(movie);
    this.reads.clear();
    this.externs.clear();
    this.calls.clear();
    this.functions.clear();
    this.sounds.clear();
    this.externWrites.clear();
    this.written.clear();
    this.changed();
  }

  public load(saved: EngineValues | undefined): void {
    this.overrides.clear();
    this.externOverrides.clear();
    this.returns.clear();
    Object.entries({ ...saved?.values, ...saved?.overrides }).forEach(
      ([k, v]) =>
        // Keys saved before externs had their own table: `Game::Key` is one
        k.includes('::')
          ? this.externOverrides.set(externKey(k), v)
          : this.override(k, v),
    );
    Object.entries(saved?.externs ?? {}).forEach(([k, v]) =>
      this.externOverrides.set(externKey(k), v),
    );
    Object.entries(saved?.returns ?? {}).forEach(([k, v]) =>
      this.returns.set(k.toLowerCase(), v),
    );
    this.reparse();
  }

  public save(): EngineValues {
    return {
      overrides: Object.fromEntries(this.overrides),
      externs: Object.fromEntries(this.externOverrides),
      returns: Object.fromEntries(this.returns),
    };
  }

  /** Drops every override; what calls return stays */
  public clear(): void {
    this.overrides.clear();
    this.externOverrides.clear();
    this.reparse();
  }

  /**
   * Sets or clears (empty text) the override of a variable path, or of an
   * extern when written `extern.Key`
   */
  public override(name: string, text: string): void {
    if (/^extern\./i.test(name.trim())) {
      this.overrideExtern(name.trim().slice('extern.'.length), text);
      return;
    }
    this.store(this.overrides, pathKey(name), text);
  }

  public overrideExtern(name: string, text: string): void {
    this.store(this.externOverrides, externKey(name), text);
  }

  private store(table: Map<string, string>, key: string, text: string): void {
    if (text.trim()) {
      table.set(key, text);
    } else {
      table.delete(key);
    }
    this.reparse();
  }

  private reparse(): void {
    const read = (table: Map<string, string>) =>
      new Map([...table].map(([key, text]) => [key, parseTyped(text)]));

    this.parsed = read(this.overrides);
    this.parsedExterns = read(this.externOverrides);
  }

  /**
   * Writes the overrides into the movie, as mint's apt-player does with its
   * bound values: before and after each script, so `_root.side`,
   * `this.side` and `kid.side` read the override whatever the movie wrote.
   */
  public sync(): void {
    if (!this.vm || !this.parsed.size) {
      return;
    }
    for (const [key, value] of this.parsed) {
      if (value !== undefined) {
        this.vm.assertValue(key, value);
      }
    }
  }

  private changed(): void {
    if (this.pending) {
      return;
    }
    this.pending = true;
    setTimeout(() => {
      this.pending = false;
      this.onChange();
    }, 250);
  }

  private note(table: Map<string, Seen>, name: string, args?: string[]): void {
    const key = name.toLowerCase();
    const seen = table.get(key);

    if (seen) {
      seen.count++;
      seen.last = args ?? seen.last;
    } else {
      table.set(key, { name, count: 1, last: args });
      this.changed();
    }
  }

  // ---- EngineHooks

  public read(
    path: string,
    value: Value,
    found: boolean,
    counted: boolean,
    local: boolean,
  ): Value {
    // A function's own variable is not the game's to set or list
    if (local) {
      return value;
    }

    const key = pathKey(path);
    let seen = this.reads.get(key);

    if (!seen && this.reads.size < MAX_READS) {
      seen = { name: path, count: 0, value, found };
      this.reads.set(key, seen);
      this.changed();
    }
    if (seen) {
      seen.value = value;
      seen.found ||= found;
      if (counted) {
        seen.count++;
      }
    }
    return this.parsed.has(key) ? this.parsed.get(key) : value;
  }

  /** What the user set, else what the movie wrote, else nothing */
  public extern(name: string): Value {
    const key = externKey(name);

    this.note(this.externs, name);
    return this.parsedExterns.has(key)
      ? this.parsedExterns.get(key)
      : this.written.get(key);
  }

  /** The movie's own write: kept for its reads, never an override */
  public setExtern(name: string, value: Value): void {
    const key = externKey(name);
    const text = this.vm ? this.vm.string(value) : String(value);

    this.written.set(key, value);
    if (this.externWrites.get(key)?.value !== text) {
      this.externWrites.set(key, { name, value: text });
      this.changed();
    }
  }

  public call(name: string, args: string[]): Value {
    this.note(this.calls, name, args);
    this.onLog(
      `engine: ${name}(${args.map((arg) => JSON.stringify(arg)).join(', ')})`,
    );

    const sound = soundEventOf(name, args);

    if (sound) {
      this.heard(sound);
    }

    const text = this.returns.get(name.toLowerCase());

    return text === undefined ? undefined : parseTyped(text);
  }

  /** A sound the movie asks for: listed, logged, and played only when allowed */
  private heard(event: string): void {
    const key = event.toLowerCase();
    const asked = this.sounds.get(key);

    if (asked) {
      asked.count++;
    } else {
      this.sounds.set(key, { event, count: 1 });
      this.changed();
    }
    this.onLog(
      `movie sound: ${event} (${this.playMovieSounds ? 'playing' : 'not played, Play movie sounds is off'})`,
    );
    if (this.playMovieSounds) {
      this.onSound(event);
    }
  }

  /** Plays a listed sound once, because the user pressed its button */
  public playSound(event: string): void {
    this.onSound(event);
  }

  public command(command: string, args: string): void {
    this.call(`FSCommand:${command}`, args ? [args] : []);
  }

  public defined(owner: AsObject, name: string, fn: AsObject): void {
    if (fn.kind.type !== 'function') {
      return;
    }

    const clip = this.vm?.clipOf(owner);
    const where = clip
      ? this.vm!.targetPath(clip, '.')
      : owner === this.vm?.global
        ? '_global'
        : 'object';
    const path = `${where}.${name}`;

    if (!this.functions.has(path.toLowerCase())) {
      this.changed();
    }
    this.functions.set(path.toLowerCase(), {
      path,
      name,
      params: fn.kind.fn.def.params.map((param) => param.name),
      owner,
      fn,
      // Nothing in the movie names it besides where it is defined
      engineOnly:
        !EVENT_HANDLERS.has(name.toLowerCase()) &&
        (this.uses.get(name.toLowerCase()) ?? 0) === 0,
    });
  }

  public log(line: string): void {
    this.onLog(line);
  }

  /** Calls a function the way the engine would, with typed arguments */
  public invoke(entry: FunctionEntry, args: string[]): Value {
    this.onLog(`called ${entry.path}(${args.join(', ')})`);
    return this.vm?.callFromEngine(entry.fn, entry.owner, args.map(parseTyped));
  }
}
