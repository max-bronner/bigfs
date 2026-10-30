import {
  Expr,
  FuncDef,
  Keyword,
  Operand,
  PRECEDENCE,
  Stmt,
} from './aptScriptSyntax';

/** Error thrown by `parseScript`, with the line and column, from 1, it was found at */
export class ScriptError extends Error {
  public constructor(
    message: string,
    public readonly line: number,
    public readonly column: number,
  ) {
    super(`${line}:${column}: ${message}`);
  }
}

interface Token {
  kind: 'name' | 'quoted' | 'string' | 'number' | 'punct' | 'end';
  text: string;
  /** The value of a string, backtick name or number */
  value?: string | number;
  hex?: boolean;
  line: number;
  column: number;
}

const PUNCTUATION = [
  '>>>',
  '===',
  ':=',
  '==',
  '>>',
  '<<',
  '++',
  '--',
  ...'()[]{},;:.=#<>!+-*/%&|^',
];

const unescape = (body: string): string =>
  body.replace(/\\(x[0-9a-fA-F]{2}|.)/g, (_, code: string) =>
    code.length === 3
      ? String.fromCharCode(parseInt(code.slice(1), 16))
      : code === 'n'
        ? '\n'
        : code === 't'
          ? '\t'
          : code,
  );

const tokenize = (source: string): Token[] => {
  const tokens: Token[] = [];
  let index = 0;
  let line = 1;
  let lineStart = 0;

  while (index < source.length) {
    const char = source[index];
    const column = index - lineStart + 1;

    if (char === '\n') {
      line++;
      index++;
      lineStart = index;
      continue;
    }

    if (/\s/.test(char)) {
      index++;
      continue;
    }

    if (source.startsWith('//', index)) {
      while (index < source.length && source[index] !== '\n') {
        index++;
      }
      continue;
    }

    if (source.startsWith('/*', index)) {
      const end = source.indexOf('*/', index + 2);

      if (end < 0) {
        throw new ScriptError('Unclosed comment', line, column);
      }

      for (const skipped of source.slice(index, end)) {
        if (skipped === '\n') {
          line++;
        }
      }
      lineStart = source.lastIndexOf('\n', end) + 1 || lineStart;
      index = end + 2;
      continue;
    }

    if (char === '"' || char === '`') {
      let end = index + 1;

      while (end < source.length && source[end] !== char) {
        if (source[end] === '\n') {
          throw new ScriptError('Unclosed string', line, column);
        }
        end += source[end] === '\\' ? 2 : 1;
      }

      if (end >= source.length) {
        throw new ScriptError('Unclosed string', line, column);
      }

      tokens.push({
        kind: char === '"' ? 'string' : 'quoted',
        text: source.slice(index, end + 1),
        value: unescape(source.slice(index + 1, end)),
        line,
        column,
      });
      index = end + 1;
      continue;
    }

    const number =
      /^(0x[0-9a-fA-F]+|\d+(\.\d*)?([eE][-+]?\d+)?|\.\d+([eE][-+]?\d+)?)/.exec(
        source.slice(index, index + 64),
      );

    if (number) {
      tokens.push({
        kind: 'number',
        text: number[0],
        value: Number(number[0]),
        hex: number[0].startsWith('0x'),
        line,
        column,
      });
      index += number[0].length;
      continue;
    }

    const name = /^[A-Za-z_$][\w$]*/.exec(source.slice(index, index + 256));

    if (name) {
      tokens.push({ kind: 'name', text: name[0], line, column });
      index += name[0].length;
      continue;
    }

    const punct = PUNCTUATION.find((text) => source.startsWith(text, index));

    if (!punct) {
      throw new ScriptError(
        `Unexpected character ${JSON.stringify(char)}`,
        line,
        column,
      );
    }

    tokens.push({ kind: 'punct', text: punct, line, column });
    index += punct.length;
  }

  tokens.push({
    kind: 'end',
    text: 'end of script',
    line,
    column: index - lineStart + 1,
  });

  return tokens;
};

const KEYWORD_VALUES = new Set([
  'true',
  'false',
  'null',
  'undefined',
  'this',
  '_global',
]);

/**
 * Parses script text into statements.
 * @throws ScriptError at the first token that does not parse
 */
export const parseScript = (source: string): Stmt[] => {
  const tokens = tokenize(source);
  let position = 0;

  const peek = (offset = 0) =>
    tokens[Math.min(position + offset, tokens.length - 1)];
  const fail = (message: string, token = peek()): never => {
    throw new ScriptError(message, token.line, token.column);
  };
  const next = () => tokens[position++] ?? fail('Unexpected end');
  const is = (text: string, offset = 0) => {
    const token = peek(offset);

    return (
      (token.kind === 'punct' || token.kind === 'name') && token.text === text
    );
  };
  const accept = (text: string) => (is(text) ? (position++, true) : false);
  const expect = (text: string) => {
    if (!accept(text)) {
      fail(`Expected ${text} but found ${peek().text}`);
    }
  };

  // A plain or backtick name
  const name = (): string => {
    const token = next();

    if (token.kind === 'name') {
      return token.text;
    }

    if (token.kind === 'quoted') {
      return token.value as string;
    }

    return fail(`Expected a name but found ${token.text}`, token);
  };

  const isRegisterName = (text: string) => /^\$r\d+$/.test(text);

  const operand = (): Operand => {
    const token = peek();

    if (token.kind === 'string') {
      next();

      if (accept(',')) {
        const second = next();

        if (second.kind !== 'string') {
          fail('Expected a second string', second);
        }

        return {
          k: 'strs',
          v: [token.value as string, second.value as string],
        };
      }

      return { k: 'str', v: token.value as string };
    }

    if (accept('[')) {
      const list: number[] = [];

      while (!accept(']')) {
        list.push(integer());
        if (!is(']')) {
          expect(',');
        }
      }

      return { k: 'list', v: list };
    }

    if (token.kind === 'name') {
      next();

      return { k: 'label', v: token.text };
    }

    return { k: 'num', v: signed() };
  };

  const signed = (): number => {
    const negative = accept('-');
    const token = next();

    if (token.kind !== 'number') {
      fail(`Expected a number but found ${token.text}`, token);
    }

    return negative ? -(token.value as number) : (token.value as number);
  };

  const integer = (): number => {
    const value = signed();

    if (!Number.isInteger(value)) {
      fail('Expected a whole number');
    }

    return value;
  };

  const args = (close = ')'): Expr[] => {
    const list: Expr[] = [];

    while (!accept(close)) {
      list.push(expression());
      if (!is(close)) {
        expect(',');
      }
    }

    return list;
  };

  const functionDef = (isStatement: boolean): FuncDef => {
    const functionName = isStatement || !is('(') ? name() : '';

    expect('(');

    const params: FuncDef['params'] = [];

    while (!accept(')')) {
      let paramRegister = 0;

      if (
        peek().kind === 'name' &&
        isRegisterName(peek().text) &&
        peek(1).kind !== 'punct'
      ) {
        paramRegister = Number(next().text.slice(2));
      }

      params.push({ name: name(), register: paramRegister });
      if (!is(')')) {
        expect(',');
      }
    }

    let flags: number | undefined;

    if (accept('flags')) {
      flags = integer() >>> 0;
    }

    expect('{');

    return { name: functionName, params, flags, body: block() };
  };

  // A callee written before `(`: a name, a member, or `call[e]`
  const callOf = (callee: Expr, list: Expr[], isNew: boolean): Expr => {
    if (callee.k === 'var') {
      return {
        k: isNew ? 'new' : 'call',
        name: { k: 'str', v: callee.name },
        args: list,
      };
    }

    if (callee.k === 'member') {
      return {
        k: isNew ? 'newm' : 'mcall',
        obj: callee.obj,
        name: { k: 'str', v: callee.name },
        args: list,
      };
    }

    if (callee.k === 'index') {
      return {
        k: isNew ? 'newm' : 'mcall',
        obj: callee.obj,
        name: callee.key,
        args: list,
      };
    }

    return fail('Only a name or a member can be called');
  };

  const primary = (): Expr => {
    const token = next();

    switch (token.kind) {
      case 'string':
        return { k: 'str', v: token.value as string };
      case 'number':
        return {
          k: 'num',
          v: token.value as number,
          hex: token.hex || undefined,
        };
      case 'quoted':
        return { k: 'var', name: token.value as string };
      case 'end':
        return fail('Unexpected end of script', token);
      case 'name':
        break;
      case 'punct':
        if (token.text === '(') {
          const inner = expression();

          if (inner.k === 'reg' && accept('=')) {
            const value = expression();

            expect(')');

            return { k: 'setreg', n: inner.n, value };
          }

          expect(')');

          return inner;
        }

        if (token.text === '-' && peek().kind === 'number') {
          const value = next();

          return {
            k: 'num',
            v: -(value.value as number),
            hex: value.hex || undefined,
          };
        }

        if (token.text === '!') {
          return { k: 'not', a: unary() };
        }

        if (token.text === '[') {
          return { k: 'array', items: args(']') };
        }

        if (token.text === '{') {
          const pairs: [Expr, Expr][] = [];

          while (!accept('}')) {
            const key = expression();

            expect(':');
            pairs.push([key, expression()]);
            if (!is('}')) {
              expect(',');
            }
          }

          return { k: 'object', pairs };
        }

        if (token.text === '#') {
          const op = name();
          let intrinsicOperand: Operand | undefined;

          if (accept('<')) {
            intrinsicOperand = operand();
            expect('>');
          }

          expect('(');

          return { k: 'intr', op, operand: intrinsicOperand, args: args() };
        }

        return fail(`Unexpected ${token.text}`, token);
    }

    const text = token.text;

    if (KEYWORD_VALUES.has(text)) {
      return { k: 'kw', v: text as Keyword };
    }

    if (isRegisterName(text)) {
      return { k: 'reg', n: Number(text.slice(2)) };
    }

    if (text === 'eval') {
      expect('(');

      const inner = expression();

      expect(')');

      return { k: 'eval', name: inner };
    }

    if (text === 'pop') {
      expect('(');
      expect(')');

      return { k: 'pop' };
    }

    if (text === 'function') {
      return { k: 'func', def: functionDef(false) };
    }

    if (text === 'call') {
      expect('[');

      const callee = expression();

      expect(']');
      expect('(');

      return { k: 'call', name: callee, args: args() };
    }

    if (text === 'new') {
      let callee: Expr;

      if (accept('call')) {
        expect('[');
        const computed = expression();

        expect(']');
        expect('(');

        return { k: 'new', name: computed, args: args() };
      }

      callee = { k: 'var', name: name() };
      while (is('.') || is('[')) {
        callee = memberOf(callee);
      }
      expect('(');

      return callOf(callee, args(), true);
    }

    return { k: 'var', name: text };
  };

  const memberOf = (object: Expr): Expr => {
    if (accept('.')) {
      return { k: 'member', obj: object, name: name() };
    }

    expect('[');

    const key = expression();

    expect(']');

    return { k: 'index', obj: object, key };
  };

  const postfix = (): Expr => {
    let expr = primary();

    for (;;) {
      if (is('.') || is('[')) {
        expr = memberOf(expr);
      } else if (
        is('(') &&
        (expr.k === 'var' || expr.k === 'member' || expr.k === 'index')
      ) {
        next();
        expr = callOf(expr, args(), false);
      } else {
        return expr;
      }
    }
  };

  const unary = (): Expr => postfix();

  const binary = (level: number): Expr => {
    let left = unary();

    for (;;) {
      const token = peek();
      const op = token.text;
      const strength =
        (token.kind === 'punct' ||
          (token.kind === 'name' && op === 'instanceof')) &&
        PRECEDENCE[op];

      if (!strength || strength < level) {
        return left;
      }

      next();
      left = { k: 'bin', op, a: left, b: binary(strength + 1) };
    }
  };

  const expression = (): Expr => binary(0);

  const block = (): Stmt[] => {
    const list: Stmt[] = [];

    while (!accept('}')) {
      if (peek().kind === 'end') {
        fail('Missing }');
      }
      list.push(statement());
    }

    return list;
  };

  const end = () => expect(';');

  const statement = (): Stmt => {
    const token = peek();

    if (
      token.kind === 'name' &&
      peek(1).kind === 'punct' &&
      peek(1).text === ':'
    ) {
      next();
      next();

      return { k: 'label', name: token.text };
    }

    if (token.kind === 'name') {
      switch (token.text) {
        case 'constants': {
          next();

          const items: (string | number)[] = [];

          while (!accept(';')) {
            const item = peek();

            if (item.kind === 'string') {
              next();
              items.push(item.value as string);
            } else {
              items.push(signed());
            }
            if (!is(';')) {
              expect(',');
            }
          }

          return { k: 'pool', items };
        }
        case 'asm': {
          next();

          const op = name();
          const stmt: Stmt = {
            k: 'asm',
            op,
            operand: is(';') ? undefined : operand(),
          };

          end();

          return stmt;
        }
        case 'goto': {
          next();

          const label = name();

          end();

          return { k: 'goto', label };
        }
        case 'if':
        case 'unless': {
          next();
          expect('(');

          const cond = expression();

          expect(')');

          if (accept('goto')) {
            const label = name();

            end();

            return { k: 'if', cond, label, unless: token.text === 'unless' };
          }

          if (token.text === 'unless') {
            fail('unless takes goto');
          }

          expect('{');

          const then = block();

          if (accept('else')) {
            expect('{');

            return { k: 'block', cond, then, else: block() };
          }

          return { k: 'block', cond, then };
        }
        case 'while': {
          next();
          expect('(');

          const cond = expression();

          expect(')');
          expect('{');

          return { k: 'while', cond, body: block() };
        }
        case 'function':
          if (!(peek(1).kind === 'punct' && peek(1).text === '(')) {
            next();

            return { k: 'func', def: functionDef(true) };
          }
          break;
        case 'var': {
          next();

          const local = name();
          const value = accept('=') ? expression() : undefined;

          end();

          return { k: 'local', name: local, value };
        }
        case 'return': {
          next();

          const e = expression();

          end();

          return { k: 'return', e };
        }
        case 'push':
          if (peek(1).text === '(') {
            next();
            next();

            const e = expression();

            expect(')');
            end();

            return { k: 'push', e };
          }
          break;
        case 'void': {
          next();

          const e = expression();

          end();

          return { k: 'expr', e, isVoid: true };
        }
      }
    }

    const target = expression();

    if (accept('=')) {
      const value = expression();

      end();

      return assignment(target, value, token);
    }

    if (accept(':=')) {
      const call = expression();

      if (call.k !== 'call' && call.k !== 'mcall') {
        fail(':= takes a call', token);
      }

      end();

      return {
        k: 'assignCall',
        target:
          target.k === 'var'
            ? { k: 'str', v: target.name }
            : target.k === 'eval'
              ? target.name
              : fail(':= assigns to a name', token),
        call,
      };
    }

    if (is('++') || is('--')) {
      const op = next().text === '++' ? 'Increment' : 'Decrement';

      end();

      return assignment(target, { k: 'intr', op, args: [target] }, token);
    }

    end();

    return { k: 'expr', e: target, isVoid: false };
  };

  const assignment = (target: Expr, value: Expr, token: Token): Stmt => {
    switch (target.k) {
      case 'var':
        return { k: 'setvar', name: target.name, value };
      case 'member':
        return {
          k: 'setmember',
          obj: target.obj,
          name: { k: 'str', v: target.name },
          value,
        };
      case 'index':
        return { k: 'setmember', obj: target.obj, name: target.key, value };
      case 'reg':
        return {
          k: 'expr',
          e: { k: 'setreg', n: target.n, value },
          isVoid: false,
        };
      default:
        return fail('Cannot assign to this', token);
    }
  };

  const statements: Stmt[] = [];

  while (peek().kind !== 'end') {
    statements.push(statement());
  }

  return statements;
};
