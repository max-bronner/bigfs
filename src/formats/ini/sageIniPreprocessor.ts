/**
 * The arithmetic calls of the SAGE INI preprocessor, and evaluating them.
 *
 * BFME added four calls to the Generals dialect, written in value position:
 * `#ADD( a b )`, `#SUBTRACT( a b )`, `#MULTIPLY( a b )` and `#DIVIDE( a b )`,
 * the last also as `#DIVIDE( a, b )`. Each takes exactly two operands, a
 * number or a `#define` name, and stands for the result. A percentage passes
 * through as its number, and a macro's body may itself be a call over other
 * macros, though the shipped data never nests a call inside a call's
 * operands. (mint's `docs/research/sage-ini-engine.md` section 3.)
 */

/** The four operations, by the name written after `#` */
const OPERATIONS: Record<string, (a: number, b: number) => number> = {
  ADD: (a, b) => a + b,
  SUBTRACT: (a, b) => a - b,
  MULTIPLY: (a, b) => a * b,
  DIVIDE: (a, b) => a / b,
};

/**
 * A backstop on how many macros one expansion may pass through. A cycle is
 * found exactly, by the macro names already on the chain; the shipped data
 * chains up to ten deep, so no small constant can stand in for that.
 */
const MAX_CHAIN = 256;

/** One operand of a call, positioned on its line */
export interface SageOperand {
  text: string;
  start: number;
  end: number;
}

/** One arithmetic call written in a line, or a `#` word that is not one */
export interface SageCall {
  line: number;
  /** Columns from the `#` to one past the closing parenthesis */
  start: number;
  end: number;
  /** The operation, upper case: `ADD`, `SUBTRACT`, `MULTIPLY` or `DIVIDE` */
  operation: string;
  operands: SageOperand[];
  /** Set when the call is malformed, saying how */
  error?: string;
}

/** A `#` followed by a word, the start of a call in value position */
const CALL_START = /#([A-Za-z_]+)\(/g;

/**
 * Finds every arithmetic call in the value part of a line. `content` is the
 * comment-stripped line, so columns match the original.
 */
export const scanCalls = (content: string, line: number): SageCall[] => {
  const calls: SageCall[] = [];

  CALL_START.lastIndex = 0;

  for (
    let match = CALL_START.exec(content);
    match;
    match = CALL_START.exec(content)
  ) {
    const operation = match[1].toUpperCase();
    const start = match.index;
    const open = start + match[0].length;
    const close = content.indexOf(')', open);
    const end = close < 0 ? content.length : close + 1;
    const operands: SageOperand[] = [];

    if (close >= 0) {
      for (const operand of content.slice(open, close).matchAll(/[^\s,]+/g)) {
        operands.push({
          text: operand[0],
          start: open + operand.index,
          end: open + operand.index + operand[0].length,
        });
      }
    }

    const error = !(operation in OPERATIONS)
      ? `'#${match[1]}' is not an arithmetic call; the engine has #ADD, #SUBTRACT, #MULTIPLY and #DIVIDE`
      : close < 0
        ? `#${operation} is missing its closing ')'`
        : operands.length !== 2
          ? `#${operation} takes two operands, not ${operands.length}`
          : operation === 'DIVIDE' && parseNumber(operands[1].text) === 0
            ? '#DIVIDE by zero'
            : undefined;

    calls.push({ line, start, end, operation, operands, error });
    CALL_START.lastIndex = end;
  }

  return calls;
};

/** Parses a number, or a percentage as its number; `undefined` for anything else */
const parseNumber = (text: string): number | undefined => {
  const match = /^[+-]?(\d+\.?\d*|\.\d+)%?$/.exec(text);

  return match ? parseFloat(text) : undefined;
};

/** Result of evaluating a call or an operand: its number, or why it has none */
export type SageValue = { value: number } | { error: string };

/** Callback that finds a macro's body by name, without regard to casing */
export type LookupMacro = (name: string) => string | undefined;

/**
 * Evaluates an operand: a number, or a macro whose body is a number, a call
 * or another macro's name. `chain` holds the macros being expanded, folded,
 * so a macro met again is a cycle.
 */
const evaluateOperand = (
  text: string,
  lookupMacro: LookupMacro,
  chain: readonly string[],
): SageValue => {
  const number = parseNumber(text);

  if (number !== undefined) {
    return { value: number };
  }

  const body = lookupMacro(text)?.trim();

  if (body === undefined) {
    return { error: `'${text}' is neither a number nor a known macro` };
  }

  const key = text.toLowerCase();

  if (chain.includes(key) || chain.length >= MAX_CHAIN) {
    return { error: `'${text}' refers to itself through other macros` };
  }

  const bodyNumber = parseNumber(body);

  if (bodyNumber !== undefined) {
    return { value: bodyNumber };
  }

  const [call] = scanCalls(body, 0);

  if (call && call.start === 0 && call.end === body.length) {
    return evaluateCall(call, lookupMacro, [...chain, key]);
  }

  // `#define Alias Other`: the engine substitutes the body, which is a name
  if (/^\S+$/.test(body) && lookupMacro(body) !== undefined) {
    return evaluateOperand(body, lookupMacro, [...chain, key]);
  }

  return { error: `'${text}' stands for '${body}', which is not a number` };
};

/** Evaluates a call, resolving macro operands through `lookupMacro` */
export const evaluateCall = (
  call: SageCall,
  lookupMacro: LookupMacro,
  chain: readonly string[] = [],
): SageValue => {
  if (call.error) {
    return { error: call.error };
  }

  const [left, right] = call.operands.map((operand) =>
    evaluateOperand(operand.text, lookupMacro, chain),
  );

  if ('error' in left) {
    return left;
  }

  if ('error' in right) {
    return right;
  }

  if (call.operation === 'DIVIDE' && right.value === 0) {
    return { error: '#DIVIDE by zero' };
  }

  return { value: OPERATIONS[call.operation](left.value, right.value) };
};

/**
 * Evaluates a macro body, when it is a number or a single call; `undefined` for
 * a body that is a list of tokens, which is spliced in rather than computed
 */
export const evaluateMacroBody = (
  body: string,
  lookupMacro: LookupMacro,
): SageValue | undefined => {
  const trimmed = body.trim();
  const [call] = scanCalls(trimmed, 0);

  if (call && call.start === 0 && call.end === trimmed.length) {
    return evaluateCall(call, lookupMacro);
  }

  return undefined;
};

/** Formats a result the way it would be written, without float noise */
export const formatValue = (value: number): string =>
  String(Math.round(value * 1e6) / 1e6);
