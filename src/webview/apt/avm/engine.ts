import type { AptInstruction } from '../../../formats/apt/aptBytecode';
import type { PageMovie } from '../protocol';
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

/** What the user set, kept per movie between sessions */
export interface EngineValues {
  /** Values that win over what the movie holds, by name or path */
  overrides?: Record<string, string>;
  /** What calls into the engine return, by function name */
  returns: Record<string, string>;
  /** Before overrides: values only for names nothing set */
  values?: Record<string, string>;
}

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
  if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(trimmed)) {
    return Number(trimmed);
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
  const count = (value: unknown) => {
    if (typeof value === 'string') {
      const key = value.toLowerCase();

      uses.set(key, (uses.get(key) ?? 0) + 1);
    }
  };
  const consts = movie.consts ?? [];
  const walk = (code: AptInstruction[], pool: unknown[]) => {
    for (const { name, operand } of code) {
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
        case 'DefineFunction2':
          walk((operand as { body: AptInstruction[] }).body, pool);
          break;
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

/** The last part of a path: `_root.menu.side` is `side` */
const lastName = (path: string) =>
  path.slice(Math.max(path.lastIndexOf('.'), path.lastIndexOf(':')) + 1);

export class Engine implements EngineHooks {
  /** Values that win over the movie's, typed as written, by lowercased name or path */
  public readonly overrides = new Map<string, string>();
  public readonly returns = new Map<string, string>();
  public readonly reads = new Map<string, ReadValue>();
  public readonly externs = new Map<string, Seen>();
  public readonly calls = new Map<string, Seen>();
  public readonly functions = new Map<string, FunctionEntry>();
  /** Overrides read back as values, made once per change */
  private parsed = new Map<string, Value>();
  private vm?: Vm;
  private uses = new Map<string, number>();
  private pending = false;

  public constructor(
    private readonly onChange: () => void,
    private readonly onLog: (line: string) => void,
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
    this.changed();
  }

  public load(saved: EngineValues | undefined): void {
    this.overrides.clear();
    this.returns.clear();
    Object.entries({ ...saved?.values, ...saved?.overrides }).forEach(
      ([k, v]) => this.overrides.set(k.toLowerCase(), v),
    );
    Object.entries(saved?.returns ?? {}).forEach(([k, v]) =>
      this.returns.set(k.toLowerCase(), v),
    );
    this.reparse();
  }

  public save(): EngineValues {
    return {
      overrides: Object.fromEntries(this.overrides),
      returns: Object.fromEntries(this.returns),
    };
  }

  /** Drops every override and return value */
  public clear(): void {
    this.overrides.clear();
    this.returns.clear();
    this.reparse();
  }

  /** Sets or clears (empty text) an override */
  public override(name: string, text: string): void {
    if (text.trim()) {
      this.overrides.set(name.toLowerCase(), text);
    } else {
      this.overrides.delete(name.toLowerCase());
    }
    this.reparse();
  }

  private reparse(): void {
    this.parsed = new Map(
      [...this.overrides].map(([key, text]) => [key, parseTyped(text)]),
    );
  }

  /** The override for a name or path, by the whole path or its last name */
  private overridden(path: string): { value: Value } | undefined {
    if (!this.parsed.size) {
      return undefined;
    }

    const key = path.toLowerCase();

    for (const each of [key, lastName(key)]) {
      if (this.parsed.has(each)) {
        return { value: this.parsed.get(each) };
      }
    }
    return undefined;
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
  ): Value {
    const key = path.toLowerCase();
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
    const override = this.overridden(path);

    return override ? override.value : value;
  }

  public extern(name: string): Value {
    this.note(this.externs, name);
    return this.overridden(name)?.value;
  }

  public setExtern(name: string, value: Value): void {
    if (!this.overridden(name)) {
      this.override(name, this.vm ? this.vm.string(value) : String(value));
      this.changed();
    }
  }

  public call(name: string, args: string[]): Value {
    this.note(this.calls, name, args);
    this.onLog(
      `engine: ${name}(${args.map((arg) => JSON.stringify(arg)).join(', ')})`,
    );

    const text = this.returns.get(name.toLowerCase());

    return text === undefined ? undefined : parseTyped(text);
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
      // Named once, where it is stored: nothing in the movie calls it
      engineOnly:
        !EVENT_HANDLERS.has(name.toLowerCase()) &&
        (this.uses.get(name.toLowerCase()) ?? 0) <= 1,
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
