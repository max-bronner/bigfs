import {
  AptFunction,
  AptInstruction,
  OPCODE_BY_NAME,
  getOperandShape,
} from './aptBytecode';
import { OPERATORS, STACK_EFFECT } from './aptDecompiler';
import { ConstItem } from './aptMovie';
import { Expr, FuncDef, Keyword, Operand, Stmt } from './aptScriptSyntax';
import { AptImage } from './aptWriter';

/**
 * Compiles the script language back into APT bytecode. Every construct has
 * one fixed lowering - the inverse of what `aptDecompiler.ts` lifts - and the
 * encodings that only differ in size (a pooled string or an inline one, a
 * byte or a long) are picked the way EA's converter does: the pool when the
 * string is in it, the smallest integer form that holds a number.
 */

/** One instruction to encode, or a label marking a position */
type Emitted =
  | { label: string }
  | {
      op: string;
      operand?: number | string | [string, string] | number[];
      target?: string;
      fn?: CompiledFunction;
    };

interface CompiledFunction {
  name: string;
  params: FuncDef['params'];
  flags?: number;
  body: Emitted[];
}

const KEYWORD_OPCODES: Record<Keyword, string> = {
  true: 'EA_PushTrue',
  false: 'EA_PushFalse',
  null: 'EA_PushNull',
  undefined: 'EA_PushUndefined',
  this: 'EA_PushThis',
  _global: 'EA_PushGlobal',
};

const OPCODE_OF_OPERATOR = new Map(
  Object.entries(OPERATORS).map(([op, text]) => [text, op]),
);

/** A compile error, naming what could not be encoded */
export class CompileError extends Error {}

/** Shared state of one compile: the `.const` items, extended as needed */
class ConstTable {
  public constructor(public readonly items: ConstItem[]) {}

  /** The index of an item with this value, appending one when there is none */
  public indexOf(value: string | number): number {
    const found = this.items.findIndex((item) =>
      typeof value === 'string'
        ? item.kind === 'string' && item.value === value
        : item.kind === 'number' && item.value === value,
    );

    if (found >= 0) {
      return found;
    }

    this.items.push(
      typeof value === 'string'
        ? { kind: 'string', value, offset: -1 }
        : { kind: 'number', value },
    );

    return this.items.length - 1;
  }
}

/** Lowers statements to instructions, tracking the constant pool in effect */
class Lowering {
  public readonly out: Emitted[] = [];
  private fresh = 0;

  public constructor(
    private readonly constants: ConstTable,
    private pool: (string | number)[],
  ) {}

  private emit(
    op: string,
    operand?: number | string | [string, string] | number[],
  ): void {
    this.out.push({ op, operand });
  }

  private label(): string {
    return `%${++this.fresh}`;
  }

  private poolIndex(text: string): number | undefined {
    const index = this.pool.indexOf(text);

    return index >= 0 && index < 256 ? index : undefined;
  }

  private string(text: string): void {
    const index = this.poolIndex(text);

    if (index === undefined) {
      this.emit('EA_PushString', text);
    } else {
      this.emit('EA_PushConstant', index);
    }
  }

  private number(value: number): void {
    if (Number.isInteger(value) && !Object.is(value, -0)) {
      if (value === 0) {
        return this.emit('EA_PushZero');
      }

      if (value === 1) {
        return this.emit('EA_PushOne');
      }

      if (value >= -128 && value <= 127) {
        return this.emit('EA_PushByte', value);
      }

      if (value >= -32768 && value <= 32767) {
        return this.emit('EA_PushShort', value);
      }

      if (value >= 0 && value <= 0xffffffff) {
        return this.emit('EA_PushLong', value);
      }
    }

    this.emit('EA_PushFloat', Math.fround(value));
  }

  private register(register: number): void {
    const index = this.constants.indexOf(register);
    const last = this.out[this.out.length - 1];

    // Consecutive register reads share one PushData, as EA's do
    if (last && 'op' in last && last.op === 'PushData') {
      (last.operand as number[]).push(index);
    } else {
      this.emit('PushData', [index]);
    }
  }

  private count(args: Expr[]): void {
    [...args].reverse().forEach((arg) => this.expr(arg));
    this.number(args.length);
  }

  /** Emits code that leaves the value of `expr` on the stack */
  public expr(expr: Expr): void {
    switch (expr.k) {
      case 'str':
        return this.string(expr.v);
      case 'num':
        return this.number(expr.v);
      case 'kw':
        return this.emit(KEYWORD_OPCODES[expr.v]);
      case 'reg':
        return this.register(expr.n);
      case 'var': {
        const index = this.poolIndex(expr.name);

        return index === undefined
          ? this.emit('EA_GetStringVar', expr.name)
          : this.emit('EA_PushValueOfVar', index);
      }
      case 'eval':
        this.expr(expr.name);

        return this.emit('GetVariable');
      case 'member': {
        this.expr(expr.obj);

        const index = this.poolIndex(expr.name);

        return index === undefined
          ? this.emit('EA_GetStringMember', expr.name)
          : this.emit('EA_GetNamedMember', index);
      }
      case 'index':
        this.expr(expr.obj);
        this.expr(expr.key);

        return this.emit('GetMember');
      case 'pop':
        return;
      case 'bin': {
        const op = OPCODE_OF_OPERATOR.get(expr.op);

        if (!op) {
          throw new CompileError(`Unknown operator ${expr.op}`);
        }

        this.expr(expr.a);
        this.expr(expr.b);

        return this.emit(op);
      }
      case 'not':
        this.expr(expr.a);

        return this.emit('LogicalNot');
      case 'intr':
        return this.intrinsic(expr, true);
      case 'call':
        this.count(expr.args);
        this.expr(expr.name);

        return this.emit('CallFunction');
      case 'mcall':
        this.count(expr.args);
        this.expr(expr.obj);
        this.expr(expr.name);

        return this.emit('CallMethod');
      case 'new':
        this.count(expr.args);
        this.expr(expr.name);

        return this.emit('New');
      case 'newm':
        this.count(expr.args);
        this.expr(expr.obj);
        this.expr(expr.name);

        return this.emit('NewMethod');
      case 'array':
        this.count(expr.items);

        return this.emit('InitArray');
      case 'object':
        for (const [key, value] of [...expr.pairs].reverse()) {
          this.expr(key);
          this.expr(value);
        }
        this.number(expr.pairs.length);

        return this.emit('InitObject');
      case 'setreg':
        this.expr(expr.value);

        return this.emit('SetRegister', expr.n);
      case 'func':
        return this.define(expr.def);
    }
  }

  private intrinsic(
    expr: Extract<Expr, { k: 'intr' }>,
    wantsValue: boolean,
  ): void {
    const effect = STACK_EFFECT[expr.op];

    if (!effect) {
      throw new CompileError(
        `#${expr.op} has no fixed stack effect; write it as asm`,
      );
    }

    if (effect[0] !== expr.args.length) {
      throw new CompileError(
        `#${expr.op} takes ${effect[0]} values, not ${expr.args.length}`,
      );
    }

    if (wantsValue && effect[1] !== 1) {
      throw new CompileError(`#${expr.op} leaves no value`);
    }

    expr.args.forEach((arg) => this.expr(arg));
    this.raw(expr.op, expr.operand);
  }

  private raw(op: string, operand: Operand | undefined): void {
    const opcode = OPCODE_BY_NAME.get(op);

    if (opcode === undefined) {
      throw new CompileError(`Unknown instruction ${op}`);
    }

    const shape = getOperandShape(opcode);
    const wants: Record<string, Operand['k'] | undefined> = {
      none: undefined,
      int: 'num',
      byte: 'num',
      short: 'num',
      word: 'num',
      branch: 'label',
      string: 'str',
      url: 'strs',
      list: 'list',
    };

    if (shape === 'function' || shape === 'function2') {
      throw new CompileError(`Write ${op} as a function`);
    }

    if ((operand?.k ?? undefined) !== wants[shape as string]) {
      throw new CompileError(
        `${op} takes ${wants[shape as string] ? `a ${wants[shape as string]} operand` : 'no operand'}`,
      );
    }

    if (operand?.k === 'label') {
      this.out.push({ op, target: operand.v });
    } else {
      this.out.push({ op, operand: operand?.v });
    }

    if (op === 'ConstantPool') {
      this.pool = (operand?.v as number[]).map(
        (index) => this.constants.items[index]?.value ?? '',
      );
    }
  }

  private define(def: FuncDef): void {
    const inner = new Lowering(this.constants, [...this.pool]);

    inner.statements(def.body);
    this.out.push({
      op: def.flags === undefined ? 'DefineFunction' : 'DefineFunction2',
      fn: {
        name: def.name,
        params: def.params,
        flags: def.flags,
        body: inner.out,
      },
    });
  }

  /** A call whose result is dropped (`...Pop`) or assigned (the other EA forms) */
  private fusedCall(call: Expr, pops: boolean): void {
    const suffix = pops ? 'Pop' : '';

    if (call.k === 'call') {
      this.count(call.args);

      const index =
        call.name.k === 'str' ? this.poolIndex(call.name.v) : undefined;

      if (index === undefined) {
        this.expr(call.name);
        this.emit(`EA_CallFunction${suffix}`);
      } else {
        this.emit(`EA_CallNamedFunction${suffix}`, index);
      }
    } else if (call.k === 'mcall') {
      this.count(call.args);
      this.expr(call.obj);

      const index =
        call.name.k === 'str' ? this.poolIndex(call.name.v) : undefined;

      if (index === undefined) {
        this.expr(call.name);
        this.emit(`EA_CallMethod${suffix}`);
      } else {
        this.emit(`EA_CallNamedMethod${suffix}`, index);
      }
    } else {
      throw new CompileError('Only a call can be assigned with :=');
    }
  }

  public statements(stmts: Stmt[]): void {
    stmts.forEach((stmt) => this.statement(stmt));
  }

  private statement(stmt: Stmt): void {
    switch (stmt.k) {
      case 'expr':
        if (!stmt.isVoid && (stmt.e.k === 'call' || stmt.e.k === 'mcall')) {
          return this.fusedCall(stmt.e, true);
        }

        if (stmt.e.k === 'intr' && STACK_EFFECT[stmt.e.op]?.[1] === 0) {
          return this.intrinsic(stmt.e, false);
        }

        this.expr(stmt.e);

        return this.emit('Pop');
      case 'push':
        return this.expr(stmt.e);
      case 'assignCall':
        this.expr(stmt.target);

        return this.fusedCall(stmt.call, false);
      case 'setvar':
        this.string(stmt.name);

        if (stmt.value.k === 'str') {
          return this.emit('EA_SetStringVar', stmt.value.v);
        }

        if (
          stmt.value.k === 'num' &&
          stmt.value.v === 0 &&
          !Object.is(stmt.value.v, -0)
        ) {
          return this.emit('EA_ZeroVariable');
        }

        this.expr(stmt.value);

        return this.emit('SetVariable');
      case 'setmember':
        this.expr(stmt.obj);
        this.expr(stmt.name);

        if (stmt.value.k === 'str') {
          return this.emit('EA_SetStringMember', stmt.value.v);
        }

        this.expr(stmt.value);

        return this.emit('SetMember');
      case 'local':
        this.string(stmt.name);

        if (stmt.value) {
          this.expr(stmt.value);

          return this.emit('DefineLocal');
        }

        return this.emit('Var');
      case 'asm':
        return this.raw(stmt.op, stmt.operand);
      case 'goto':
        this.out.push({ op: 'BranchAlways', target: stmt.label });

        return;
      case 'if':
        this.expr(stmt.cond);
        this.out.push({
          op: stmt.unless ? 'EA_BranchIfFalse' : 'BranchIfTrue',
          target: stmt.label,
        });

        return;
      case 'label':
        this.out.push({ label: stmt.name });

        return;
      case 'return':
        this.expr(stmt.e);

        return this.emit('Return');
      case 'func':
        return this.define(stmt.def);
      case 'pool':
        this.pool = stmt.items;

        return this.emit(
          'ConstantPool',
          stmt.items.map((item) => this.constants.indexOf(item)),
        );
      case 'block': {
        const elseLabel = this.label();

        this.expr(stmt.cond);
        this.emit('LogicalNot');
        this.out.push({ op: 'BranchIfTrue', target: elseLabel });
        this.statements(stmt.then);

        if (stmt.else) {
          const endLabel = this.label();

          this.out.push({ op: 'BranchAlways', target: endLabel });
          this.out.push({ label: elseLabel });
          this.statements(stmt.else);
          this.out.push({ label: endLabel });
        } else {
          this.out.push({ label: elseLabel });
        }

        return;
      }
      case 'while': {
        const top = this.label();
        const end = this.label();

        this.out.push({ label: top });
        this.expr(stmt.cond);
        this.emit('LogicalNot');
        this.out.push({ op: 'BranchIfTrue', target: end });
        this.statements(stmt.body);
        this.out.push({ op: 'BranchAlways', target: top });
        this.out.push({ label: end });

        return;
      }
    }
  }
}

const align4 = (offset: number) => (offset + 3) & ~3;

/** Writes the strings and arrays the code points at, then the code */
class Encoder {
  private readonly bytes: number[] = [];
  private readonly strings = new Map<string, number>();
  private base = 0;

  public constructor(private readonly image: AptImage) {}

  private stringAt(text: string): number {
    let at = this.strings.get(text);

    if (at === undefined) {
      at = this.image.appendString(text);
      this.strings.set(text, at);
    }

    return at;
  }

  /** Allocates every string and array the code needs, before the code */
  private allocate(code: Emitted[], data: Map<Emitted, number[]>): void {
    for (const item of code) {
      if (!('op' in item)) {
        continue;
      }

      if (typeof item.operand === 'string') {
        this.stringAt(item.operand);
      } else if (
        Array.isArray(item.operand) &&
        typeof item.operand[0] === 'string'
      ) {
        (item.operand as string[]).forEach((text) => this.stringAt(text));
      } else if (Array.isArray(item.operand)) {
        data.set(item, [this.image.appendWords(item.operand as number[])]);
      } else if (item.fn) {
        const fn = item.fn;
        const isVersion2 = fn.flags !== undefined;
        const name = this.stringAt(fn.name);
        const words = fn.params.flatMap((param) =>
          isVersion2
            ? [param.register, this.stringAt(param.name)]
            : [this.stringAt(param.name)],
        );

        data.set(item, [
          name,
          words.length ? this.image.appendWords(words) : 0,
        ]);
        this.allocate(fn.body, data);
      }
    }
  }

  private get position(): number {
    return this.base + this.bytes.length;
  }

  private word(value: number): void {
    this.bytes.push(
      value & 255,
      (value >>> 8) & 255,
      (value >>> 16) & 255,
      (value >>> 24) & 255,
    );
  }

  private align(): void {
    while (this.position % 4) {
      this.bytes.push(0);
    }
  }

  private setWord(at: number, value: number): void {
    const index = at - this.base;

    this.bytes[index] = value & 255;
    this.bytes[index + 1] = (value >>> 8) & 255;
    this.bytes[index + 2] = (value >>> 16) & 255;
    this.bytes[index + 3] = (value >>> 24) & 255;
  }

  /** Encodes one scope; labels resolve within it */
  private scope(code: Emitted[], data: Map<Emitted, number[]>): void {
    const labels = new Map<string, number>();
    const fixups: { at: number; label: string }[] = [];

    for (const item of code) {
      if (!('op' in item)) {
        if (labels.has(item.label)) {
          throw new CompileError(`Label ${item.label} is defined twice`);
        }
        labels.set(item.label, this.position);
        continue;
      }

      const opcode = OPCODE_BY_NAME.get(item.op) as number;
      const shape = getOperandShape(opcode);

      this.bytes.push(opcode);

      switch (shape) {
        case 'int':
          this.align();
          this.word(item.operand as number);
          break;
        case 'branch':
          this.align();
          fixups.push({ at: this.position, label: item.target as string });
          this.word(0);
          break;
        case 'string':
          this.align();
          this.word(this.stringAt(item.operand as string));
          break;
        case 'url':
          this.align();
          (item.operand as string[]).forEach((text) =>
            this.word(this.stringAt(text)),
          );
          break;
        case 'list':
          this.align();
          this.word((item.operand as number[]).length);
          this.word((data.get(item) as number[])[0]);
          break;
        case 'byte':
          this.bytes.push((item.operand as number) & 255);
          break;
        case 'short':
          this.bytes.push(
            (item.operand as number) & 255,
            ((item.operand as number) >> 8) & 255,
          );
          break;
        case 'word': {
          const view = new DataView(new ArrayBuffer(4));

          if (item.op === 'EA_PushFloat') {
            view.setFloat32(0, item.operand as number, true);
          } else {
            view.setUint32(0, (item.operand as number) >>> 0, true);
          }
          this.bytes.push(...new Uint8Array(view.buffer));
          break;
        }
        case 'function':
        case 'function2': {
          const fn = item.fn as CompiledFunction;
          const [name, params] = data.get(item) as number[];

          this.align();
          this.word(name);
          this.word(fn.params.length);
          if (shape === 'function2') {
            this.word(fn.flags ?? 0);
          }
          this.word(params);

          const sizeAt = this.position;

          this.word(0);
          this.word(0x98765432);
          this.word(0x12345678);

          const start = this.position;

          this.scope(fn.body, data);
          this.setWord(sizeAt, this.position - start);
          break;
        }
      }
    }

    for (const fixup of fixups) {
      const target = labels.get(fixup.label);

      if (target === undefined) {
        throw new CompileError(
          `goto ${fixup.label}: there is no such label here`,
        );
      }

      this.setWord(fixup.at, (target - (fixup.at + 4)) >>> 0);
    }
  }

  /** Encodes a block and returns where it starts */
  public encode(code: Emitted[]): number {
    const data = new Map<Emitted, number[]>();

    this.allocate(code, data);
    this.base = align4(this.image.length);
    this.scope(code, data);

    const at = this.image.appendBytes(Uint8Array.from(this.bytes), 4);

    if (at !== this.base) {
      throw new CompileError('The code did not land where it was laid out');
    }

    return at;
  }
}

/**
 * Compiles a script as a top-level action block, appended to `image`, and
 * returns where it starts. Items it needs that the `.const` lacks are
 * appended to `constants`.
 */
export const compileScript = (
  stmts: Stmt[],
  image: AptImage,
  constants: ConstItem[],
): number => {
  const lowering = new Lowering(new ConstTable(constants), []);

  lowering.statements(stmts);
  lowering.out.push({ op: 'End' });

  return new Encoder(image).encode(lowering.out);
};

/**
 * Rewrites decoded code into a form where encodings that mean the same thing
 * compare equal: pooled and inline strings, integer widths, fused EA forms
 * and their two-instruction spellings, `PushData` grouping, and branch
 * offsets as positions. Two blocks with equal forms run the same.
 */
export const normalize = (
  code: AptInstruction[],
  constants: readonly ConstItem[],
  pool: (string | number | undefined)[] = [],
): unknown[] => {
  const out: unknown[][] = [];
  const starts = new Map<number, number>();
  const pending: { entry: unknown[]; target: number }[] = [];

  for (const instruction of code) {
    starts.set(instruction.offset, out.length);

    const { name, operand } = instruction;
    const pooled = () => pool[operand as number];

    switch (name) {
      case 'EA_PushString':
        out.push(['value', operand]);
        break;
      case 'EA_PushConstant':
      case 'EA_PushWordConstant':
        out.push(['value', pooled()]);
        break;
      case 'EA_PushZero':
        out.push(['value', 0]);
        break;
      case 'EA_PushOne':
        out.push(['value', 1]);
        break;
      case 'EA_PushByte':
      case 'EA_PushShort':
      case 'EA_PushLong':
      case 'EA_PushFloat':
        out.push(['value', operand]);
        break;
      case 'EA_PushRegister':
        out.push(['register', operand]);
        break;
      case 'PushData':
        for (const index of operand as number[]) {
          const item = constants[index];

          out.push(
            item?.kind === 'number'
              ? ['register', item.value]
              : ['value', item?.value],
          );
        }
        break;
      case 'EA_GetStringVar':
        out.push(['value', operand], ['GetVariable']);
        break;
      case 'EA_PushValueOfVar':
        out.push(['value', pooled()], ['GetVariable']);
        break;
      case 'EA_GetStringMember':
        out.push(['value', operand], ['GetMember']);
        break;
      case 'EA_GetNamedMember':
        out.push(['value', pooled()], ['GetMember']);
        break;
      case 'EA_SetStringVar':
        out.push(['value', operand], ['SetVariable']);
        break;
      case 'EA_SetStringMember':
        out.push(['value', operand], ['SetMember']);
        break;
      case 'EA_ZeroVariable':
        out.push(['value', 0], ['SetVariable']);
        break;
      case 'EA_CallNamedFunction':
      case 'EA_CallNamedFunctionPop':
      case 'EA_CallNamedMethod':
      case 'EA_CallNamedMethodPop':
        out.push(['value', pooled()], [name.replace('Named', '')]);
        break;
      case 'ConstantPool':
        pool = (operand as number[]).map((index) => constants[index]?.value);
        out.push(['pool', pool]);
        break;
      case 'DefineFunction':
      case 'DefineFunction2': {
        const fn = operand as AptFunction;

        out.push([
          name,
          fn.name,
          fn.params,
          fn.flags,
          normalize(fn.body, constants, [...pool]),
        ]);
        break;
      }
      default:
        if (instruction.target !== undefined) {
          const entry: unknown[] = [name];

          out.push(entry);
          pending.push({ entry, target: instruction.target });
        } else {
          out.push(operand === undefined ? [name] : [name, operand]);
        }
    }
  }

  for (const { entry, target } of pending) {
    entry.push(
      starts.get(target) ??
        (target > (code[code.length - 1]?.offset ?? 0) ? out.length : -1),
    );
  }

  return out;
};
