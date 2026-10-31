import type { AptInstruction } from '../../../formats/apt/aptBytecode';
import type { Instance } from '../instance';
import type { PageMovie } from '../protocol';
import type { AsObject, NativeHost, Scope, Value } from './value';

/** Engine boundary of the AVM: what the movie asks of the game, answered by the engine panel */
export interface EngineHooks {
  /** Binds the machine asking, told once when it starts */
  bind(vm: EngineVm): void;
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

/** View of the VM handed to the engine boundary, kept narrow so `Vm` stays above it */
export interface EngineVm extends NativeHost {
  /** Writes a value at a path from the root, as the engine's override of it */
  assertValue(path: string, value: Value): void;
  /** Calls a function value from outside, as the engine calls into a movie */
  callFromEngine(callee: Value, self: Value, args: Value[]): Value;
  /** Gets the target path of a clip, as `_level0.a.b` or `/a/b` */
  targetPath(instance: Instance, separator: '.' | '/'): string;
}

/** One running activation */
export interface Frame {
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
  /** The offset a `'jump'` outcome goes to */
  jumpTo?: number;
  /** The value a `'return'` outcome carries */
  returnValue?: Value;
}

/**
 * How one instruction leaves the running code: on to the next when undefined.
 * The destination and value travel on the frame, so an instruction allocates
 * nothing to say where to go.
 */
export type StepOutcome = undefined | 'end' | 'jump' | 'return';

/** Runs one instruction of a running frame */
export type Operation = (
  vm: VmState,
  frame: Frame,
  instruction: AptInstruction,
) => StepOutcome;

/** Operations by opcode name: one `ops/*` group */
export type OperationGroup = Record<string, Operation>;

/**
 * State of the machine, which the functions of `avm/` and `avm/ops/` run over.
 * `Vm` holds it. The dispatch table is part of it so that the interpreter loop
 * and the operations, which call back into the loop, do not import each other.
 */
export interface VmState extends NativeHost {
  /** The `extern` object, whose members the engine answers */
  readonly externObject: AsObject;
  readonly engine: EngineHooks;
  /** Script objects of the clips scripts have touched */
  readonly clips: WeakMap<Instance, AsObject>;
  /** The registers of code outside a `DefineFunction2` */
  readonly registers: Value[];
  /** Instructions left to the outermost entry into the machine */
  budget: number;
  /** The dispatch table `execute` runs instructions through */
  readonly operations: ReadonlyMap<string, Operation>;
}
