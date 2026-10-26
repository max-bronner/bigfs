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

/** What the user typed, kept per movie between sessions */
export interface EngineValues {
  values: Record<string, string>;
  returns: Record<string, string>;
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
export const stringUses = (movie: PageMovie): Map<string, number> => {
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
  return uses;
};

export class Engine implements EngineHooks {
  public readonly values = new Map<string, string>();
  public readonly returns = new Map<string, string>();
  public readonly read = new Map<string, Seen>();
  public readonly externs = new Map<string, Seen>();
  public readonly calls = new Map<string, Seen>();
  public readonly functions = new Map<string, FunctionEntry>();
  /** Names the movie set itself, so they are not asked of the engine */
  private readonly written = new Set<string>();
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

  /** A fresh run of a movie: what was seen goes, what the user typed stays */
  public reset(movie: PageMovie): void {
    this.uses = stringUses(movie);
    this.read.clear();
    this.externs.clear();
    this.calls.clear();
    this.functions.clear();
    this.written.clear();
    this.changed();
  }

  public load(saved: EngineValues | undefined): void {
    this.values.clear();
    this.returns.clear();
    Object.entries(saved?.values ?? {}).forEach(([k, v]) =>
      this.values.set(k, v),
    );
    Object.entries(saved?.returns ?? {}).forEach(([k, v]) =>
      this.returns.set(k, v),
    );
  }

  public save(): EngineValues {
    return {
      values: Object.fromEntries(this.values),
      returns: Object.fromEntries(this.returns),
    };
  }

  private changed(): void {
    if (this.pending) {
      return;
    }
    this.pending = true;
    setTimeout(() => {
      this.pending = false;
      this.onChange();
    }, 150);
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

  /** The value the user gave a name, typed */
  private given(name: string): Value {
    const text = this.values.get(name.toLowerCase());

    return text === undefined ? undefined : parseTyped(text);
  }

  // ---- EngineHooks

  public extern(name: string): Value {
    this.note(this.externs, name);
    return this.given(name);
  }

  public setExtern(name: string, value: Value): void {
    this.values.set(
      name.toLowerCase(),
      this.vm ? this.vm.string(value) : String(value),
    );
    this.changed();
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

  public wrote(name: string): void {
    const key = name.toLowerCase();

    if (!this.written.has(key)) {
      this.written.add(key);
      if (this.read.delete(key)) {
        this.changed();
      }
    }
  }

  public missing(name: string): Value {
    if (!this.written.has(name.toLowerCase())) {
      this.note(this.read, name);
    }
    return this.given(name);
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

    this.functions.set(path.toLowerCase(), {
      path,
      name,
      params: fn.kind.fn.def.params.map((param) => param.name),
      owner,
      fn,
      // Named once, where it is stored: nothing in the movie calls it
      engineOnly: (this.uses.get(name.toLowerCase()) ?? 0) <= 1,
    });
    this.changed();
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
