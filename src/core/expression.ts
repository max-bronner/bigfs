/**
 * A small arithmetic language for the formulas a modder types instead of
 * editing values one by one: a motion over frames (`x0 + 120*t`,
 * `y0 - 40*sin(t*pi)`), or a change to many INI values (`round(x * 1.1)`).
 * Parsed into a function once, never evaluated as JavaScript.
 *
 * Numbers, variables, `+ - * / % ^`, unary minus, parentheses, and the
 * functions and constants below. `^` is a power and binds right.
 */

export type Variables = Record<string, number>;

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  atan2: Math.atan2,
  sqrt: Math.sqrt,
  abs: Math.abs,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  exp: Math.exp,
  log: Math.log,
  sign: Math.sign,
  clamp: (value, low, high) => Math.min(high, Math.max(low, value)),
  lerp: (from, to, t) => from + (to - from) * t,
};

const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E };

export class ExpressionError extends Error {}

type Node = (variables: Variables) => number;

/** Turns an expression into a function of its variables, or explains where it fails */
export const compileExpression = (source: string): Node => {
  const tokens =
    source.match(
      /\d+\.?\d*(?:e[-+]?\d+)?|\.\d+|[A-Za-z_]\w*|[-+*/%^(),]|\S/gi,
    ) ?? [];
  let at = 0;
  const peek = () => tokens[at];
  const take = (expected?: string) => {
    const token = tokens[at];

    if (token === undefined || (expected !== undefined && token !== expected)) {
      throw new ExpressionError(
        token === undefined
          ? `Expected ${expected ?? 'more'} at the end`
          : `Expected ${expected} but found "${token}"`,
      );
    }
    at++;
    return token;
  };

  const sum = (): Node => {
    let left = product();

    while (peek() === '+' || peek() === '-') {
      const op = take();
      const right = product();
      const before = left;

      left =
        op === '+' ? (v) => before(v) + right(v) : (v) => before(v) - right(v);
    }
    return left;
  };
  const product = (): Node => {
    let left = unary();

    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = take();
      const right = unary();
      const before = left;

      left =
        op === '*'
          ? (v) => before(v) * right(v)
          : op === '/'
            ? (v) => before(v) / right(v)
            : (v) => before(v) % right(v);
    }
    return left;
  };
  const unary = (): Node => {
    if (peek() === '-') {
      take();
      const inner = unary();

      return (v) => -inner(v);
    }
    if (peek() === '+') {
      take();
      return unary();
    }
    return power();
  };
  const power = (): Node => {
    const base = atom();

    if (peek() === '^') {
      take();
      const exponent = unary();

      return (v) => base(v) ** exponent(v);
    }
    return base;
  };
  const atom = (): Node => {
    const token = take();

    if (/^(\d|\.)/.test(token)) {
      const value = Number(token);

      return () => value;
    }
    if (token === '(') {
      const inner = sum();

      take(')');
      return inner;
    }
    if (/^[A-Za-z_]/.test(token)) {
      const name = token.toLowerCase();

      if (peek() === '(') {
        const fn = FUNCTIONS[name];

        if (!fn) {
          throw new ExpressionError(`Unknown function "${token}"`);
        }
        take('(');

        const args: Node[] = [];

        if (peek() !== ')') {
          args.push(sum());
          while (peek() === ',') {
            take();
            args.push(sum());
          }
        }
        take(')');
        return (v) => fn(...args.map((arg) => arg(v)));
      }
      if (name in CONSTANTS) {
        const value = CONSTANTS[name];

        return () => value;
      }
      return (v) => {
        if (!(token in v)) {
          throw new ExpressionError(`Unknown name "${token}"`);
        }
        return v[token];
      };
    }
    throw new ExpressionError(`Unexpected "${token}"`);
  };

  if (!tokens.length) {
    throw new ExpressionError('The expression is empty');
  }

  const node = sum();

  if (at < tokens.length) {
    throw new ExpressionError(`Unexpected "${tokens[at]}"`);
  }
  return (variables) => {
    const value = node(variables);

    if (!Number.isFinite(value)) {
      throw new ExpressionError('The expression does not give a finite number');
    }
    return value;
  };
};

/** Easing curves by name: progress 0..1 in, 0..1 out (back and elastic overshoot) */
export const EASINGS: Record<string, (t: number) => number> = {
  linear: (t) => t,
  easeIn: (t) => t * t,
  easeOut: (t) => 1 - (1 - t) * (1 - t),
  easeInOut: (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  sine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  cubic: (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
  back: (t) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2,
  elastic: (t) =>
    t === 0 || t === 1
      ? t
      : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1,
  bounce: (t) => {
    const n = 7.5625;
    const d = 2.75;

    if (t < 1 / d) {
      return n * t * t;
    }
    if (t < 2 / d) {
      return n * (t -= 1.5 / d) * t + 0.75;
    }
    if (t < 2.5 / d) {
      return n * (t -= 2.25 / d) * t + 0.9375;
    }
    return n * (t -= 2.625 / d) * t + 0.984375;
  },
  step: (t) => (t < 1 ? 0 : 1),
};
