// Kinetic network inference for blocks placed on the grid. Connection rules follow
// Create's RotationPropagator (mc1.21.1/dev): shafts along an axis keep the speed,
// meshing small cogs reverse it, large <-> small cogs double / halve it with a reversal,
// gearboxes reverse depending on the side the power comes from.

import { executionsPerSecond, sourceOutput } from './machines';
import type { Facing, GridState, PlacedBlock } from './project';
import type { DataSet } from './registry';
import type { Axis, Id, KineticShape, KineticSourceDef, MachineDef, Recipe } from './types';

export type Vec = [number, number, number];

export const FACINGS: Facing[] = ['+x', '+z', '-x', '-z', '+y', '-y'];
const AXES: Axis[] = ['x', 'y', 'z'];

export function facingVec(f: Facing): Vec {
  const s = f[0] === '+' ? 1 : -1;
  return f[1] === 'x' ? [s, 0, 0] : f[1] === 'y' ? [0, s, 0] : [0, 0, s];
}

export const axisOf = (f: Facing): Axis => f[1] as Axis;
const comp = (v: Vec, a: Axis) => (a === 'x' ? v[0] : a === 'y' ? v[1] : v[2]);
const key = (v: Vec) => `${v[0]},${v[1]},${v[2]}`;
export const parseKey = (k: string): Vec => k.split(',').map(Number) as Vec;
const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const neg = (v: Vec): Vec => [-v[0], -v[1], -v[2]];
const DIRS: Vec[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];
const dirAxis = (d: Vec): Axis => (d[0] ? 'x' : d[1] ? 'y' : 'z');
const dirSign = (d: Vec) => d[0] + d[1] + d[2];
const sameVec = (a: Vec, b: Vec) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

export interface KineticSpec {
  block: Id;
  shape: KineticShape;
  /** Fixed axis for blocks that cannot rotate (mixer, millstone). */
  fixedAxis?: Axis;
  cogShaftFaces?: ('+' | '-')[];
  /** SU per RPM for one placed block. */
  impact: number;
  machine?: MachineDef;
  source?: KineticSourceDef;
}

export function kineticSpec(ds: DataSet, block: Id): KineticSpec | undefined {
  const source = ds.sources.find((s) => s.gridBlock === block);
  if (source) return { block, shape: source.shape ?? 'shaft', impact: 0, source };
  const machine = ds.machines.find((m) => m.gridBlock === block);
  if (machine)
    return {
      block,
      shape: machine.shape ?? 'none',
      fixedAxis: machine.axis,
      cogShaftFaces: machine.cogShaftFaces,
      impact: machine.kinetic ? machine.stressImpact.value : 0,
      machine,
    };
  const p = ds.placeables.find((x) => x.id === block);
  if (p) return { block, shape: p.shape, impact: p.stressImpact?.value ?? 0 };
  return undefined;
}

/** Placeable blocks: kinetic parts, machines, sources and logistics blocks. */
export function palette(ds: DataSet): { id: Id; spec: KineticSpec; category: 'kinetic' | 'machine' | 'source' | 'logistics' | 'other' }[] {
  const seen = new Set<Id>();
  const out: ReturnType<typeof palette> = [];
  const push = (id: Id, category: ReturnType<typeof palette>[number]['category']) => {
    if (seen.has(id)) return;
    const spec = kineticSpec(ds, id);
    if (!spec) return;
    seen.add(id);
    out.push({ id, spec, category });
  };
  for (const p of ds.placeables) push(p.id, p.category === 'kinetic' ? 'kinetic' : p.category === 'logistics' ? 'logistics' : 'other');
  for (const m of ds.machines) if (m.gridBlock) push(m.gridBlock, 'machine');
  for (const s of ds.sources) if (s.gridBlock) push(s.gridBlock, 'source');
  return out;
}

interface Node {
  key: string;
  pos: Vec;
  placed: PlacedBlock;
  spec: KineticSpec;
  axis: Axis;
}

function rotationAxis(n: { spec: KineticSpec; placed: PlacedBlock }): Axis {
  if (n.spec.fixedAxis) return n.spec.fixedAxis;
  const a = axisOf(n.placed.facing);
  // A belt's pulleys turn around the horizontal axis perpendicular to its travel direction.
  if (n.spec.shape === 'belt') return a === 'x' ? 'z' : 'x';
  return a;
}

const isSmallCog = (n: Node) => n.spec.shape === 'cog';
const isLargeCog = (n: Node) => n.spec.shape === 'large_cog';

export function hasShaftTowards(n: Node, d: Vec): boolean {
  const da = dirAxis(d);
  switch (n.spec.shape) {
    case 'shaft':
    case 'large_cog':
      return da === n.axis;
    case 'belt':
      return da === n.axis;
    case 'half_shaft':
      return sameVec(d, facingVec(n.placed.facing));
    case 'cog': {
      if (da !== n.axis) return false;
      const faces = n.spec.cogShaftFaces ?? ['+', '-'];
      return faces.includes(dirSign(d) > 0 ? '+' : '-');
    }
    case 'gearbox':
      return da !== n.axis;
    default:
      return false;
  }
}

/** Create's getAxisModifier: only gearboxes (with a known power side) change the sign. */
function axisModifier(n: Node, d: Vec, sourceFacing: Map<string, Vec>): number {
  if (n.spec.shape !== 'gearbox') return 1;
  const src = sourceFacing.get(n.key);
  if (!src) return 1;
  if (dirAxis(d) === dirAxis(src)) return sameVec(d, src) ? 1 : -1;
  return Math.sign(dirSign(d)) === Math.sign(dirSign(src)) ? -1 : 1;
}

/** Speed ratio from a to b, or 0 when they are not connected. */
function ratio(a: Node, b: Node, sourceFacing: Map<string, Vec>): number {
  const diff: Vec = [b.pos[0] - a.pos[0], b.pos[1] - a.pos[1], b.pos[2] - a.pos[2]];
  const manhattan = Math.abs(diff[0]) + Math.abs(diff[1]) + Math.abs(diff[2]);
  if (manhattan === 1) {
    if (hasShaftTowards(a, diff) && hasShaftTowards(b, neg(diff))) {
      const mb = axisModifier(b, neg(diff), sourceFacing);
      return axisModifier(a, diff, sourceFacing) * (mb !== 0 ? 1 / mb : 0);
    }
    // Belt segments in a line share their speed.
    if (a.spec.shape === 'belt' && b.spec.shape === 'belt' && a.axis === b.axis && dirAxis(diff) !== a.axis) return 1;
  }
  // Large <-> large at a right angle
  if (isLargeCog(a) && isLargeCog(b) && a.axis !== b.axis) {
    const ok = AXES.every((ax) => (ax === a.axis || ax === b.axis ? comp(diff, ax) !== 0 : comp(diff, ax) === 0));
    if (ok) return comp(diff, a.axis) > 0 !== comp(diff, b.axis) > 0 ? -1 : 1;
  }
  const largeToSmall = (l: Node, s: Node, d: Vec) =>
    l.axis === s.axis && comp(d, l.axis) === 0 && AXES.every((ax) => ax === l.axis || Math.abs(comp(d, ax)) === 1);
  if (isLargeCog(a) && isSmallCog(b) && largeToSmall(a, b, diff)) return -2;
  if (isLargeCog(b) && isSmallCog(a) && largeToSmall(b, a, neg(diff))) return -0.5;
  if (isSmallCog(a) && isSmallCog(b) && manhattan === 1 && dirAxis(diff) !== a.axis && a.axis === b.axis) return -1;
  return 0;
}

export type ConflictKind = 'direction' | 'speed' | 'sources' | 'overspeed';

export interface Conflict {
  kind: ConflictKind;
  at: string;
  expected: number;
  got: number;
}

export interface GridMachine {
  key: string;
  machine: MachineDef;
  rpm: number;
  recipe?: Recipe;
  /** Recipe executions per second of this block's share of the machine. */
  perSecond: number;
  stress: number;
}

export interface Network {
  id: number;
  keys: string[];
  sources: string[];
  load: number;
  capacity: number;
  overstressed: boolean;
  conflicts: Conflict[];
  /** Absolute speeds seen in the network. */
  rpms: number[];
}

export interface GridAnalysis {
  networks: Network[];
  networkOf: Map<string, number>;
  /** Signed speed of every kinetic block (0 when not driven). */
  speed: Map<string, number>;
  machines: GridMachine[];
  maxRpm: number;
}

const EPS = 1e-6;

export function analyzeGrid(ds: DataSet, grid: GridState): GridAnalysis {
  const nodes = new Map<string, Node>();
  for (const [k, placed] of Object.entries(grid.cells)) {
    const spec = kineticSpec(ds, placed.block);
    if (!spec || spec.shape === 'none') continue;
    const n: Node = { key: k, pos: parseKey(k), placed, spec, axis: 'x' };
    n.axis = rotationAxis(n);
    nodes.set(k, n);
  }
  // Candidate neighbours: face neighbours plus in-plane diagonals (gears).
  const neighbours = (n: Node): Node[] => {
    const out: Node[] = [];
    for (const d of DIRS) {
      const m = nodes.get(key(add(n.pos, d)));
      if (m) out.push(m);
    }
    if (isLargeCog(n) || isSmallCog(n)) {
      for (const dx of [-1, 0, 1])
        for (const dy of [-1, 0, 1])
          for (const dz of [-1, 0, 1]) {
            const nz = [dx, dy, dz].filter((v) => v !== 0).length;
            if (nz !== 2) continue;
            const m = nodes.get(key(add(n.pos, [dx, dy, dz])));
            if (m && (isLargeCog(m) || isSmallCog(m))) out.push(m);
          }
    }
    return out;
  };

  const maxRpm = ds.maxRpm.value;
  const speed = new Map<string, number>();
  const networkOf = new Map<string, number>();
  const sourceFacing = new Map<string, Vec>();
  const networks: Network[] = [];
  const order = [...nodes.values()].sort((a, b) => Number(!!b.spec.source) - Number(!!a.spec.source));

  for (const start of order) {
    if (networkOf.has(start.key)) continue;
    const id = networks.length;
    const net: Network = { id, keys: [], sources: [], load: 0, capacity: 0, overstressed: false, conflicts: [], rpms: [] };
    networks.push(net);
    const generated = (n: Node) => {
      if (!n.spec.source) return 0;
      const out = sourceOutput(n.spec.source, n.placed.params);
      return (n.placed.reversed ? -1 : 1) * out.rpm;
    };
    speed.set(start.key, generated(start));
    const queue = [start];
    networkOf.set(start.key, id);
    while (queue.length) {
      const a = queue.shift()!;
      net.keys.push(a.key);
      const sa = speed.get(a.key)!;
      for (const b of neighbours(a)) {
        const r = ratio(a, b, sourceFacing);
        if (r === 0) continue;
        if (!networkOf.has(b.key)) {
          networkOf.set(b.key, id);
          if (b.spec.shape === 'gearbox') sourceFacing.set(b.key, neg(dirVec(a.pos, b.pos)));
          const sb = sa * ratio(a, b, sourceFacing);
          speed.set(b.key, sb);
          if (b.spec.source && sa !== 0) {
            const g = generated(b);
            if (Math.abs(g - sb) > EPS) net.conflicts.push({ kind: 'sources', at: b.key, expected: sb, got: g });
          }
          queue.push(b);
        } else if (networkOf.get(b.key) === id) {
          const expected = sa * r;
          const got = speed.get(b.key)!;
          if (Math.abs(expected - got) > EPS && !net.conflicts.some((c) => c.at === b.key || c.at === a.key)) {
            const kind: ConflictKind = Math.abs(Math.abs(expected) - Math.abs(got)) < EPS ? 'direction' : 'speed';
            net.conflicts.push({ kind, at: b.key, expected, got });
          }
        }
      }
    }
    // A network driven by several sources needs them all to agree; the first one sets the pace.
    for (const k of net.keys) {
      const n = nodes.get(k)!;
      const s = Math.abs(speed.get(k) ?? 0);
      if (n.spec.source) {
        net.sources.push(k);
        net.capacity += sourceOutput(n.spec.source, n.placed.params).capacity;
      }
      net.load += n.spec.impact * s;
      if (s > maxRpm + EPS) net.conflicts.push({ kind: 'overspeed', at: k, expected: maxRpm, got: s });
      if (!net.rpms.some((r) => Math.abs(r - s) < EPS)) net.rpms.push(s);
    }
    net.rpms.sort((x, y) => x - y);
    net.overstressed = net.sources.length > 0 && net.load > net.capacity + EPS;
  }

  const machines: GridMachine[] = [];
  for (const [k, placed] of Object.entries(grid.cells)) {
    const spec = kineticSpec(ds, placed.block);
    if (!spec?.machine) continue;
    const m = spec.machine;
    const net = networks[networkOf.get(k) ?? -1];
    const rpm = Math.abs(speed.get(k) ?? 0);
    const running = !m.kinetic || (net && !net.overstressed && net.conflicts.length === 0 && rpm > 0);
    const recipe = placed.recipe ? ds.recipeById.get(placed.recipe) : undefined;
    const units = m.unitsPerMachine ? Math.max(1, Number(m.unitsPerMachine) || 1) : 1;
    const perMachine = running ? executionsPerSecond(m, { rpm, duration: recipe?.duration, cells: recipe?.cells }) : 0;
    machines.push({ key: k, machine: m, rpm, recipe, perSecond: perMachine / units, stress: spec.impact * rpm });
  }
  return { networks, networkOf, speed, machines, maxRpm };
}

function dirVec(from: Vec, to: Vec): Vec {
  return [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
}

export function cellKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

/** Next facing when rotating; blocks with a fixed axis keep it. */
export function rotateFacing(f: Facing, spec?: KineticSpec): Facing {
  if (spec?.fixedAxis) return spec.fixedAxis === 'y' ? '+y' : (`+${spec.fixedAxis}` as Facing);
  return FACINGS[(FACINGS.indexOf(f) + 1) % FACINGS.length];
}
