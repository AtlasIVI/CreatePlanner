// Logistics model for Create 6 factory gauges: throughput limits per module and link,
// bottleneck detection, and a coarse stock simulation over time.

import type { GaugeModule, LinkKind } from './project';
import type { Id, LogisticsConstant } from './types';

export interface LogisticsConstants {
  gaugeTimer: number;
  packagerCycle: number;
  packageSlots: number;
  chainCapacity: number;
  chainSpeedDivisor: number;
  chainSpacing: number;
  frogportCycle: number;
  beltSpeedDivisor: number;
  beltSpacing: number;
}

/** Fallbacks match data/machines/create.json; the app always passes the data values. */
export const DEFAULT_CONSTANTS: LogisticsConstants = {
  gaugeTimer: 100,
  packagerCycle: 20,
  packageSlots: 9,
  chainCapacity: 20,
  chainSpeedDivisor: 360,
  chainSpacing: 1,
  frogportCycle: 20,
  beltSpeedDivisor: 480,
  beltSpacing: 1,
};

export function constantsFrom(data: Record<string, LogisticsConstant>): LogisticsConstants {
  const v = (k: string, d: number) => data[k]?.value ?? d;
  return {
    gaugeTimer: v('factoryGaugeTimer', DEFAULT_CONSTANTS.gaugeTimer),
    packagerCycle: v('packagerCycle', DEFAULT_CONSTANTS.packagerCycle),
    packageSlots: v('packageSlots', DEFAULT_CONSTANTS.packageSlots),
    chainCapacity: v('chainConveyorCapacity', DEFAULT_CONSTANTS.chainCapacity),
    chainSpeedDivisor: v('chainSpeedDivisor', DEFAULT_CONSTANTS.chainSpeedDivisor),
    chainSpacing: v('chainPackageSpacing', DEFAULT_CONSTANTS.chainSpacing),
    frogportCycle: v('frogportCycle', DEFAULT_CONSTANTS.frogportCycle),
    beltSpeedDivisor: v('beltSpeedDivisor', DEFAULT_CONSTANTS.beltSpeedDivisor),
    beltSpacing: v('beltItemSpacing', DEFAULT_CONSTANTS.beltSpacing),
  };
}

export type Limit = 'gauge' | 'machines' | 'packager' | 'link' | 'inputs' | 'stock' | 'none';

export type Issue =
  | 'no-output'
  | 'no-address'
  | 'no-machine-rate'
  | 'target-below-batch'
  | 'cycle'
  | 'missing-upstream'
  | 'upstream-item-mismatch';

export interface ModuleAnalysis {
  id: string;
  /** Output items/s this module must deliver (external demand + downstream needs). */
  required: number;
  /** Output items/s each constraint allows. */
  caps: Record<Exclude<Limit, 'none'>, number>;
  achievable: number;
  limitedBy: Limit;
  bottleneck: boolean;
  requestsPerSecond: number;
  packagesPerRequest: number;
  /** Seconds from request to delivery of the output batch. */
  leadTime: number;
  issues: Issue[];
}

export interface LogisticsAnalysis {
  modules: ModuleAnalysis[];
  byId: Map<string, ModuleAnalysis>;
  /** Most upstream module whose capacity is below what is required. */
  bottleneck?: string;
  order: string[];
}

const TICKS = 20;
const EPS = 1e-9;

/** Seconds between two requests of a recipe-mode gauge. */
export function gaugeInterval(c: LogisticsConstants): number {
  return (c.gaugeTimer + 1) / TICKS;
}

export function packagesPerRequest(m: GaugeModule, stackSize: (id: Id) => number, c: LogisticsConstants): number {
  const lines = m.mode === 'restock' ? (m.output ? [{ item: m.output, amount: m.outputPerRequest }] : []) : m.inputs;
  const stacks = lines.reduce((s, i) => s + Math.ceil(i.amount / Math.max(1, stackSize(i.item))), 0);
  return Math.max(1, Math.ceil(stacks / c.packageSlots));
}

/** Packages per second a link can carry into a module. */
export function linkPackagesPerSecond(kind: LinkKind, link: GaugeModule['link'], c: LogisticsConstants): number {
  switch (kind) {
    case 'direct':
      return Infinity;
    case 'chain': {
      const blocksPerSecond = (Math.abs(link.rpm) / c.chainSpeedDivisor) * TICKS;
      if (blocksPerSecond <= 0) return 0;
      const passing = blocksPerSecond / c.chainSpacing;
      const byCapacity = link.length > 0 ? (c.chainCapacity * blocksPerSecond) / link.length : Infinity;
      return Math.min(passing, byCapacity);
    }
    case 'belt': {
      const blocksPerSecond = (Math.abs(link.rpm) / c.beltSpeedDivisor) * TICKS;
      return blocksPerSecond / c.beltSpacing;
    }
    case 'frogport':
      return (Math.max(0, link.frogports) * TICKS) / c.frogportCycle;
  }
}

export function linkTransitSeconds(link: GaugeModule['link'], c: LogisticsConstants): number {
  if (link.kind === 'chain') return link.rpm ? link.length / ((Math.abs(link.rpm) / c.chainSpeedDivisor) * TICKS) : Infinity;
  if (link.kind === 'belt') return link.rpm ? link.length / ((Math.abs(link.rpm) / c.beltSpeedDivisor) * TICKS) : Infinity;
  if (link.kind === 'frogport') return c.frogportCycle / TICKS;
  return 0;
}

/** Topological order upstream -> downstream; modules in a cycle are returned in `cyclic`. */
export function moduleOrder(modules: GaugeModule[]): { order: string[]; cyclic: Set<string> } {
  const ids = new Set(modules.map((m) => m.id));
  const indeg = new Map(modules.map((m) => [m.id, 0]));
  const next = new Map<string, string[]>();
  for (const m of modules)
    for (const i of m.inputs) {
      if (!i.from || !ids.has(i.from)) continue;
      indeg.set(m.id, (indeg.get(m.id) ?? 0) + 1);
      next.set(i.from, [...(next.get(i.from) ?? []), m.id]);
    }
  const queue = modules.filter((m) => indeg.get(m.id) === 0).map((m) => m.id);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const n of next.get(id) ?? []) {
      indeg.set(n, indeg.get(n)! - 1);
      if (indeg.get(n) === 0) queue.push(n);
    }
  }
  const cyclic = new Set(modules.map((m) => m.id).filter((id) => !order.includes(id)));
  return { order: [...order, ...cyclic], cyclic };
}

export function analyzeLogistics(
  modules: GaugeModule[],
  c: LogisticsConstants,
  stackSize: (id: Id) => number = () => 64,
): LogisticsAnalysis {
  const byModule = new Map(modules.map((m) => [m.id, m]));
  const { order, cyclic } = moduleOrder(modules);

  // Backward pass: required output rate = external demand + what downstream modules consume.
  const required = new Map<string, number>(modules.map((m) => [m.id, Math.max(0, m.demand)]));
  for (const id of [...order].reverse()) {
    const m = byModule.get(id)!;
    const out = Math.max(EPS, m.outputPerRequest);
    const requests = required.get(id)! / out;
    for (const i of m.inputs) {
      if (!i.from || !byModule.has(i.from)) continue;
      required.set(i.from, (required.get(i.from) ?? 0) + requests * i.amount);
    }
  }

  // Forward pass: what each module can actually deliver.
  const achievable = new Map<string, number>();
  const result: ModuleAnalysis[] = [];
  for (const id of order) {
    const m = byModule.get(id)!;
    const issues: Issue[] = [];
    if (!m.output) issues.push('no-output');
    if (m.mode === 'recipe' && !m.address.trim()) issues.push('no-address');
    if (m.mode === 'recipe' && !(m.machineRate > 0)) issues.push('no-machine-rate');
    if (m.targetStock < m.outputPerRequest) issues.push('target-below-batch');
    if (cyclic.has(id)) issues.push('cycle');
    const out = Math.max(EPS, m.outputPerRequest);
    const ppr = packagesPerRequest(m, stackSize, c);
    const interval = gaugeInterval(c);
    const gauge = m.mode === 'recipe' && !m.address.trim() ? 0 : out / interval;
    const packager = (out * TICKS) / ((c.packagerCycle + 1) * ppr);
    const lpps = linkPackagesPerSecond(m.link.kind, m.link, c);
    const link = (out * lpps) / ppr;
    const machines = m.mode === 'restock' || !(m.machineRate > 0) ? Infinity : m.machineRate;
    let inputs = Infinity;
    for (const i of m.inputs) {
      if (!i.from) continue;
      const up = byModule.get(i.from);
      if (!up) {
        issues.push('missing-upstream');
        inputs = 0;
        continue;
      }
      if (up.output && up.output !== i.item) issues.push('upstream-item-mismatch');
      const upAvail = achievable.get(i.from) ?? 0;
      const upReq = required.get(i.from) ?? 0;
      const need = (required.get(id)! / out) * i.amount;
      const share = upReq > EPS ? upAvail * (need / upReq) : upAvail;
      inputs = Math.min(inputs, i.amount > 0 ? (share / i.amount) * out : Infinity);
    }
    const leadTime = linkTransitSeconds(m.link, c) + (Number.isFinite(machines) ? out / machines : 0) + ppr * ((c.packagerCycle + 1) / TICKS);
    // Promises count toward the target: at most targetStock items can be in flight.
    const stock = leadTime > 0 ? Math.max(m.targetStock, out) / leadTime : Infinity;
    const caps = { gauge, machines, packager, link, inputs, stock };
    let limitedBy: Limit = 'none';
    let best = Infinity;
    for (const [k, v] of Object.entries(caps) as [Exclude<Limit, 'none'>, number][]) {
      if (v < best - EPS) {
        best = v;
        limitedBy = k;
      }
    }
    const req = required.get(id)!;
    const ach = Math.min(best, Number.isFinite(best) ? best : req);
    achievable.set(id, ach);
    result.push({
      id,
      required: req,
      caps,
      achievable: ach,
      limitedBy: Number.isFinite(best) ? limitedBy : 'none',
      bottleneck: req > ach + 1e-6,
      requestsPerSecond: Math.min(ach, req) / out,
      packagesPerRequest: ppr,
      leadTime,
      issues: [...new Set(issues)],
    });
  }
  const byId = new Map(result.map((r) => [r.id, r]));
  // The root cause is the most upstream bottleneck that is not merely starved by its inputs.
  const bottleneck =
    result.find((r) => r.bottleneck && r.limitedBy !== 'inputs')?.id ?? result.find((r) => r.bottleneck)?.id;
  return { modules: result, byId, bottleneck, order };
}

// ---------------------------------------------------------------------------
// Stock simulation
// ---------------------------------------------------------------------------

export interface StockSeries {
  id: string;
  stock: number[];
  /** Cumulated external demand not served. */
  unmet: number;
  delivered: number;
  verdict: 'starves' | 'accumulates' | 'balanced' | 'idle';
}

export interface Simulation {
  seconds: number;
  series: StockSeries[];
}

interface Batch {
  ready: number;
  amount: number;
  requestedAt: number;
}

/**
 * Coarse per-second simulation: gauges request a batch when stock + promised is below the target
 * and every input is in the upstream stock; batches arrive after the link and machine time.
 * External inputs (from = null) are unlimited.
 */
export function simulateStock(
  modules: GaugeModule[],
  c: LogisticsConstants,
  seconds: number,
  stackSize: (id: Id) => number = () => 64,
): Simulation {
  const { order } = moduleOrder(modules);
  const byId = new Map(modules.map((m) => [m.id, m]));
  const stock = new Map(modules.map((m) => [m.id, 0]));
  const pending = new Map<string, Batch[]>(modules.map((m) => [m.id, []]));
  const nextRequest = new Map(modules.map((m) => [m.id, 0]));
  const machineFree = new Map(modules.map((m) => [m.id, 0]));
  const unmet = new Map(modules.map((m) => [m.id, 0]));
  const lateUnmet = new Map(modules.map((m) => [m.id, 0]));
  const delivered = new Map(modules.map((m) => [m.id, 0]));
  const series = new Map<string, number[]>(modules.map((m) => [m.id, []]));
  const interval = gaugeInterval(c);
  const dt = 1;

  for (let t = 0; t < seconds; t += dt) {
    // Arrivals
    for (const m of modules) {
      const list = pending.get(m.id)!;
      const done = list.filter((b) => b.ready <= t);
      if (done.length) {
        stock.set(m.id, stock.get(m.id)! + done.reduce((s, b) => s + b.amount, 0));
        pending.set(m.id, list.filter((b) => b.ready > t));
      }
    }
    // External demand
    for (const m of modules) {
      if (m.demand <= 0) continue;
      const want = m.demand * dt;
      const take = Math.min(stock.get(m.id)!, want);
      stock.set(m.id, stock.get(m.id)! - take);
      delivered.set(m.id, delivered.get(m.id)! + take);
      unmet.set(m.id, unmet.get(m.id)! + (want - take));
      if (t >= seconds / 2) lateUnmet.set(m.id, lateUnmet.get(m.id)! + (want - take));
    }
    // Requests, downstream first so they see upstream stock before it is refilled this second.
    for (const id of [...order].reverse()) {
      const m = byId.get(id)!;
      if (!m.output || t < nextRequest.get(id)!) continue;
      if (m.mode === 'recipe' && !m.address.trim()) continue;
      // Expired promises no longer count toward the target, so the gauge orders again.
      const promised = pending
        .get(id)!
        .filter((b) => m.promiseTimeout === null || t - b.requestedAt < m.promiseTimeout)
        .reduce((s, b) => s + b.amount, 0);
      if (stock.get(id)! + promised >= Math.max(m.targetStock, 1)) continue;
      const ok = m.inputs.every((i) => !i.from || !byId.has(i.from) || stock.get(i.from)! >= i.amount);
      if (!ok) {
        for (const i of m.inputs)
          if (i.from && byId.has(i.from) && stock.get(i.from)! < i.amount && t >= seconds / 2)
            lateUnmet.set(i.from, lateUnmet.get(i.from)! + 1e-3);
        nextRequest.set(id, t + interval / 2);
        continue;
      }
      for (const i of m.inputs) if (i.from && byId.has(i.from)) stock.set(i.from, stock.get(i.from)! - i.amount);
      const ppr = packagesPerRequest(m, stackSize, c);
      const lpps = linkPackagesPerSecond(m.link.kind, m.link, c);
      const shipping = Math.max(ppr * ((c.packagerCycle + 1) / TICKS), Number.isFinite(lpps) && lpps > 0 ? ppr / lpps : 0);
      const arrive = t + shipping + linkTransitSeconds(m.link, c);
      const work = m.mode === 'recipe' && m.machineRate > 0 ? m.outputPerRequest / m.machineRate : 0;
      const start = Math.max(arrive, machineFree.get(id)!);
      machineFree.set(id, start + work);
      pending.get(id)!.push({ ready: start + work, amount: m.outputPerRequest, requestedAt: t });
      nextRequest.set(id, t + Math.max(interval, shipping));
    }
    for (const m of modules) series.get(m.id)!.push(stock.get(m.id)!);
  }

  return {
    seconds,
    series: modules.map((m) => {
      const s = series.get(m.id)!;
      const tail = s.slice(Math.floor(s.length / 2));
      const full = tail.length > 0 && tail.every((v) => v >= m.targetStock * 0.9);
      const empty = tail.length > 0 && tail.filter((v) => v <= 0).length > tail.length / 4;
      const starving = lateUnmet.get(m.id)! > 1e-6;
      return {
        id: m.id,
        stock: s,
        unmet: unmet.get(m.id)!,
        delivered: delivered.get(m.id)!,
        verdict: starving || (empty && m.demand > 0) ? 'starves' : full ? 'accumulates' : tail.every((v) => v === 0) ? 'idle' : 'balanced',
      };
    }),
  };
}
