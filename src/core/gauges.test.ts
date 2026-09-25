import { describe, expect, it } from 'vitest';
import {
  emptyBoard,
  gaugeStatus,
  initSim,
  matchAddress,
  newDestination,
  newGauge,
  packStacks,
  promiseTimeoutTicks,
  sendManual,
  stepSim,
  type Board,
} from './gauges';

// Iron ingot gauge (input) -> iron sheet gauge (recipe at "presse").
function pressBoard(): Board {
  const b = emptyBoard();
  const ingot = { ...newGauge(0, 0, 1), id: 'ingot', label: 'Lingots', item: 'minecraft:iron_ingot' };
  const sheet = {
    ...newGauge(1, 0, 2),
    id: 'sheet',
    label: 'Plaques',
    item: 'create:iron_sheet',
    amount: 10,
    address: 'presse',
    recipeOutput: 2,
    inputs: [{ from: 'ingot', amount: 2 }],
  };
  const press = { ...newDestination('presse'), travelSec: 1, processSec: 2 };
  return { ...b, gauges: [ingot, sheet], destinations: [press], stock: { 'minecraft:iron_ingot': 100 } };
}

describe('recipe gauge', () => {
  it('requests its inputs at once, promises its output, then gets it back', () => {
    const b = pressBoard();
    const sim = initSim(b);
    stepSim(b, sim, 1);
    expect(sim.stock['minecraft:iron_ingot']).toBe(98);
    expect(sim.packages).toHaveLength(1);
    expect(sim.packages[0]).toMatchObject({ address: 'presse', contents: [{ item: 'minecraft:iron_ingot', count: 2 }], status: 'transit' });
    expect(gaugeStatus(sim, b.gauges[1]).promised).toBe(2);
    // 1 s travel + 2 s processing + 1 s back
    stepSim(b, sim, 80);
    expect(sim.stock['create:iron_sheet']).toBe(2);
    expect(sim.promises.filter((p) => p.gauge === 'sheet')).toHaveLength(0);
  });

  it('sends one request every 101 ticks while unsatisfied', () => {
    const b = pressBoard();
    b.gauges[1].amount = 1000;
    const sim = initSim(b);
    stepSim(b, sim, 1);
    stepSim(b, sim, 100);
    expect(sim.packages).toHaveLength(1);
    stepSim(b, sim, 1);
    expect(sim.packages).toHaveLength(2);
  });

  it('stops once stock + promised reaches the target', () => {
    const b = pressBoard();
    b.gauges[1].amount = 2;
    const sim = initSim(b);
    stepSim(b, sim, 400);
    expect(sim.packages).toHaveLength(1);
    expect(gaugeStatus(sim, b.gauges[1]).state).toBe('satisfied');
  });

  it('sends nothing without an address', () => {
    const b = pressBoard();
    b.gauges[1].address = '';
    const sim = initSim(b);
    stepSim(b, sim, 300);
    expect(sim.packages).toHaveLength(0);
    expect(gaugeStatus(sim, b.gauges[1]).state).toBe('no-address');
  });

  it('sends nothing when one input is short (all or nothing)', () => {
    const b = pressBoard();
    b.stock = { 'minecraft:iron_ingot': 1 };
    const sim = initSim(b);
    stepSim(b, sim, 300);
    expect(sim.packages).toHaveLength(0);
    expect(gaugeStatus(sim, b.gauges[1]).state).toBe('missing-inputs');
  });

  it('expires promises after the timeout and requests again', () => {
    const b = pressBoard();
    b.gauges[1].amount = 2;
    b.gauges[1].promiseTimeout = 0; // 30 s
    b.destinations[0].processSec = 60; // the press is slower than the promise
    const sim = initSim(b);
    stepSim(b, sim, promiseTimeoutTicks(0) + 1);
    expect(sim.log.some((l) => l.text.includes('expirée'))).toBe(true);
    // The timer was reset by the first request and frozen while satisfied: it counts down 100 ticks again.
    stepSim(b, sim, 99);
    expect(sim.packages).toHaveLength(1);
    stepSim(b, sim, 1);
    expect(sim.packages).toHaveLength(2);
  });

  it('packages with no matching address are not delivered', () => {
    const b = pressBoard();
    b.gauges[1].address = 'four';
    const sim = initSim(b);
    stepSim(b, sim, 200);
    expect(sim.packages[0].status).toBe('undeliverable');
    expect(sim.stock['create:iron_sheet'] ?? 0).toBe(0);
  });
});

describe('restock gauge', () => {
  it('orders its own item (max 9 stacks) to its address', () => {
    const b = emptyBoard();
    b.stock = { 'minecraft:coal': 2000 };
    b.destinations = [{ ...newDestination('four'), travelSec: 1 }];
    b.gauges = [{ ...newGauge(0, 0, 1), id: 'c', item: 'minecraft:coal', mode: 'restock', amount: 20, unit: 'stacks', address: 'four' }];
    const sim = initSim(b);
    stepSim(b, sim, 1);
    expect(sim.stock['minecraft:coal']).toBe(2000 - 576);
    expect(sim.packages).toHaveLength(1);
    stepSim(b, sim, 25);
    expect(sim.local.c).toBe(576);
  });
});

describe('farm gauge', () => {
  it('adds the farm output to the network and feeds a recipe gauge', () => {
    const b = pressBoard();
    b.stock = {};
    b.gauges[0] = { ...b.gauges[0], mode: 'farm', farmPerMin: 1300 };
    const sim = initSim(b);
    stepSim(b, sim, 20 * 60);
    // 1300 in a minute, minus the ingots the press gauge requested (2 per request)
    const used = sim.packages.length * 2;
    expect(sim.stock['minecraft:iron_ingot']).toBeCloseTo(1300 - used, 6);
    expect(gaugeStatus(sim, b.gauges[0]).state).toBe('satisfied');
  });

  it('can stop the farm once the target is reached', () => {
    const b = emptyBoard();
    b.gauges = [{ ...newGauge(0, 0, 1), id: 'cobble', item: 'minecraft:cobblestone', mode: 'farm', farmPerMin: 1300, amount: 100, farmStopsAtTarget: true }];
    const sim = initSim(b);
    stepSim(b, sim, 20 * 60);
    expect(sim.stock['minecraft:cobblestone']).toBeLessThan(102);
    expect(sim.stock['minecraft:cobblestone']).toBeGreaterThanOrEqual(100);
  });
});

describe('helpers', () => {
  it('matches addresses with * wildcards, ignoring case', () => {
    expect(matchAddress('Four*', 'four-1')).toBe(true);
    expect(matchAddress('presse', 'Presse')).toBe(true);
    expect(matchAddress('presse', 'pressoir')).toBe(false);
  });
  it('packs 9 stacks per package', () => {
    expect(packStacks([{ item: 'a', count: 640 }]).map((p) => p.length)).toEqual([9, 1]);
  });
  it('manual sends take items from the network', () => {
    const b = pressBoard();
    const sim = initSim(b);
    expect(sendManual(b, sim, 'presse', [{ item: 'minecraft:iron_ingot', count: 10 }])).toBeNull();
    expect(sim.stock['minecraft:iron_ingot']).toBe(90);
    expect(sendManual(b, sim, 'presse', [{ item: 'minecraft:iron_ingot', count: 500 }])).toMatch(/insuffisant/);
  });
});
