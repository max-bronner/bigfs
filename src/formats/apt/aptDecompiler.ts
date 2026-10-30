import { AptFunction, AptInstruction } from './aptBytecode';
import { ConstItem } from './aptMovie';
import { Expr, FuncDef, Keyword, Operand, Stmt } from './aptScriptSyntax';

/**
 * Lifts decoded bytecode into the script language of `aptScriptSyntax.ts`.
 *
 * A stack of expressions stands for the VM's operand stack. An instruction
 * that consumes values takes them off it into an expression or a statement.
 * Before a statement is written, whatever is still on the stack is written
 * as `push(...)` first, so the text keeps the order the code evaluates in;
 * a later instruction that needs those values reads them as `pop()`.
 * Anything without a fixed form becomes an `asm` statement, which is always
 * exact. `structure` then folds the branch shapes Flash's compiler emits for
 * `if`, `if`/`else` and `while` back into blocks.
 */

/**
 * Values popped and pushed by each instruction that prints as `#Op(...)`; the
 * compiler refuses an intrinsic missing from it
 */
export const STACK_EFFECT: Record<string, [number, number]> = {
  NextFrame: [0, 0],
  PrevFrame: [0, 0],
  Play: [0, 0],
  Stop: [0, 0],
  ToggleQuality: [0, 0],
  StopSounds: [0, 0],
  StopDragMovie: [0, 0],
  GetTimer: [0, 1],
  Add: [2, 1],
  Equals: [2, 1],
  LessThan: [2, 1],
  LogicalAnd: [2, 1],
  LogicalOr: [2, 1],
  StringEquals: [2, 1],
  StringConcat: [2, 1],
  StringCompare: [2, 1],
  StringGreater: [2, 1],
  CastOp: [2, 1],
  Delete: [2, 1],
  GetProperty: [2, 1],
  StringLength: [1, 1],
  MbLength: [1, 1],
  ToInteger: [1, 1],
  ToNumber: [1, 1],
  ToString: [1, 1],
  Random: [1, 1],
  Ord: [1, 1],
  Chr: [1, 1],
  MbOrd: [1, 1],
  MbChr: [1, 1],
  Delete2: [1, 1],
  TypeOf: [1, 1],
  TargetPath: [1, 1],
  Increment: [1, 1],
  Decrement: [1, 1],
  Substring: [3, 1],
  MbSubstring: [3, 1],
  SetProperty: [3, 0],
  DuplicateClip: [3, 0],
  RemoveClip: [1, 0],
  Trace: [1, 0],
  SetTargetExpression: [1, 0],
  Throw: [1, 0],
  GetUrl2: [2, 0],
  CallFrame: [1, 0],
  Extends: [2, 0],
  GotoFrame: [0, 0],
  GotoLabel: [0, 0],
  SetTarget: [0, 0],
  GetUrl: [0, 0],
  GotoExpression: [1, 0],
  SetVariable: [2, 0],
  SetMember: [3, 0],
  DefineLocal: [2, 0],
  Var: [1, 0],
  EA_SetStringVar: [1, 0],
  EA_SetStringMember: [2, 0],
  EA_ZeroVariable: [1, 0],
  Pop: [1, 0],
  Return: [1, 0],
  GetVariable: [1, 1],
  GetMember: [2, 1],
};

/** Binary operators of SWF 5 and later by opcode name, shared by the lifter and the compiler */
export const OPERATORS: Record<string, string> = {
  NewAdd: '+',
  Subtract: '-',
  Multiply: '*',
  Divide: '/',
  Modulo: '%',
  NewEquals: '==',
  StrictEquals: '===',
  NewLessThan: '<',
  Greater: '>',
  InstanceOf: 'instanceof',
  BitwiseAnd: '&',
  BitwiseOr: '|',
  BitwiseXor: '^',
  ShiftLeft: '<<',
  ShiftRight: '>>',
  ShiftRight2: '>>>',
};

const KEYWORD_PUSHES: Record<string, Keyword> = {
  EA_PushTrue: 'true',
  EA_PushFalse: 'false',
  EA_PushNull: 'null',
  EA_PushUndefined: 'undefined',
  EA_PushThis: 'this',
  EA_PushGlobal: '_global',
};

/** Opcodes whose byte operand indexes the constant pool */
const POOL_OPERAND = new Set([
  'EA_PushConstant',
  'EA_PushWordConstant',
  'EA_PushValueOfVar',
  'EA_GetNamedMember',
  'EA_CallNamedFunctionPop',
  'EA_CallNamedFunction',
  'EA_CallNamedMethodPop',
  'EA_CallNamedMethod',
]);

const isCall = (expr: Expr) => expr.k === 'call' || expr.k === 'mcall';

/** Converts an instruction's operand to the form `#Op<...>` and `asm` write it in */
export const toOperand = (
  instruction: AptInstruction,
  labels: Map<number, string>,
): Operand | undefined => {
  const { operand, target } = instruction;

  if (target !== undefined) {
    return { k: 'label', v: labels.get(target) ?? '?' };
  }

  if (typeof operand === 'number') {
    return { k: 'num', v: operand };
  }

  if (typeof operand === 'string') {
    return { k: 'str', v: operand };
  }

  if (Array.isArray(operand)) {
    return typeof operand[0] === 'string'
      ? { k: 'strs', v: operand as [string, string] }
      : { k: 'list', v: operand as number[] };
  }

  return undefined;
};

/** Every branch target in a list of instructions, not inside functions */
const branchTargets = (code: AptInstruction[]): number[] =>
  code.flatMap((instruction) =>
    instruction.target === undefined ? [] : [instruction.target],
  );

/** Names labels `L1`, `L2`, ... in offset order */
const nameLabels = (code: AptInstruction[]): Map<number, string> =>
  new Map(
    [...new Set(branchTargets(code))]
      .sort((a, b) => a - b)
      .map((offset, index) => [offset, `L${index + 1}`]),
  );

/** How a block is lifted: as expressions, or one instruction a line */
export type LiftMode = 'script' | 'assembly';

interface LiftContext {
  constants: readonly ConstItem[];
  mode: LiftMode;
}

/**
 * Lifts a block or a function body. `pool` is the constant pool in effect
 * where it starts; `isBlock` drops the closing `End` of a top-level block.
 */
export const lift = (
  code: AptInstruction[],
  context: LiftContext,
  pool: (string | number | undefined)[] = [],
  isBlock = true,
): Stmt[] => {
  const labels = nameLabels(code);
  const stmts: Stmt[] = [];
  let stack: Expr[] = [];

  const flush = () => {
    for (const e of stack) {
      stmts.push({ k: 'push', e });
    }
    stack = [];
  };
  const emit = (stmt: Stmt) => {
    flush();
    stmts.push(stmt);
  };
  // The top `count` values, deepest first; missing ones are `pop()`
  const popOperands = (count: number): Expr[] => {
    if (stack.length >= count) {
      return stack.splice(stack.length - count);
    }

    const have = stack.splice(0);

    return [
      ...Array.from({ length: count - have.length }, (): Expr => ({
        k: 'pop',
      })),
      ...have,
    ];
  };
  const asm = (instruction: AptInstruction) =>
    emit({
      k: 'asm',
      op: instruction.name,
      operand: toOperand(instruction, labels),
    });
  const constItem = (index: number): Expr | undefined => {
    const item = context.constants[index];

    return item === undefined
      ? undefined
      : item.kind === 'string'
        ? { k: 'str', v: item.value }
        : { k: 'reg', n: item.value };
  };
  // Takes a call's operands: `extra` values above a literal count, then that
  // many arguments below it. The arguments sit last-first, so they come back
  // in call order; the extras come back deepest first.
  const callOperands = (extra: number): [Expr[], Expr[]] | undefined => {
    const count = stack[stack.length - 1 - extra];

    if (
      count?.k !== 'num' ||
      !Number.isInteger(count.v) ||
      count.v < 0 ||
      stack.length < extra + 1 + count.v
    ) {
      return undefined;
    }

    const operands = stack.splice(stack.length - extra - 1 - count.v);

    return [operands.slice(0, count.v).reverse(), operands.slice(count.v + 1)];
  };

  for (let index = 0; index < code.length; index++) {
    const instruction = code[index];
    const { name, operand } = instruction;
    const label = labels.get(instruction.offset);

    if (label) {
      emit({ k: 'label', name: label });
    }

    if (name === 'End' && isBlock && index === code.length - 1) {
      flush();
      continue;
    }

    if (name === 'ConstantPool') {
      const items = (operand as number[]).map((item) => {
        const value = context.constants[item];

        return value?.value;
      });

      if (items.some((item) => item === undefined)) {
        asm(instruction);
      } else {
        pool = items;
        emit({ k: 'pool', items: items as (string | number)[] });
      }
      continue;
    }

    if (name === 'DefineFunction' || name === 'DefineFunction2') {
      const fn = operand as AptFunction;
      const def: FuncDef = {
        name: fn.name,
        params: fn.params.map((param) => ({ ...param })),
        flags: fn.isVersion2 ? fn.flags : undefined,
        body: lift(fn.body, context, [...pool], false),
      };

      if (fn.name) {
        emit({ k: 'func', def });
      } else {
        stack.push({ k: 'func', def });
      }
      continue;
    }

    if (context.mode === 'assembly') {
      asm(instruction);
      continue;
    }

    const poolName = (): string | undefined => {
      const value = pool[operand as number];

      return typeof value === 'string' ? value : undefined;
    };

    if (POOL_OPERAND.has(name) && poolName() === undefined) {
      asm(instruction);
      continue;
    }

    const lifted = liftOne();

    if (!lifted) {
      asm(instruction);
    }

    function liftOne(): boolean {
      const keyword = KEYWORD_PUSHES[name];

      if (keyword) {
        stack.push({ k: 'kw', v: keyword });

        return true;
      }

      const operator = OPERATORS[name];

      if (operator) {
        const [a, b] = popOperands(2);

        stack.push({ k: 'bin', op: operator, a, b });

        return true;
      }

      switch (name) {
        case 'EA_PushZero':
          stack.push({ k: 'num', v: 0 });

          return true;
        case 'EA_PushOne':
          stack.push({ k: 'num', v: 1 });

          return true;
        case 'EA_PushByte':
        case 'EA_PushShort':
        case 'EA_PushFloat':
          stack.push({ k: 'num', v: operand as number });

          return true;
        case 'EA_PushLong':
          stack.push({
            k: 'num',
            v: operand as number,
            hex: (operand as number) >= 0x10000 || undefined,
          });

          return true;
        case 'EA_PushString':
          stack.push({ k: 'str', v: operand as string });

          return true;
        case 'EA_PushConstant':
        case 'EA_PushWordConstant':
          stack.push({ k: 'str', v: poolName() as string });

          return true;
        case 'EA_PushRegister':
          stack.push({ k: 'reg', n: operand as number });

          return true;
        case 'PushData': {
          const values = (operand as number[]).map(constItem);

          if (values.some((value) => !value)) {
            return false;
          }

          stack.push(...(values as Expr[]));

          return true;
        }
        case 'EA_GetStringVar':
          stack.push({ k: 'var', name: operand as string });

          return true;
        case 'EA_PushValueOfVar':
          stack.push({ k: 'var', name: poolName() as string });

          return true;
        case 'GetVariable': {
          const [nameExpr] = popOperands(1);

          stack.push(
            nameExpr.k === 'str'
              ? { k: 'var', name: nameExpr.v }
              : { k: 'eval', name: nameExpr },
          );

          return true;
        }
        case 'EA_GetStringMember':
        case 'EA_GetNamedMember': {
          const [obj] = popOperands(1);

          stack.push({
            k: 'member',
            obj,
            name:
              name === 'EA_GetStringMember'
                ? (operand as string)
                : (poolName() as string),
          });

          return true;
        }
        case 'GetMember': {
          const [obj, key] = popOperands(2);

          stack.push(
            key.k === 'str'
              ? { k: 'member', obj, name: key.v }
              : { k: 'index', obj, key },
          );

          return true;
        }
        case 'LogicalNot': {
          const [a] = popOperands(1);

          stack.push({ k: 'not', a });

          return true;
        }
        case 'SetRegister': {
          const [value] = popOperands(1);

          stack.push({ k: 'setreg', n: operand as number, value });

          return true;
        }
        case 'Pop': {
          const [e] = popOperands(1);

          emit({ k: 'expr', e, isVoid: isCall(e) });

          return true;
        }
        case 'Return': {
          const [e] = popOperands(1);

          emit({ k: 'return', e });

          return true;
        }
        case 'BranchAlways':
          emit({
            k: 'goto',
            label: labels.get(instruction.target as number) as string,
          });

          return true;
        case 'BranchIfTrue':
        case 'EA_BranchIfFalse': {
          const [cond] = popOperands(1);

          emit({
            k: 'if',
            cond,
            label: labels.get(instruction.target as number) as string,
            unless: name === 'EA_BranchIfFalse',
          });

          return true;
        }
        case 'SetVariable':
        case 'EA_SetStringVar':
        case 'EA_ZeroVariable': {
          const [target, given] = popOperands(name === 'SetVariable' ? 2 : 1);
          const value: Expr =
            name === 'SetVariable'
              ? given
              : name === 'EA_ZeroVariable'
                ? { k: 'num', v: 0 }
                : { k: 'str', v: operand as string };

          if (target.k !== 'str') {
            stack.push(target, ...(name === 'SetVariable' ? [given] : []));
            break;
          }

          emit({ k: 'setvar', name: target.v, value });

          return true;
        }
        case 'SetMember':
        case 'EA_SetStringMember': {
          const [obj, key, given] = popOperands(name === 'SetMember' ? 3 : 2);

          emit({
            k: 'setmember',
            obj,
            name: key,
            value:
              name === 'SetMember' ? given : { k: 'str', v: operand as string },
          });

          return true;
        }
        case 'DefineLocal':
        case 'Var': {
          const [target, value] = popOperands(name === 'DefineLocal' ? 2 : 1);

          if (target.k !== 'str') {
            stack.push(target, ...(value ? [value] : []));
            break;
          }

          emit({ k: 'local', name: target.v, value });

          return true;
        }
        case 'CallFunction':
        case 'EA_CallFunction':
        case 'EA_CallFunctionPop':
        case 'New': {
          const operands = callOperands(1);

          if (!operands) {
            return false;
          }

          const [args, [nameExpr]] = operands;

          return deliver(
            name === 'New'
              ? { k: 'new', name: nameExpr, args }
              : { k: 'call', name: nameExpr, args },
          );
        }
        case 'EA_CallNamedFunction':
        case 'EA_CallNamedFunctionPop': {
          const operands = callOperands(0);

          if (!operands) {
            return false;
          }

          return deliver({
            k: 'call',
            name: { k: 'str', v: poolName() as string },
            args: operands[0],
          });
        }
        case 'CallMethod':
        case 'EA_CallMethod':
        case 'EA_CallMethodPop':
        case 'NewMethod': {
          const operands = callOperands(2);

          if (!operands) {
            return false;
          }

          const [args, [obj, nameExpr]] = operands;

          return deliver(
            name === 'NewMethod'
              ? { k: 'newm', obj, name: nameExpr, args }
              : { k: 'mcall', obj, name: nameExpr, args },
          );
        }
        case 'EA_CallNamedMethod':
        case 'EA_CallNamedMethodPop': {
          const operands = callOperands(1);

          if (!operands) {
            return false;
          }

          const [args, [obj]] = operands;

          return deliver({
            k: 'mcall',
            obj,
            name: { k: 'str', v: poolName() as string },
            args,
          });
        }
        case 'InitArray': {
          const operands = callOperands(0);

          if (!operands) {
            return false;
          }

          stack.push({ k: 'array', items: operands[0] });

          return true;
        }
        case 'InitObject': {
          const count = stack[stack.length - 1];

          if (
            count?.k !== 'num' ||
            !Number.isInteger(count.v) ||
            count.v < 0 ||
            stack.length < 1 + count.v * 2
          ) {
            return false;
          }

          stack.pop();

          const flat = stack.splice(stack.length - count.v * 2);
          const pairs: [Expr, Expr][] = [];

          // The top pair is popped first and sets its member first
          for (let pair = flat.length - 2; pair >= 0; pair -= 2) {
            pairs.push([flat[pair], flat[pair + 1]]);
          }

          stack.push({ k: 'object', pairs });

          return true;
        }
      }

      const effect = STACK_EFFECT[name];

      if (!effect) {
        return false;
      }

      const [pops, pushes] = effect;
      const expr: Expr = {
        k: 'intr',
        op: name,
        operand: toOperand(instruction, labels),
        args: popOperands(pops),
      };

      if (pushes) {
        stack.push(expr);
      } else {
        emit({ k: 'expr', e: expr, isVoid: false });
      }

      return true;
    }

    // Where a call's result goes, by the form of the call
    function deliver(call: Expr): boolean {
      if (name.startsWith('EA_Call') && name.endsWith('Pop')) {
        emit({ k: 'expr', e: call, isVoid: false });

        return true;
      }

      if (name.startsWith('EA_Call')) {
        // The name the result goes to sits beneath the arguments
        const [target] = popOperands(1);

        emit({ k: 'assignCall', target, call });

        return true;
      }

      stack.push(call);

      return true;
    }
  }

  flush();

  // A branch to the end of the region lands after its last instruction
  const last = code[code.length - 1];

  for (const [offset, label] of labels) {
    if (!code.some((instruction) => instruction.offset === offset)) {
      if (!last || offset > last.offset) {
        stmts.push({ k: 'label', name: label });
      }
    }
  }

  return context.mode === 'script' ? foldBranches(stmts) : stmts;
};

/** Counts how often each label is jumped to */
const countReferences = (stmts: Stmt[], counts = new Map<string, number>()) => {
  for (const stmt of stmts) {
    if (stmt.k === 'goto' || stmt.k === 'if') {
      counts.set(stmt.label, (counts.get(stmt.label) ?? 0) + 1);
    } else if (stmt.k === 'asm' && stmt.operand?.k === 'label') {
      counts.set(stmt.operand.v, (counts.get(stmt.operand.v) ?? 0) + 1);
    }
  }

  return counts;
};

/**
 * Folds `if (!c) goto A; ...; A:` into `if (c) {...}`, with a jump over an
 * else part into `if`/`else`, and `T: if (!c) goto E; ...; goto T; E:` into
 * `while`. A label is only folded away when nothing else jumps to it.
 */
const foldBranches = (stmts: Stmt[]): Stmt[] => {
  const counts = countReferences(stmts);
  const labelAt = (name: string, from: number) =>
    stmts.findIndex(
      (stmt, index) => index > from && stmt.k === 'label' && stmt.name === name,
    );
  const once = (name: string) => counts.get(name) === 1;

  const fold = (from: number, to: number): Stmt[] => {
    const out: Stmt[] = [];

    for (let index = from; index < to; index++) {
      const stmt = stmts[index];
      const following = stmts[index + 1];

      // while: T: if (!c) goto E; body; goto T; E:
      if (
        stmt.k === 'label' &&
        once(stmt.name) &&
        following?.k === 'if' &&
        !following.unless &&
        following.cond.k === 'not' &&
        once(following.label)
      ) {
        const end = labelAt(following.label, index + 1);
        const back = stmts[end - 1];

        if (
          end > 0 &&
          end < to &&
          back?.k === 'goto' &&
          back.label === stmt.name
        ) {
          out.push({
            k: 'while',
            cond: following.cond.a,
            body: fold(index + 2, end - 1),
          });
          index = end;
          continue;
        }
      }

      if (
        stmt.k === 'if' &&
        !stmt.unless &&
        stmt.cond.k === 'not' &&
        once(stmt.label)
      ) {
        const elseAt = labelAt(stmt.label, index);

        if (elseAt > index && elseAt < to) {
          const jump = stmts[elseAt - 1];
          const endAt =
            jump?.k === 'goto' && once(jump.label) && elseAt - 1 > index
              ? labelAt(jump.label, elseAt)
              : -1;

          if (endAt > elseAt && endAt < to) {
            out.push({
              k: 'block',
              cond: stmt.cond.a,
              then: fold(index + 1, elseAt - 1),
              else: fold(elseAt + 1, endAt),
            });
            index = endAt;
          } else {
            out.push({
              k: 'block',
              cond: stmt.cond.a,
              then: fold(index + 1, elseAt),
            });
            index = elseAt;
          }
          continue;
        }
      }

      out.push(stmt);
    }

    return out;
  };

  return fold(0, stmts.length);
};
