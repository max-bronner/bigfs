/**
 * The script language APT bytecode is shown and edited in: a small subset of
 * JavaScript, extended just enough that every construct maps to one fixed
 * instruction sequence. That makes the text an exact description of the
 * code, so a script that is not changed compiles back to the same
 * instructions (`aptScript.ts` checks this before showing a script).
 *
 * Besides ordinary expressions and statements it has:
 * - `$r1` - a register; `eval(e)` - a variable named at run time
 * - `` `a.b` `` - a variable or member name that is not an identifier
 * - `x := f(a)` - EA's call forms that assign the result
 * - `void f(a);` - a call whose result is dropped by a separate `Pop`
 * - `#Op<operand>(a, b)` - any instruction taking its operands from the stack
 * - `asm Op operand;` - any instruction, as it is
 * - `push(e);` and `pop()` - a value left on the stack across a statement
 * - `if (c) goto L;`, `unless (c) goto L;`, `goto L;` and `L:` labels
 * - `constants "a", "b";` - the block's constant pool
 */

/** An instruction operand in the `#Op<...>` and `asm` forms */
export type Operand =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'strs'; v: [string, string] }
  | { k: 'list'; v: number[] }
  | { k: 'label'; v: string };

/** A keyword that pushes a fixed value */
export type Keyword =
  'true' | 'false' | 'null' | 'undefined' | 'this' | '_global';

/** An expression node of the script language, tagged by `k` */
export type Expr =
  | { k: 'str'; v: string }
  | { k: 'num'; v: number; hex?: boolean }
  | { k: 'kw'; v: Keyword }
  | { k: 'reg'; n: number }
  | { k: 'var'; name: string }
  | { k: 'eval'; name: Expr }
  | { k: 'member'; obj: Expr; name: string }
  | { k: 'index'; obj: Expr; key: Expr }
  | { k: 'pop' }
  | { k: 'bin'; op: string; a: Expr; b: Expr }
  | { k: 'not'; a: Expr }
  | { k: 'intr'; op: string; operand?: Operand; args: Expr[] }
  | { k: 'call'; name: Expr; args: Expr[] }
  | { k: 'mcall'; obj: Expr; name: Expr; args: Expr[] }
  | { k: 'new'; name: Expr; args: Expr[] }
  | { k: 'newm'; obj: Expr; name: Expr; args: Expr[] }
  | { k: 'array'; items: Expr[] }
  | { k: 'object'; pairs: [Expr, Expr][] }
  | { k: 'setreg'; n: number; value: Expr }
  | { k: 'func'; def: FuncDef };

/** A function definition: DefineFunction, or DefineFunction2 when `flags` is set */
export interface FuncDef {
  name: string;
  params: { name: string; register: number }[];
  /** Set for DefineFunction2: register count and SWF flags */
  flags?: number;
  body: Stmt[];
}

/** A statement node of the script language, tagged by `k` */
export type Stmt =
  | { k: 'expr'; e: Expr; isVoid: boolean }
  | { k: 'push'; e: Expr }
  | { k: 'assignCall'; target: Expr; call: Expr }
  | { k: 'setvar'; name: string; value: Expr }
  | { k: 'setmember'; obj: Expr; name: Expr; value: Expr }
  | { k: 'local'; name: string; value?: Expr }
  | { k: 'asm'; op: string; operand?: Operand }
  | { k: 'goto'; label: string }
  | { k: 'if'; cond: Expr; label: string; unless: boolean }
  | { k: 'label'; name: string }
  | { k: 'return'; e: Expr }
  | { k: 'func'; def: FuncDef }
  | { k: 'pool'; items: (string | number)[] }
  | { k: 'block'; cond: Expr; then: Stmt[]; else?: Stmt[] }
  | { k: 'while'; cond: Expr; body: Stmt[] };

const KEYWORDS = new Set([
  'true',
  'false',
  'null',
  'undefined',
  'this',
  '_global',
  'function',
  'var',
  'new',
  'if',
  'else',
  'while',
  'goto',
  'unless',
  'return',
  'void',
  'asm',
  'push',
  'pop',
  'eval',
  'call',
  'constants',
  'flags',
  'instanceof',
]);

/** Whether a name prints bare rather than in backticks */
export const isPlainName = (name: string): boolean =>
  /^[A-Za-z_$][\w$]*$/.test(name) &&
  !KEYWORDS.has(name) &&
  !/^\$r\d+$/.test(name);

/** Quotes a string with `"` or a name with a backtick */
export const quoteText = (text: string, mark = '"'): string =>
  `${mark}${text.replace(/[\\"`\x00-\x1f\x7f-\xff]/g, (char) =>
    char === '\\' || char === mark
      ? `\\${char}`
      : char === '"' || char === '`'
        ? char
        : char === '\n'
          ? '\\n'
          : char === '\t'
            ? '\\t'
            : `\\x${char.charCodeAt(0).toString(16).padStart(2, '0')}`,
  )}${mark}`;

const printName = (name: string): string =>
  isPlainName(name) ? name : quoteText(name, '`');

/** Prints a number as the shortest decimal that reads back the same, or as hex when asked */
export const printNumber = (value: number, hex = false): string => {
  if (hex && Number.isInteger(value) && value >= 0) {
    return `0x${value.toString(16)}`;
  }

  if (Number.isInteger(value) || !Number.isFinite(value)) {
    return Object.is(value, -0) ? '-0' : String(value);
  }

  for (let digits = 1; digits <= 17; digits++) {
    const text = String(Number(value.toPrecision(digits)));

    if (Number(text) === value || Math.fround(Number(text)) === value) {
      return text;
    }
  }

  return String(value);
};

/** Binding strength of each binary operator, shared by the printer and the parser */
export const PRECEDENCE: Record<string, number> = {
  '*': 12,
  '/': 12,
  '%': 12,
  '+': 11,
  '-': 11,
  '<<': 10,
  '>>': 10,
  '>>>': 10,
  '<': 9,
  '>': 9,
  instanceof: 9,
  '==': 8,
  '===': 8,
  '&': 7,
  '^': 6,
  '|': 5,
};

const printOperand = (operand: Operand): string => {
  switch (operand.k) {
    case 'num':
      return printNumber(operand.v);
    case 'str':
      return quoteText(operand.v);
    case 'strs':
      return operand.v.map((text) => quoteText(text)).join(', ');
    case 'list':
      return `[${operand.v.join(', ')}]`;
    case 'label':
      return operand.v;
  }
};

/** How a callee or member name prints: bare, in backticks, or computed */
const printKey = (name: Expr, isMember: boolean): string =>
  name.k === 'str'
    ? `${isMember ? '.' : ''}${printName(name.v)}`
    : `${isMember ? '' : 'call'}[${printExpr(name)}]`;

const printArgs = (args: Expr[]): string =>
  args.map((arg) => printExpr(arg)).join(', ');

/** Prints an expression; `parent` is the precedence it sits in */
export const printExpr = (expr: Expr, parent = 0): string => {
  switch (expr.k) {
    case 'str':
      return quoteText(expr.v);
    case 'num': {
      const text = printNumber(expr.v, expr.hex);

      return text.startsWith('-') && parent >= 11 ? `(${text})` : text;
    }
    case 'kw':
      return expr.v;
    case 'reg':
      return `$r${expr.n}`;
    case 'var':
      return printName(expr.name);
    case 'eval':
      return `eval(${printExpr(expr.name)})`;
    case 'member':
      return `${printExpr(expr.obj, 20)}.${printName(expr.name)}`;
    case 'index':
      return `${printExpr(expr.obj, 20)}[${printExpr(expr.key)}]`;
    case 'pop':
      return 'pop()';
    case 'bin': {
      const level = PRECEDENCE[expr.op];
      const text = `${printExpr(expr.a, level)} ${expr.op} ${printExpr(expr.b, level + 1)}`;

      return level < parent ? `(${text})` : text;
    }
    case 'not':
      return `!${printExpr(expr.a, 14)}`;
    case 'intr':
      return `#${expr.op}${expr.operand ? `<${printOperand(expr.operand)}>` : ''}(${printArgs(expr.args)})`;
    case 'call':
      return `${printKey(expr.name, false)}(${printArgs(expr.args)})`;
    case 'mcall':
      return `${printExpr(expr.obj, 20)}${printKey(expr.name, true)}(${printArgs(expr.args)})`;
    case 'new':
      return `new ${printKey(expr.name, false)}(${printArgs(expr.args)})`;
    case 'newm':
      return `new ${printExpr(expr.obj, 20)}${printKey(expr.name, true)}(${printArgs(expr.args)})`;
    case 'array':
      return `[${printArgs(expr.items)}]`;
    case 'object':
      return `{${expr.pairs
        .map(([key, value]) => `${printExpr(key)}: ${printExpr(value)}`)
        .join(', ')}}`;
    case 'setreg': {
      const text = `$r${expr.n} = ${printExpr(expr.value, 1)}`;

      return parent > 0 ? `(${text})` : text;
    }
    case 'func':
      return printFunction(expr.def, '');
  }
};

const printFunction = (def: FuncDef, indent: string): string => {
  const params = def.params
    .map((param) =>
      param.register
        ? `$r${param.register} ${printName(param.name)}`
        : printName(param.name),
    )
    .join(', ');
  const flags =
    def.flags === undefined ? '' : ` flags 0x${def.flags.toString(16)}`;
  const name = def.name ? ` ${printName(def.name)}` : ' ';

  return `function${name}(${params})${flags} {\n${printStatements(def.body, `${indent}  `)}${indent}}`;
};

const printStatement = (stmt: Stmt, indent: string): string => {
  switch (stmt.k) {
    case 'expr':
      return `${stmt.isVoid ? 'void ' : ''}${printExpr(stmt.e)};`;
    case 'push':
      return `push(${printExpr(stmt.e)});`;
    case 'assignCall': {
      const target =
        stmt.target.k === 'str'
          ? printName(stmt.target.v)
          : `eval(${printExpr(stmt.target)})`;

      return `${target} := ${printExpr(stmt.call)};`;
    }
    case 'setvar': {
      const text = printName(stmt.name);
      const step = getIncrementSuffix(stmt.value, text);

      return step ? `${text}${step};` : `${text} = ${printExpr(stmt.value)};`;
    }
    case 'setmember': {
      const target: Expr =
        stmt.name.k === 'str'
          ? { k: 'member', obj: stmt.obj, name: stmt.name.v }
          : { k: 'index', obj: stmt.obj, key: stmt.name };
      const text = printExpr(target);
      const step = getIncrementSuffix(stmt.value, text);

      return step ? `${text}${step};` : `${text} = ${printExpr(stmt.value)};`;
    }
    case 'local':
      return `var ${printName(stmt.name)}${stmt.value ? ` = ${printExpr(stmt.value)}` : ''};`;
    case 'asm':
      return `asm ${stmt.op}${stmt.operand ? ` ${printOperand(stmt.operand)}` : ''};`;
    case 'goto':
      return `goto ${stmt.label};`;
    case 'if':
      return `${stmt.unless ? 'unless' : 'if'} (${printExpr(stmt.cond)}) goto ${stmt.label};`;
    case 'label':
      return `${stmt.name}:`;
    case 'return':
      return `return ${printExpr(stmt.e)};`;
    case 'func':
      return printFunction(stmt.def, indent);
    case 'pool':
      return `constants ${stmt.items
        .map((item) =>
          typeof item === 'string' ? quoteText(item) : printNumber(item),
        )
        .join(', ')};`;
    case 'block': {
      const head = `if (${printExpr(stmt.cond)}) {\n${printStatements(stmt.then, `${indent}  `)}${indent}}`;

      return stmt.else
        ? `${head} else {\n${printStatements(stmt.else, `${indent}  `)}${indent}}`
        : head;
    }
    case 'while':
      return `while (${printExpr(stmt.cond)}) {\n${printStatements(stmt.body, `${indent}  `)}${indent}}`;
  }
};

/** `x = #Increment(x)` prints as `x++`: the suffix, when the value is that */
const getIncrementSuffix = (value: Expr, target: string): string | undefined =>
  value.k === 'intr' &&
  (value.op === 'Increment' || value.op === 'Decrement') &&
  !value.operand &&
  value.args.length === 1 &&
  printExpr(value.args[0]) === target
    ? value.op === 'Increment'
      ? '++'
      : '--'
    : undefined;

/** Prints statements one a line at `indent`, labels outdented a level */
export const printStatements = (stmts: Stmt[], indent = ''): string =>
  stmts
    .map((stmt) =>
      stmt.k === 'label'
        ? `${indent.slice(2)}${printStatement(stmt, indent)}\n`
        : `${indent}${printStatement(stmt, indent)}\n`,
    )
    .join('');
