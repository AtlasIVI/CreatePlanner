// Worked examples pinned against the Create 6 (mc1.21.1/dev) source, see data/machines/create.json.
import { describe, expect, it } from 'vitest';
import { machineFiles } from '../data/machineFiles';
import {
  executionsPerSecond,
  sourceOutput,
  stressPerMachine,
  suggestSources,
  ticksPerOperation,
} from './machines';
import type { KineticSourceDef, MachineDef } from './types';

const machines = new Map<string, MachineDef>(machineFiles.flatMap((f) => f.machines ?? []).map((m) => [m.id, m]));
const sources = new Map<string, KineticSourceDef>(machineFiles.flatMap((f) => f.sources ?? []).map((s) => [s.id, s]));
const M = (id: string) => machines.get(id)!;
const S = (id: string) => sources.get(id)!;

describe('mechanical press', () => {
  // advance = floor(lerp(rpm/512, 1, 60)); ticks = ceil(120/adv) + floor(120/adv) + 2
  it.each([
    [16, 122], // adv 2
    [64, 32], // adv 8
    [256, 10], // adv 30
  ])('%i RPM -> %i ticks per press', (rpm, ticks) => {
    expect(ticksPerOperation(M('create:mechanical_press'), { rpm })).toBe(ticks);
  });

  it('turns ticks into items per second', () => {
    expect(executionsPerSecond(M('create:mechanical_press'), { rpm: 64 })).toBeCloseTo(20 / 32, 10);
  });

  it('stress = 8 SU/RPM', () => {
    expect(stressPerMachine(M('create:mechanical_press'), { rpm: 64 })).toBe(512);
  });
});

describe('mechanical mixer', () => {
  // ticks = 15 * ilog2(floor(512/rpm)) + 1 + 1 (steady state)
  it.each([
    [30, 62],
    [32, 62],
    [64, 47],
    [128, 32],
    [256, 17],
  ])('%i RPM -> %i ticks per batch', (rpm, ticks) => {
    expect(ticksPerOperation(M('create:mechanical_mixer'), { rpm })).toBe(ticks);
  });

  it('scales with the recipe processing time', () => {
    // duration 200 -> ceil(2 * 15) = 30 per log2 step: 30 * 3 + 2
    expect(ticksPerOperation(M('create:mechanical_mixer'), { rpm: 64, duration: 200 })).toBe(92);
  });

  it('does not run below 30 RPM', () => {
    expect(executionsPerSecond(M('create:mechanical_mixer'), { rpm: 29 })).toBe(0);
  });
});

describe('millstone', () => {
  it('32 RPM, default duration 100 -> 51 ticks', () => {
    expect(ticksPerOperation(M('create:millstone'), { rpm: 32 })).toBe(51);
  });
  it('32 RPM, wheat (150) -> 76 ticks', () => {
    expect(ticksPerOperation(M('create:millstone'), { rpm: 32, duration: 150 })).toBe(76);
  });
  it('speed factor is an integer (24 RPM behaves like 16)', () => {
    expect(ticksPerOperation(M('create:millstone'), { rpm: 24 })).toBe(101);
  });
});

describe('crushing wheels', () => {
  it('single item at 256 RPM, raw iron (400) -> 21 ticks', () => {
    expect(ticksPerOperation(M('create:crushing_wheels'), { rpm: 256, duration: 400, batch: 1 })).toBe(21);
  });
  it('a stack of 64 is processed at once (113 ticks at 256 RPM)', () => {
    const m = M('create:crushing_wheels');
    expect(ticksPerOperation(m, { rpm: 256, duration: 400, batch: 64 })).toBe(113);
    expect(executionsPerSecond(m, { rpm: 256, duration: 400, batch: 64 })).toBeCloseTo((20 * 64) / 113, 10);
  });
  it('a pair costs 2 x 8 SU/RPM', () => {
    expect(stressPerMachine(M('create:crushing_wheels'), { rpm: 64 })).toBe(1024);
  });
});

describe('other machines', () => {
  it('deployer at 16 RPM -> 83 ticks', () => {
    expect(ticksPerOperation(M('create:deployer'), { rpm: 16 })).toBe(83);
  });
  it('saw at 64 RPM, default duration 50 -> 25 ticks', () => {
    expect(ticksPerOperation(M('create:mechanical_saw'), { rpm: 64 })).toBe(25);
  });
  it('spout: 20 ticks, no stress', () => {
    expect(ticksPerOperation(M('create:spout'), { rpm: 0 })).toBe(20);
    expect(executionsPerSecond(M('create:spout'), { rpm: 0 })).toBe(1);
  });
  it('fan: 151 ticks per stack of up to 16', () => {
    expect(ticksPerOperation(M('create:fan_washing'), { rpm: 64, batch: 16 })).toBe(151);
    expect(ticksPerOperation(M('create:fan_washing'), { rpm: 64, batch: 17 })).toBe(301);
  });
  it('furnace uses the recipe cooking time', () => {
    expect(executionsPerSecond(M('minecraft:furnace'), { rpm: 0 })).toBeCloseTo(0.1, 10);
  });
});

describe('kinetic sources', () => {
  it('water wheel: 8 RPM, 256 SU', () => {
    expect(sourceOutput(S('create:water_wheel'))).toMatchObject({ rpm: 8, capacity: 256 });
  });
  it('large water wheel: 4 RPM, 512 SU', () => {
    expect(sourceOutput(S('create:large_water_wheel'))).toMatchObject({ rpm: 4, capacity: 512 });
  });
  it('windmill: 1 RPM per 8 sails, max 16, 512 SU/RPM', () => {
    expect(sourceOutput(S('create:windmill_bearing'), { sails: 64 })).toMatchObject({ rpm: 8, capacity: 4096 });
    expect(sourceOutput(S('create:windmill_bearing'), { sails: 200 })).toMatchObject({ rpm: 16, capacity: 8192 });
  });
  it('steam engine: passive 16 RPM / 2048 SU, active 64 RPM / 16384 SU per engine', () => {
    expect(sourceOutput(S('create:steam_engine'), { engines: 1, boilerLevel: 0 })).toMatchObject({ rpm: 16, capacity: 2048 });
    expect(sourceOutput(S('create:steam_engine'), { engines: 1, boilerLevel: 1 })).toMatchObject({ rpm: 64, capacity: 16384 });
    expect(sourceOutput(S('create:steam_engine'), { engines: 4, boilerLevel: 4 })).toMatchObject({ rpm: 64, capacity: 65536 });
    // 4 engines on a level-2 boiler: efficiency 0.5 -> speed modifier 3 (48 RPM), 4*0.5*16384 SU
    expect(sourceOutput(S('create:steam_engine'), { engines: 4, boilerLevel: 2 })).toMatchObject({ rpm: 48, capacity: 32768 });
  });
  it('hand crank 256 SU, creative motor 16384 SU/RPM', () => {
    expect(sourceOutput(S('create:hand_crank'))).toMatchObject({ rpm: 32, capacity: 256 });
    expect(sourceOutput(S('create:creative_motor'), { speed: 256 }).capacity).toBe(16384 * 256);
  });
  it('suggests the fewest sources first', () => {
    const list = suggestSources([S('create:water_wheel'), S('create:hand_crank')], 1000);
    expect(list.map((s) => s.count)).toEqual([4, 4]);
  });
});
