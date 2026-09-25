import { describe, expect, it } from 'vitest';
import { machineFiles } from '../data/machineFiles';
import { seedMods } from '../data/seed';
import { plan } from './calculator';
import { analyzeGrid, cellKey } from './grid';
import { emptyProject, type Facing, type GridState, type PlacedBlock } from './project';
import { buildDataSet } from './registry';

const ds = buildDataSet(seedMods, machineFiles);

function grid(blocks: [number, number, number, string, Facing, Partial<PlacedBlock>?][]): GridState {
  const g = emptyProject().grid;
  for (const [x, y, z, block, facing, extra] of blocks) g.cells[cellKey(x, y, z)] = { block, facing, ...extra };
  return g;
}

const motor = (x: number, y: number, z: number, facing: Facing, speed: number, reversed = false) =>
  [x, y, z, 'create:creative_motor', facing, { params: { speed }, reversed }] as [number, number, number, string, Facing, Partial<PlacedBlock>];

describe('press line on the grid matches the calculator', () => {
  // motor -> shaft -> press -> shaft -> press, all along x
  const g = grid([
    motor(0, 0, 0, '+x', 64),
    [1, 0, 0, 'create:shaft', '+x'],
    [2, 0, 0, 'create:mechanical_press', '+x'],
    [3, 0, 0, 'create:shaft', '+x'],
    [4, 0, 0, 'create:mechanical_press', '+x'],
  ]);
  const a = analyzeGrid(ds, g);

  it('propagates the motor speed along shafts and through presses', () => {
    expect(a.networks).toHaveLength(1);
    expect(a.speed.get('4,0,0')).toBe(64);
    expect(a.networks[0].conflicts).toEqual([]);
  });

  it('stress equals the calculator for 2 presses at 64 RPM', () => {
    const p = plan(ds, { target: 'create:iron_sheet', rate: 1, rpm: 64 });
    expect(a.networks[0].load).toBe(p.totalStress);
    expect(a.networks[0].load).toBe(1024);
    expect(a.networks[0].capacity).toBe(16384 * 64);
  });

  it('reports machine throughput at the inferred speed', () => {
    const presses = a.machines.filter((m) => m.machine.id === 'create:mechanical_press');
    expect(presses).toHaveLength(2);
    expect(presses.reduce((s, m) => s + m.perSecond, 0)).toBeCloseTo(2 * (20 / 32), 10);
  });
});

describe('gear ratios', () => {
  it('large cog -> small cog doubles the speed and reverses it', () => {
    const a = analyzeGrid(
      ds,
      grid([
        motor(-1, 0, 0, '+x', 32),
        [0, 0, 0, 'create:large_cogwheel', '+x'],
        [0, 1, 1, 'create:cogwheel', '+x'],
      ]),
    );
    expect(a.speed.get('0,0,0')).toBe(32);
    expect(a.speed.get('0,1,1')).toBe(-64);
  });

  it('small cog -> large cog halves the speed', () => {
    const a = analyzeGrid(
      ds,
      grid([
        motor(0, -1, 0, '+y', 64),
        [0, 0, 0, 'create:cogwheel', '+y'],
        [1, 0, 1, 'create:large_cogwheel', '+y'],
      ]),
    );
    expect(a.speed.get('1,0,1')).toBe(-32);
  });

  it('meshing small cogs reverse; a cog drives a mixer (a cog itself)', () => {
    const a = analyzeGrid(
      ds,
      grid([
        motor(0, -1, 0, '+y', 64),
        [0, 0, 0, 'create:cogwheel', '+y'],
        [1, 0, 0, 'create:cogwheel', '+y'],
        [2, 0, 0, 'create:mechanical_mixer', '+y'],
      ]),
    );
    expect(a.speed.get('1,0,0')).toBe(-64);
    expect(a.speed.get('2,0,0')).toBe(64);
    expect(a.networks[0].load).toBe(4 * 64);
  });

  it('gearbox: the straight-through side reverses, side outputs follow the axis rule', () => {
    const a = analyzeGrid(
      ds,
      grid([
        motor(-2, 0, 0, '+x', 32),
        [-1, 0, 0, 'create:shaft', '+x'],
        [0, 0, 0, 'create:gearbox', '+y'],
        [1, 0, 0, 'create:shaft', '+x'],
        [0, 0, 1, 'create:shaft', '+z'],
        [0, 0, -1, 'create:shaft', '+z'],
      ]),
    );
    // source facing = -x (towards the motor)
    expect(a.speed.get('1,0,0')).toBe(-32); // +x: same axis, not the source side
    expect(a.speed.get('0,0,1')).toBe(32); // +z: sign differs from -x
    expect(a.speed.get('0,0,-1')).toBe(-32); // -z: same sign as -x
  });
});

describe('conflicts and stress', () => {
  it('flags two sources turning a shaft in opposite directions', () => {
    const a = analyzeGrid(
      ds,
      grid([motor(0, 0, 0, '+x', 64), [1, 0, 0, 'create:shaft', '+x'], motor(2, 0, 0, '-x', 64, true)]),
    );
    expect(a.networks[0].conflicts.map((c) => c.kind)).toContain('sources');
  });

  it('flags opposite directions meeting (belt joining the shafts of two meshed cogs)', () => {
    // Meshed cogs turn opposite ways; a belt forces both shafts to turn the same way.
    const a = analyzeGrid(
      ds,
      grid([
        motor(0, 0, -1, '+z', 32),
        [0, 0, 0, 'create:cogwheel', '+z'],
        [1, 0, 0, 'create:cogwheel', '+z'],
        [0, 0, 1, 'create:shaft', '+z'],
        [1, 0, 1, 'create:shaft', '+z'],
        [0, 0, 2, 'create:belt', '+x'],
        [1, 0, 2, 'create:belt', '+x'],
      ]),
    );
    expect(a.networks[0].conflicts.map((c) => c.kind)).toContain('direction');
  });

  it('a gearbox loop is consistent (no false conflict)', () => {
    const a = analyzeGrid(
      ds,
      grid([
        motor(0, 0, -1, '+z', 32),
        [0, 0, 0, 'create:cogwheel', '+z'],
        [1, 0, 0, 'create:cogwheel', '+z'],
        [0, 0, 1, 'create:shaft', '+z'],
        [1, 0, 1, 'create:shaft', '+z'],
        [0, 0, 2, 'create:gearbox', '+y'],
        [1, 0, 2, 'create:gearbox', '+y'],
      ]),
    );
    expect(a.networks[0].conflicts).toEqual([]);
  });

  it('marks an overstressed network and stops its machines', () => {
    const a = analyzeGrid(
      ds,
      grid([
        [0, 0, 0, 'create:hand_crank', '+x'],
        [1, 0, 0, 'create:mechanical_press', '+x'],
        [2, 0, 0, 'create:mechanical_press', '+x'],
      ]),
    );
    const n = a.networks[0];
    expect(n.load).toBe(2 * 8 * 32);
    expect(n.capacity).toBe(256);
    expect(n.overstressed).toBe(true);
    expect(a.machines.every((m) => m.perSecond === 0)).toBe(true);
  });

  it('flags speeds above the 256 RPM limit', () => {
    const a = analyzeGrid(
      ds,
      grid([
        motor(-1, 0, 0, '+x', 256),
        [0, 0, 0, 'create:large_cogwheel', '+x'],
        [0, 1, 1, 'create:cogwheel', '+x'],
      ]),
    );
    expect(a.networks[0].conflicts.map((c) => c.kind)).toContain('overspeed');
  });

  it('belts carry rotation between two shafts', () => {
    const a = analyzeGrid(
      ds,
      grid([
        motor(0, 0, -1, '+z', 64),
        [0, 0, 0, 'create:belt', '+x'],
        [1, 0, 0, 'create:belt', '+x'],
        [2, 0, 0, 'create:belt', '+x'],
        [2, 0, 1, 'create:shaft', '+z'],
      ]),
    );
    expect(a.speed.get('2,0,1')).toBe(64);
    expect(a.networks[0].load).toBe(0);
  });
});
