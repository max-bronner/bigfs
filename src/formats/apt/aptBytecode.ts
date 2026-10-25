import { AptReader } from './aptMovie';

/**
 * Decoder for APT's ActionScript bytecode, ported from mint's
 * `crates/sage/apt/src/bytecode.rs`.
 *
 * The encoding is not SWF's: there is no length prefix. An opcode with a
 * word operand first aligns the position up to a multiple of four, measured
 * on the absolute file offset, then reads fixed fields; byte, short and float
 * operands are unaligned. A string operand is a pointer to the string. A
 * function's header is followed by its body inline, which runs to its
 * declared size rather than to the first `End`. Branch offsets count from the
 * end of the branch's operand. (mint's `docs/research/apt-format.md`,
 * "Bytecode", checked over all 9,735 shipped blocks.)
 */

/** How an opcode's operand is stored */
type OperandShape =
  | 'none'
  | 'int'
  | 'branch'
  | 'string'
  | 'url'
  | 'list'
  | 'byte'
  | 'short'
  | 'word'
  | 'function'
  | 'function2';

/** Name and operand shape of every opcode, by its byte */
const OPCODES = new Map<number, [string, OperandShape]>([
  [0x00, ['End', 'none']],
  [0x04, ['NextFrame', 'none']],
  [0x05, ['PrevFrame', 'none']],
  [0x06, ['Play', 'none']],
  [0x07, ['Stop', 'none']],
  [0x08, ['ToggleQuality', 'none']],
  [0x09, ['StopSounds', 'none']],
  [0x0a, ['Add', 'none']],
  [0x0b, ['Subtract', 'none']],
  [0x0c, ['Multiply', 'none']],
  [0x0d, ['Divide', 'none']],
  [0x0e, ['Equals', 'none']],
  [0x0f, ['LessThan', 'none']],
  [0x10, ['LogicalAnd', 'none']],
  [0x11, ['LogicalOr', 'none']],
  [0x12, ['LogicalNot', 'none']],
  [0x13, ['StringEquals', 'none']],
  [0x14, ['StringLength', 'none']],
  [0x15, ['Substring', 'none']],
  [0x17, ['Pop', 'none']],
  [0x18, ['ToInteger', 'none']],
  [0x1c, ['GetVariable', 'none']],
  [0x1d, ['SetVariable', 'none']],
  [0x20, ['SetTargetExpression', 'none']],
  [0x21, ['StringConcat', 'none']],
  [0x22, ['GetProperty', 'none']],
  [0x23, ['SetProperty', 'none']],
  [0x24, ['DuplicateClip', 'none']],
  [0x25, ['RemoveClip', 'none']],
  [0x26, ['Trace', 'none']],
  [0x27, ['StartDragMovie', 'none']],
  [0x28, ['StopDragMovie', 'none']],
  [0x29, ['StringCompare', 'none']],
  [0x2a, ['Throw', 'none']],
  [0x2b, ['CastOp', 'none']],
  [0x2c, ['ImplementsOp', 'none']],
  [0x30, ['Random', 'none']],
  [0x31, ['MbLength', 'none']],
  [0x32, ['Ord', 'none']],
  [0x33, ['Chr', 'none']],
  [0x34, ['GetTimer', 'none']],
  [0x35, ['MbSubstring', 'none']],
  [0x36, ['MbOrd', 'none']],
  [0x37, ['MbChr', 'none']],
  [0x3a, ['Delete', 'none']],
  [0x3b, ['Delete2', 'none']],
  [0x3c, ['DefineLocal', 'none']],
  [0x3d, ['CallFunction', 'none']],
  [0x3e, ['Return', 'none']],
  [0x3f, ['Modulo', 'none']],
  [0x40, ['New', 'none']],
  [0x41, ['Var', 'none']],
  [0x42, ['InitArray', 'none']],
  [0x43, ['InitObject', 'none']],
  [0x44, ['TypeOf', 'none']],
  [0x45, ['TargetPath', 'none']],
  [0x46, ['Enumerate', 'none']],
  [0x47, ['NewAdd', 'none']],
  [0x48, ['NewLessThan', 'none']],
  [0x49, ['NewEquals', 'none']],
  [0x4a, ['ToNumber', 'none']],
  [0x4b, ['ToString', 'none']],
  [0x4c, ['Dup', 'none']],
  [0x4d, ['Swap', 'none']],
  [0x4e, ['GetMember', 'none']],
  [0x4f, ['SetMember', 'none']],
  [0x50, ['Increment', 'none']],
  [0x51, ['Decrement', 'none']],
  [0x52, ['CallMethod', 'none']],
  [0x53, ['NewMethod', 'none']],
  [0x54, ['InstanceOf', 'none']],
  [0x55, ['Enumerate2', 'none']],
  [0x56, ['EA_Action56', 'none']],
  [0x58, ['EA_Action58', 'none']],
  [0x59, ['EA_PushZero', 'none']],
  [0x5a, ['EA_PushOne', 'none']],
  [0x5b, ['EA_CallFunctionPop', 'none']],
  [0x5c, ['EA_CallFunction', 'none']],
  [0x5d, ['EA_CallMethodPop', 'none']],
  [0x5e, ['EA_CallMethod', 'none']],
  [0x60, ['BitwiseAnd', 'none']],
  [0x61, ['BitwiseOr', 'none']],
  [0x62, ['BitwiseXor', 'none']],
  [0x63, ['ShiftLeft', 'none']],
  [0x64, ['ShiftRight', 'none']],
  [0x65, ['ShiftRight2', 'none']],
  [0x66, ['StrictEquals', 'none']],
  [0x67, ['Greater', 'none']],
  [0x68, ['StringGreater', 'none']],
  [0x69, ['Extends', 'none']],
  [0x70, ['EA_PushThis', 'none']],
  [0x71, ['EA_PushGlobal', 'none']],
  [0x72, ['EA_ZeroVariable', 'none']],
  [0x73, ['EA_PushTrue', 'none']],
  [0x74, ['EA_PushFalse', 'none']],
  [0x75, ['EA_PushNull', 'none']],
  [0x76, ['EA_PushUndefined', 'none']],
  [0x77, ['EA_Action77', 'none']],
  [0x81, ['GotoFrame', 'int']],
  [0x83, ['GetUrl', 'url']],
  [0x87, ['SetRegister', 'int']],
  [0x88, ['ConstantPool', 'list']],
  [0x8a, ['WaitForFrame', 'none']],
  [0x8b, ['SetTarget', 'string']],
  [0x8c, ['GotoLabel', 'string']],
  [0x8d, ['WaitForFrameExpression', 'none']],
  [0x8e, ['DefineFunction2', 'function2']],
  [0x8f, ['Try', 'none']],
  [0x94, ['With', 'int']],
  [0x96, ['PushData', 'list']],
  [0x99, ['BranchAlways', 'branch']],
  [0x9a, ['GetUrl2', 'none']],
  [0x9b, ['DefineFunction', 'function']],
  [0x9d, ['BranchIfTrue', 'branch']],
  [0x9e, ['CallFrame', 'none']],
  [0x9f, ['GotoExpression', 'int']],
  [0xa1, ['EA_PushString', 'string']],
  [0xa2, ['EA_PushConstant', 'byte']],
  [0xa3, ['EA_PushWordConstant', 'short']],
  [0xa4, ['EA_GetStringVar', 'string']],
  [0xa5, ['EA_GetStringMember', 'string']],
  [0xa6, ['EA_SetStringVar', 'string']],
  [0xa7, ['EA_SetStringMember', 'string']],
  [0xae, ['EA_PushValueOfVar', 'byte']],
  [0xaf, ['EA_GetNamedMember', 'byte']],
  [0xb0, ['EA_CallNamedFunctionPop', 'byte']],
  [0xb1, ['EA_CallNamedFunction', 'byte']],
  [0xb2, ['EA_CallNamedMethodPop', 'byte']],
  [0xb3, ['EA_CallNamedMethod', 'byte']],
  [0xb4, ['EA_PushFloat', 'word']],
  [0xb5, ['EA_PushByte', 'byte']],
  [0xb6, ['EA_PushShort', 'short']],
  [0xb7, ['EA_PushLong', 'word']],
  [0xb8, ['EA_BranchIfFalse', 'branch']],
  [0xb9, ['EA_PushRegister', 'byte']],
]);

/** Opcodes whose byte operand is signed */
const SIGNED_BYTE = new Set([0xb5]);

/** Opcodes whose short operand is signed */
const SIGNED_SHORT = new Set([0xb6]);

/** The opcode of a name, for an encoder */
export const OPCODE_BY_NAME = new Map(
  Array.from(OPCODES, ([opcode, [name]]) => [name, opcode]),
);

/** The operand shape of an opcode */
export const getOperandShape = (opcode: number): OperandShape | undefined =>
  OPCODES.get(opcode)?.[1];

/** A function parameter: the register it lives in (version 2 only) and its name */
export interface AptParam {
  register: number;
  name: string;
}

/** A function defined inline in a block */
export interface AptFunction {
  name: string;
  params: AptParam[];
  /** DefineFunction2's register count (low byte) and SWF flags (top half) */
  flags: number;
  isVersion2: boolean;
  body: AptInstruction[];
}

/** One decoded instruction, at the absolute offset of its opcode */
export interface AptInstruction {
  offset: number;
  opcode: number;
  name: string;
  /** The operand, by shape: a number, a string, two strings, a list, or a function */
  operand?: number | string | [string, string] | number[] | AptFunction;
  /** For a branch: the absolute offset it jumps to */
  target?: number;
}

/** Limits on decoding a mod-supplied block */
const MAX_INSTRUCTIONS = 200_000;
const MAX_NESTING = 16;

/** Rounds up to a multiple of four */
const align4 = (offset: number): number => (offset + 3) & ~3;

/**
 * Decodes the block starting at `start`: a top-level block runs to its `End`.
 * Functions are decoded inline into their own bodies.
 */
export const decodeBlock = (
  apt: Uint8Array,
  start: number,
): AptInstruction[] => {
  const reader = new AptReader(apt);
  let count = 0;

  const run = (
    from: number,
    end: number | undefined,
    depth: number,
  ): [AptInstruction[], number] => {
    if (depth > MAX_NESTING) {
      throw new Error('Functions nest deeper than 16 levels');
    }

    const code: AptInstruction[] = [];
    let position = from;

    for (;;) {
      if (end !== undefined && position >= end) {
        if (position > end) {
          throw new Error(
            `A function body declared to end at ${end} ran to ${position}`,
          );
        }

        return [code, position];
      }

      if (++count > MAX_INSTRUCTIONS) {
        throw new Error('More than 200,000 instructions in one block');
      }

      const offset = position;
      const opcode = reader.u8(position);
      const entry = OPCODES.get(opcode);

      if (!entry) {
        throw new Error(`Unknown opcode 0x${opcode.toString(16)} at ${offset}`);
      }

      const [name, shape] = entry;
      const instruction: AptInstruction = { offset, opcode, name };

      position += 1;

      const word = (): number => {
        position = align4(position);

        const value = reader.u32(position);

        position += 4;

        return value;
      };

      switch (shape) {
        case 'int':
          instruction.operand = opcode === 0x87 ? word() : word() | 0;
          break;
        case 'branch': {
          const delta = word() | 0;

          instruction.operand = delta;
          instruction.target = position + delta;
          break;
        }
        case 'string':
          instruction.operand = reader.cstr(word());
          break;
        case 'url': {
          const url = word();
          const target = reader.u32(position);

          position += 4;
          instruction.operand = [reader.cstr(url), reader.cstr(target)];
          break;
        }
        case 'list': {
          const length = word();
          const pointer = reader.u32(position);

          position += 4;

          if (length * 4 > apt.length) {
            throw new Error(`A list of ${length} cannot fit in the file`);
          }

          instruction.operand = Array.from({ length }, (_, index) =>
            reader.u32(pointer + index * 4),
          );
          break;
        }
        case 'byte': {
          const value = reader.u8(position);

          position += 1;
          instruction.operand =
            SIGNED_BYTE.has(opcode) && value > 127 ? value - 256 : value;
          break;
        }
        case 'short': {
          const value = reader.u16(position);

          position += 2;
          instruction.operand =
            SIGNED_SHORT.has(opcode) && value > 32767 ? value - 65536 : value;
          break;
        }
        case 'word':
          instruction.operand =
            opcode === 0xb4 ? reader.f32(position) : reader.u32(position);
          position += 4;
          break;
        case 'function':
        case 'function2': {
          const isVersion2 = shape === 'function2';
          const namePointer = word();
          const paramCount = reader.u32(position);
          const flags = isVersion2 ? reader.u32(position + 4) : 0;
          const fieldsAt = position + (isVersion2 ? 8 : 4);
          const paramsPointer = reader.u32(fieldsAt);
          const size = reader.u32(fieldsAt + 4);
          const stride = isVersion2 ? 8 : 4;

          // Two magic words close the header
          position = fieldsAt + 16;

          if (paramCount * stride > apt.length) {
            throw new Error(
              `A function with ${paramCount} parameters cannot fit`,
            );
          }

          const params = Array.from({ length: paramCount }, (_, index) => {
            const at = paramsPointer + index * stride;

            return isVersion2
              ? {
                  register: reader.u32(at),
                  name: reader.cstr(reader.u32(at + 4)),
                }
              : { register: 0, name: reader.cstr(reader.u32(at)) };
          });
          const bodyEnd = position + size;

          if (bodyEnd > apt.length) {
            throw new Error(
              `A function body at ${position} runs past the file`,
            );
          }

          const [body] = run(position, bodyEnd, depth + 1);

          position = bodyEnd;
          instruction.operand = {
            name: reader.cstr(namePointer),
            params,
            flags,
            isVersion2,
            body,
          };
          break;
        }
      }

      code.push(instruction);

      if (opcode === 0x00 && end === undefined) {
        return [code, position];
      }
    }
  };

  return run(start, undefined, 0)[0];
};

/** Formats a string operand as a quoted literal, escaping what is not printable */
export const quote = (text: string): string =>
  `"${text.replace(/[\\"\x00-\x1f\x7f-\xff]/g, (char) =>
    char === '\\' || char === '"'
      ? `\\${char}`
      : char === '\n'
        ? '\\n'
        : char === '\t'
          ? '\\t'
          : `\\x${char.charCodeAt(0).toString(16).padStart(2, '0')}`,
  )}"`;

/**
 * Prints a block as an assembly listing, one instruction a line with its
 * offset, branch targets as labels, functions indented below their header.
 * `constants` resolves pool and register operands to what they mean.
 */
export const printListing = (
  code: AptInstruction[],
  constants: readonly (
    { kind: 'string'; value: string } | { kind: 'number'; value: number }
  )[] = [],
): string => {
  const lines: string[] = [];
  const targets = new Set<number>();
  let pool: number[] = [];

  const collectTargets = (instructions: AptInstruction[]) =>
    instructions.forEach((instruction) => {
      if (instruction.target !== undefined) {
        targets.add(instruction.target);
      }

      if (
        instruction.operand &&
        typeof instruction.operand === 'object' &&
        'body' in instruction.operand
      ) {
        collectTargets(instruction.operand.body);
      }
    });

  collectTargets(code);

  const label = (offset: number) => `L${offset.toString(16)}`;
  const describe = (index: number) => {
    const item = constants[index];

    return item === undefined
      ? '?'
      : item.kind === 'string'
        ? quote(item.value)
        : String(item.value);
  };

  const print = (instructions: AptInstruction[], indent: string) => {
    for (const instruction of instructions) {
      if (targets.has(instruction.offset)) {
        lines.push(`${label(instruction.offset)}:`);
      }

      const { name, operand, target } = instruction;
      let text = name;

      if (target !== undefined) {
        text += ` ${label(target)}`;
      } else if (typeof operand === 'number') {
        const isPoolIndex =
          /^EA_(PushConstant|PushValueOfVar|GetNamedMember|CallNamed)/.test(
            name,
          );

        text += ` ${operand}`;

        if (isPoolIndex && pool[operand] !== undefined) {
          text += `  ; ${describe(pool[operand])}`;
        }
      } else if (typeof operand === 'string') {
        text += ` ${quote(operand)}`;
      } else if (Array.isArray(operand) && typeof operand[0] === 'string') {
        text += ` ${(operand as string[]).map(quote).join(', ')}`;
      } else if (Array.isArray(operand)) {
        const list = operand as number[];

        if (name === 'ConstantPool') {
          pool = list;
          text += ` [${list.map(describe).join(', ')}]`;
        } else {
          text += ` [${list.map((index) => `r${describe(index)}`).join(', ')}]`;
        }
      } else if (operand && typeof operand === 'object') {
        const fn = operand as AptFunction;
        const params = fn.params
          .map((param) =>
            fn.isVersion2 ? `r${param.register} ${param.name}` : param.name,
          )
          .join(', ');

        lines.push(
          `${indent}${instruction.offset.toString(16).padStart(6, '0')}  ${name} ${quote(fn.name)}(${params})${fn.isVersion2 ? ` flags 0x${fn.flags.toString(16)}` : ''} {`,
        );
        print(fn.body, `${indent}    `);
        lines.push(`${indent}        }`);
        continue;
      }

      lines.push(
        `${indent}${instruction.offset.toString(16).padStart(6, '0')}  ${text}`,
      );
    }
  };

  print(code, '');

  return lines.join('\n');
};

/**
 * Whether a frame's action block always stops its timeline: a top-level
 * `Stop` runs before any branch could skip it. A block that stops only on
 * some condition, or not at all, plays on.
 */
export const stopsTimeline = (apt: Uint8Array, block: number): boolean => {
  for (const instruction of decodeBlock(apt, block)) {
    if (instruction.name === 'Stop') {
      return true;
    }
    if (instruction.target !== undefined || instruction.name === 'Return') {
      return false;
    }
  }
  return false;
};
