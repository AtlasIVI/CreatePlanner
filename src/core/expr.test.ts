import { describe, expect, it } from 'vitest';
import { bindLets, evaluate, ExprError } from './expr';

describe('expr', () => {
  it('handles precedence and unary minus', () => {
    expect(evaluate('1 + 2 * 3', {})).toBe(7);
    expect(evaluate('(1 + 2) * 3', {})).toBe(9);
    expect(evaluate('-2^2', {})).toBe(-4);
    expect(evaluate('2^3^2', {})).toBe(512);
    expect(evaluate('10 - 4 - 3', {})).toBe(3);
    expect(evaluate('7 % 4', {})).toBe(3);
  });

  it('exposes Minecraft-style helpers', () => {
    expect(evaluate('clamp(x, 1, 10)', { x: 42 })).toBe(10);
    expect(evaluate('lerp(0.5, 1, 60)', {})).toBe(30.5);
    expect(evaluate('ilog2(17)', {})).toBe(4);
    expect(evaluate('ilog2(16)', {})).toBe(4);
    expect(evaluate('if(a >= 1, 3, 2)', { a: 1 })).toBe(3);
    expect(evaluate('a == 0 && b < 2', { a: 0, b: 1 })).toBe(1);
  });

  it('follows IEEE division like Java floats (x/0 = Infinity, clamped by callers)', () => {
    expect(evaluate('clamp(5 / log2(1), 0.25, 20)', {})).toBe(20);
  });

  it('evaluates ordered let bindings', () => {
    const env = bindLets({ a: 'rpm / 2', b: 'a + 1' }, { rpm: 10 });
    expect(env.b).toBe(6);
  });

  it('rejects unknown names', () => {
    expect(() => evaluate('foo(1)', {})).toThrow(ExprError);
    expect(() => evaluate('x + 1', {})).toThrow(ExprError);
    expect(() => evaluate('1 +', {})).toThrow(ExprError);
  });
});
