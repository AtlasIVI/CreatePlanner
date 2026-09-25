// Tiny, safe arithmetic expression evaluator used by machine data files.
// Grammar: ternary-free; use if(cond, a, b). Operators: + - * / % ^, comparisons, && ||.

type Node =
  | { t: 'num'; v: number }
  | { t: 'var'; name: string }
  | { t: 'un'; op: '-' | '!'; a: Node }
  | { t: 'bin'; op: string; a: Node; b: Node }
  | { t: 'call'; name: string; args: Node[] };

export type Env = Record<string, number>;

const FUNCS: Record<string, (...a: number[]) => number> = {
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  abs: Math.abs,
  sqrt: Math.sqrt,
  pow: Math.pow,
  min: Math.min,
  max: Math.max,
  log2: Math.log2,
  /** Minecraft Mth.log2(int): floor(log2(x)) for x >= 1. */
  ilog2: (x) => (x >= 1 ? Math.floor(Math.log2(Math.floor(x))) : 0),
  clamp: (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x),
  lerp: (t, a, b) => a + t * (b - a),
  if: (c, a, b) => (c ? a : b),
};

const cache = new Map<string, Node>();

export class ExprError extends Error {}

function tokenize(src: string): string[] {
  const out: string[] = [];
  const re = /\s*(\d+(?:\.\d+)?(?:e[+-]?\d+)?|[A-Za-z_][A-Za-z0-9_]*|<=|>=|==|!=|&&|\|\||[-+*/%^(),<>!])/y;
  let pos = 0;
  while (pos < src.length) {
    if (/^\s*$/.test(src.slice(pos))) break;
    re.lastIndex = pos;
    const m = re.exec(src);
    if (!m) throw new ExprError(`Unexpected character at ${pos} in "${src}"`);
    out.push(m[1]);
    pos = re.lastIndex;
  }
  return out;
}

const PREC: Record<string, number> = {
  '||': 1,
  '&&': 2,
  '==': 3,
  '!=': 3,
  '<': 4,
  '<=': 4,
  '>': 4,
  '>=': 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6,
  '%': 6,
  '^': 7,
};

export function parse(src: string): Node {
  const hit = cache.get(src);
  if (hit) return hit;
  const toks = tokenize(src);
  let i = 0;
  const peek = () => toks[i];
  const next = () => toks[i++];
  const expect = (s: string) => {
    if (next() !== s) throw new ExprError(`Expected "${s}" in "${src}"`);
  };

  function primary(): Node {
    const tok = next();
    if (tok === undefined) throw new ExprError(`Unexpected end of "${src}"`);
    if (tok === '(') {
      const e = expr(0);
      expect(')');
      return e;
    }
    if (tok === '-' || tok === '!') return { t: 'un', op: tok, a: unaryOperand() };
    if (/^\d/.test(tok)) return { t: 'num', v: Number(tok) };
    if (/^[A-Za-z_]/.test(tok)) {
      if (peek() === '(') {
        next();
        const args: Node[] = [];
        if (peek() !== ')') {
          for (;;) {
            args.push(expr(0));
            if (peek() === ',') next();
            else break;
          }
        }
        expect(')');
        if (!(tok in FUNCS)) throw new ExprError(`Unknown function ${tok} in "${src}"`);
        return { t: 'call', name: tok, args };
      }
      return { t: 'var', name: tok };
    }
    throw new ExprError(`Unexpected token "${tok}" in "${src}"`);
  }

  // Unary minus binds tighter than binary operators except ^ (so -2^2 = -4).
  function unaryOperand(): Node {
    const base = primary();
    if (peek() === '^') {
      next();
      return { t: 'bin', op: '^', a: base, b: unaryOperand() };
    }
    return base;
  }

  function expr(minPrec: number): Node {
    let left = unaryOperand();
    for (;;) {
      const op = peek();
      const p = op === undefined ? undefined : PREC[op];
      if (p === undefined || p < minPrec || op === '^') break;
      next();
      const right = expr(p + 1);
      left = { t: 'bin', op, a: left, b: right };
    }
    return left;
  }

  const root = expr(0);
  if (i < toks.length) throw new ExprError(`Trailing tokens in "${src}"`);
  cache.set(src, root);
  return root;
}

function ev(n: Node, env: Env): number {
  switch (n.t) {
    case 'num':
      return n.v;
    case 'var': {
      const v = env[n.name];
      if (v === undefined) throw new ExprError(`Unknown variable ${n.name}`);
      return v;
    }
    case 'un': {
      const a = ev(n.a, env);
      return n.op === '-' ? -a : a ? 0 : 1;
    }
    case 'call':
      return FUNCS[n.name](...n.args.map((a) => ev(a, env)));
    case 'bin': {
      const a = ev(n.a, env);
      const b = ev(n.b, env);
      switch (n.op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': return a / b;
        case '%': return a % b;
        case '^': return Math.pow(a, b);
        case '<': return a < b ? 1 : 0;
        case '<=': return a <= b ? 1 : 0;
        case '>': return a > b ? 1 : 0;
        case '>=': return a >= b ? 1 : 0;
        case '==': return a === b ? 1 : 0;
        case '!=': return a !== b ? 1 : 0;
        case '&&': return a && b ? 1 : 0;
        case '||': return a || b ? 1 : 0;
      }
      throw new ExprError(`Unknown operator ${n.op}`);
    }
  }
}

export function evaluate(src: string, env: Env): number {
  return ev(parse(src), env);
}

/** Evaluate ordered `let` bindings, returning the extended environment. */
export function bindLets(lets: Record<string, string> | undefined, env: Env): Env {
  if (!lets) return env;
  const out: Env = { ...env };
  for (const [k, v] of Object.entries(lets)) out[k] = evaluate(v, out);
  return out;
}
