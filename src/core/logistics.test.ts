import { describe, expect, it } from 'vitest';
import {
  analyzeLogistics,
  DEFAULT_CONSTANTS as C,
  gaugeInterval,
  linkPackagesPerSecond,
  moduleOrder,
  packagesPerRequest,
  simulateStock,
} from './logistics';
import type { GaugeModule } from './project';

function mod(p: Partial<GaugeModule> & { id: string }): GaugeModule {
  return {
    name: p.id,
    mode: 'recipe',
    output: `test:${p.id}`,
    outputPerRequest: 1,
    targetStock: 64,
    address: 'usine',
    promiseTimeout: null,
    inputs: [],
    machineRate: 10,
    link: { kind: 'direct', rpm: 64, length: 0, frogports: 1 },
    demand: 0,
    ...p,
  };
}

// Two gauges: sheets (A) feed gears (B); the factory wants 0.5 gears/s.
const chain = (outA: number, outB: number, amountB: number) => [
  mod({ id: 'A', output: 'create:iron_sheet', outputPerRequest: outA, machineRate: 1.25, inputs: [{ from: null, item: 'minecraft:iron_ingot', amount: outA }] }),
  mod({
    id: 'B',
    outputPerRequest: outB,
    targetStock: 32,
    machineRate: 2,
    inputs: [{ from: 'A', item: 'create:iron_sheet', amount: amountB }],
    link: { kind: 'chain', rpm: 64, length: 20, frogports: 1 },
    demand: 0.5,
  }),
];

describe('link and gauge limits', () => {
  it('a recipe gauge fires once every 101 ticks', () => {
    expect(gaugeInterval(C)).toBeCloseTo(5.05, 10);
  });
  it('chain conveyor: |rpm|/360 blocks per tick', () => {
    expect(linkPackagesPerSecond('chain', { kind: 'chain', rpm: 64, length: 20, frogports: 0 }, C)).toBeCloseTo((64 / 360) * 20, 10);
    // A long chain is limited by the 20 packages it can hold.
    expect(linkPackagesPerSecond('chain', { kind: 'chain', rpm: 64, length: 200, frogports: 0 }, C)).toBeCloseTo((20 * (64 / 360) * 20) / 200, 10);
  });
  it('frogports: one package per cycle each', () => {
    expect(linkPackagesPerSecond('frogport', { kind: 'frogport', rpm: 0, length: 0, frogports: 2 }, C)).toBe(2);
  });
  it('packages hold 9 stacks', () => {
    const m = mod({ id: 'x', inputs: [{ from: null, item: 'a', amount: 640 }] });
    expect(packagesPerRequest(m, () => 64, C)).toBe(2);
  });
});

describe('two-gauge chain', () => {
  it('finds the gauge request rate as the bottleneck', () => {
    const a = analyzeLogistics(chain(1, 1, 2), C);
    const A = a.byId.get('A')!;
    const B = a.byId.get('B')!;
    expect(a.order).toEqual(['A', 'B']);
    expect(A.required).toBeCloseTo(1, 10);
    expect(A.limitedBy).toBe('gauge');
    expect(A.achievable).toBeCloseTo(1 / 5.05, 10);
    expect(B.limitedBy).toBe('inputs');
    expect(B.achievable).toBeCloseTo(1 / 5.05 / 2, 10);
    expect(a.bottleneck).toBe('A');
  });

  it('bigger batches per request remove the bottleneck', () => {
    const a = analyzeLogistics(chain(8, 4, 8), C);
    expect(a.bottleneck).toBeUndefined();
    expect(a.byId.get('A')!.limitedBy).toBe('machines');
    expect(a.byId.get('B')!.achievable).toBeGreaterThanOrEqual(0.5);
  });

  it('flags a missing address (the gauge never sends)', () => {
    const mods = chain(8, 4, 8);
    mods[0].address = '';
    const a = analyzeLogistics(mods, C);
    expect(a.byId.get('A')!.issues).toContain('no-address');
    expect(a.byId.get('A')!.caps.gauge).toBe(0);
    expect(a.bottleneck).toBe('A');
  });

  it('detects cycles', () => {
    const mods = [mod({ id: 'X', inputs: [{ from: 'Y', item: 'test:Y', amount: 1 }] }), mod({ id: 'Y', inputs: [{ from: 'X', item: 'test:X', amount: 1 }] })];
    expect(moduleOrder(mods).cyclic.size).toBe(2);
  });
});

describe('stock simulation', () => {
  it('the downstream module starves when the gauge is the bottleneck', () => {
    const sim = simulateStock(chain(1, 1, 2), C, 600);
    const B = sim.series.find((s) => s.id === 'B')!;
    expect(B.verdict).toBe('starves');
    expect(B.delivered / 600).toBeLessThan(0.15);
  });

  it('a sized chain keeps up with demand after warm-up', () => {
    const sim = simulateStock(chain(8, 4, 8), C, 900);
    const B = sim.series.find((s) => s.id === 'B')!;
    expect(B.verdict).not.toBe('starves');
    expect(B.delivered / 900).toBeGreaterThan(0.45);
  });

  it('expired promises trigger new requests (over-ordering when machines are slow)', () => {
    const slow = { id: 'slow', outputPerRequest: 4, targetStock: 8, machineRate: 0.05, inputs: [{ from: null, item: 'x', amount: 1 }] };
    const never = simulateStock([mod({ ...slow, promiseTimeout: null })], C, 600).series[0];
    const short = simulateStock([mod({ ...slow, promiseTimeout: 30 })], C, 600).series[0];
    expect(Math.max(...short.stock)).toBeGreaterThan(Math.max(...never.stock));
  });

  it('stock without consumers accumulates up to the target', () => {
    const sim = simulateStock([mod({ id: 'solo', outputPerRequest: 4, targetStock: 16, inputs: [{ from: null, item: 'x', amount: 1 }] })], C, 300);
    const s = sim.series[0];
    expect(s.verdict).toBe('accumulates');
    expect(Math.max(...s.stock)).toBeLessThanOrEqual(16 + 4);
  });
});
