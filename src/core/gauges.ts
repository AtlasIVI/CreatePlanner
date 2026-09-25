// Factory gauge board: gauges placed on a 2D grid, their connections, the address list,
// and a tick simulation of requests and packages. Behaviour follows Create 6
// (FactoryPanelBehaviour, mc1.21.1/dev):
// - a gauge acts only while stock + promised < target; then once every factoryGaugeTimer + 1 ticks
// - recipe mode: requests every connected input at once (all or nothing) to its recipe address,
//   and promises "recipe output" items of its own filter
// - restock mode (gauge on a packager): orders its own item, at most 9 stacks, to its address
// - nothing is sent while the address is blank
// - promise timeout: -1 never, 0 = 30 s, n = n minutes

import type { Id } from './types';

export const TICKS_PER_SECOND = 20;
export const GAUGE_TIMER = 100;
export const PACKAGE_SLOTS = 9;
export const DEFAULT_STACK = 64;

/** recipe: crafted on request; restock: on a packager; farm: the item comes from a farm, the gauge only watches it. */
export type GaugeMode = 'recipe' | 'restock' | 'farm';
export type AmountUnit = 'items' | 'stacks';

export interface GaugeInput {
  /** Gauge whose filter item is requested. */
  from: string;
  /** Amount per request. */
  amount: number;
}

export interface Gauge {
  id: string;
  x: number;
  y: number;
  label: string;
  item: Id | null;
  amount: number;
  unit: AmountUnit;
  mode: GaugeMode;
  address: string;
  recipeOutput: number;
  /** Game encoding: -1 never, 0 = 30 s, n = n minutes. */
  promiseTimeout: number;
  inputs: GaugeInput[];
  /** Restock mode: items in the inventory the packager fills, and how fast it is used. */
  localStock: number;
  consumptionPerMin: number;
  /** Farm mode: items the farm puts into the network per minute. */
  farmPerMin: number;
  /** Farm mode: the farm is switched off while the stock is at or above the target. */
  farmStopsAtTarget: boolean;
}

/** An address: where packages go (frogport, postbox, packager at a machine). */
export interface Destination {
  id: string;
  address: string;
  /** Seconds for a package to reach it. */
  travelSec: number;
  /** Seconds the machine there needs to turn one request into its output (0 = plain storage). */
  processSec: number;
  /** What the machine at this address turns each incoming item into (e.g. washing gravel). */
  treatments: Treatment[];
  /** Optional position on the grid. */
  x: number | null;
  y: number | null;
}

export interface ChanceOutput {
  item: Id;
  count: number;
  /** 0..1 */
  chance: number;
}

export interface Treatment {
  input: Id;
  outputs: ChanceOutput[];
}

/** average: expected amounts (fractions accumulate); random: every item is rolled like in game. */
export type ChanceMode = 'average' | 'random';

export interface Board {
  chanceMode: ChanceMode;
  version: 1;
  name: string;
  width: number;
  height: number;
  gauges: Gauge[];
  destinations: Destination[];
  /** Items in the logistics network at the start of the simulation. */
  stock: Record<Id, number>;
  /** Items entering the network per minute (mines, farms...). */
  supply: Record<Id, number>;
  /** Items taken from the network per minute (the factory's consumers). */
  demand: Record<Id, number>;
}

export function emptyBoard(): Board {
  return { version: 1, chanceMode: 'average', name: 'Mon usine', width: 14, height: 9, gauges: [], destinations: [], stock: {}, supply: {}, demand: {} };
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function newGauge(x: number, y: number, n: number): Gauge {
  return {
    id: newId('g'),
    x,
    y,
    label: `Jauge ${n}`,
    item: null,
    amount: 64,
    unit: 'items',
    mode: 'recipe',
    address: '',
    recipeOutput: 1,
    promiseTimeout: -1,
    inputs: [],
    localStock: 0,
    consumptionPerMin: 0,
    farmPerMin: 0,
    farmStopsAtTarget: false,
  };
}

export function newDestination(address: string): Destination {
  return { id: newId('a'), address, travelSec: 5, processSec: 5, treatments: [], x: null, y: null };
}

export function promiseTimeoutTicks(v: number): number {
  if (v < 0) return Infinity;
  if (v === 0) return 30 * TICKS_PER_SECOND;
  return v * 60 * TICKS_PER_SECOND;
}

export function targetAmount(g: Gauge, stackSize: (id: Id) => number = () => DEFAULT_STACK): number {
  return g.unit === 'stacks' && g.item ? g.amount * stackSize(g.item) : g.amount;
}

/** Address matching with '*' wildcards, case-insensitive. */
export function matchAddress(pattern: string, address: string): boolean {
  const p = pattern.trim().toLowerCase();
  const a = address.trim().toLowerCase();
  if (!p || !a) return false;
  const re = new RegExp(`^${p.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
  return re.test(a);
}

export function findDestination(board: Board, address: string): Destination | undefined {
  return board.destinations.find((d) => matchAddress(d.address, address) || matchAddress(address, d.address));
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

export interface Stack {
  item: Id;
  count: number;
}

export type PackageStatus = 'transit' | 'processing' | 'returning' | 'delivered' | 'undeliverable';

export interface Package {
  id: number;
  /** Request this package belongs to (shared with its promise). */
  request: number;
  /** Last package of its request: delivers the promise. */
  last: boolean;
  address: string;
  contents: Stack[];
  gauge: string | null;
  kind: 'recipe' | 'restock' | 'manual';
  destination: string | null;
  sentAt: number;
  /** Tick at which the current status ends. */
  until: number;
  status: PackageStatus;
  /** Items the gauge promised for this request (used when the address has no treatment). */
  output?: Stack;
  /** Items returned to the network once processed. */
  result?: Stack[];
}

export interface PromiseEntry {
  gauge: string;
  item: Id;
  count: number;
  createdAt: number;
  /** Package group that will fulfil it. */
  request: number;
}

export interface LogEntry {
  tick: number;
  gauge?: string;
  text: string;
  level: 'info' | 'warn';
}

export interface SimState {
  tick: number;
  stock: Record<Id, number>;
  local: Record<string, number>;
  timers: Record<string, number>;
  packages: Package[];
  promises: PromiseEntry[];
  log: LogEntry[];
  unmet: Record<Id, number>;
  nextId: number;
  /** State of the random generator (random chance mode), so runs are reproducible. */
  seed: number;
  /** Last reason each gauge did not send (to avoid repeating the log line). */
  blocked: Record<string, string>;
}

export function initSim(board: Board): SimState {
  return {
    tick: 0,
    stock: { ...board.stock },
    local: Object.fromEntries(board.gauges.map((g) => [g.id, g.localStock])),
    timers: Object.fromEntries(board.gauges.map((g) => [g.id, 0])),
    packages: [],
    promises: [],
    log: [],
    unmet: {},
    nextId: 1,
    seed: 12345,
    blocked: {},
  };
}

export interface GaugeStatus {
  inStorage: number;
  promised: number;
  target: number;
  state: 'idle' | 'satisfied' | 'promised' | 'waiting' | 'farming' | 'missing-inputs' | 'no-address';
}

export function gaugeStatus(sim: SimState, g: Gauge, stackSize?: (id: Id) => number): GaugeStatus {
  const target = targetAmount(g, stackSize);
  const inStorage = g.item ? (g.mode === 'restock' ? (sim.local[g.id] ?? 0) : (sim.stock[g.item] ?? 0)) : 0;
  const promised = sim.promises.filter((p) => p.gauge === g.id).reduce((s, p) => s + p.count, 0);
  let state: GaugeStatus['state'] = 'idle';
  if (g.item) {
    if (inStorage >= target) state = 'satisfied';
    else if (inStorage + promised >= target) state = 'promised';
    else if (g.mode === 'farm') state = g.farmPerMin > 0 ? 'farming' : 'waiting';
    else if (g.mode === 'recipe' && g.inputs.length === 0) state = 'waiting';
    else if (!g.address.trim()) state = 'no-address';
    else state = sim.blocked[g.id] === 'inputs' ? 'missing-inputs' : 'waiting';
  }
  return { inStorage, promised, target, state };
}

function log(sim: SimState, text: string, gauge?: string, level: LogEntry['level'] = 'info') {
  sim.log.push({ tick: sim.tick, gauge, text, level });
  if (sim.log.length > 400) sim.log.splice(0, sim.log.length - 400);
}

/** Split items into packages of at most 9 stacks. */
export function packStacks(items: Stack[], stackSize: (id: Id) => number = () => DEFAULT_STACK): Stack[][] {
  const stacks: Stack[] = [];
  for (const it of items) {
    let left = it.count;
    const size = Math.max(1, stackSize(it.item));
    while (left > 0) {
      const n = Math.min(size, left);
      stacks.push({ item: it.item, count: n });
      left -= n;
    }
  }
  const out: Stack[][] = [];
  for (let i = 0; i < stacks.length; i += PACKAGE_SLOTS) out.push(stacks.slice(i, i + PACKAGE_SLOTS));
  return out;
}

function ship(
  board: Board,
  sim: SimState,
  address: string,
  items: Stack[],
  kind: Package['kind'],
  gauge: string | null,
  stackSize: (id: Id) => number,
  output?: Stack,
): number {
  const request = sim.nextId++;
  const dest = findDestination(board, address);
  const groups = packStacks(items, stackSize);
  groups.forEach((contents, i) => {
    sim.packages.push({
      id: sim.nextId++,
      request,
      last: i === groups.length - 1,
      address,
      contents,
      gauge,
      kind,
      destination: dest?.id ?? null,
      sentAt: sim.tick,
      until: sim.tick + Math.round((dest?.travelSec ?? 5) * TICKS_PER_SECOND),
      status: 'transit',
      // Only the last package of a request carries the output, so it is produced once.
      output: i === groups.length - 1 ? output : undefined,
    });
  });
  return request;
}

function random(sim: SimState): number {
  // mulberry32
  let t = (sim.seed = (sim.seed + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const fmtCount = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, ''));

/** What an address gives back for some items. Items without a treatment come back unchanged. */
export function processAt(dest: Destination, contents: Stack[], mode: ChanceMode, sim?: SimState): Stack[] {
  const out = new Map<Id, number>();
  const add = (item: Id, n: number) => out.set(item, (out.get(item) ?? 0) + n);
  for (const s of contents) {
    const t = dest.treatments.find((x) => x.input === s.item);
    if (!t) {
      add(s.item, s.count);
      continue;
    }
    for (const o of t.outputs) {
      if (mode === 'random' && sim) {
        let n = 0;
        for (let i = 0; i < s.count; i++) if (random(sim) < o.chance) n += o.count;
        add(o.item, n);
      } else add(o.item, s.count * o.count * o.chance);
    }
  }
  return [...out].map(([item, count]) => ({ item, count }));
}

/** Expected amount of `item` produced at an address from some inputs. */
export function expectedOutput(dest: Destination, inputs: Stack[], item: Id): number {
  return processAt(dest, inputs, 'average').find((s) => s.item === item)?.count ?? 0;
}

/** Send a package by hand from the network stock. Returns an error message or null. */
export function sendManual(board: Board, sim: SimState, address: string, items: Stack[], stackSize: (id: Id) => number = () => DEFAULT_STACK): string | null {
  if (!address.trim()) return 'Adresse vide';
  for (const it of items) if ((sim.stock[it.item] ?? 0) < it.count) return `Stock insuffisant : ${it.item}`;
  for (const it of items) sim.stock[it.item] -= it.count;
  ship(board, sim, address, items, 'manual', null, stackSize);
  const dest = findDestination(board, address);
  log(sim, dest ? `Colis manuel envoyé à « ${address} »` : `Colis manuel envoyé à « ${address} » : aucune adresse ne correspond`, undefined, dest ? 'info' : 'warn');
  return null;
}

export function stepSim(board: Board, sim: SimState, ticks = 1, stackSize: (id: Id) => number = () => DEFAULT_STACK): SimState {
  const byId = new Map(board.gauges.map((g) => [g.id, g]));
  for (let t = 0; t < ticks; t++) {
    sim.tick++;
    // Supply and demand on the network
    for (const [item, perMin] of Object.entries(board.supply)) if (perMin > 0) sim.stock[item] = (sim.stock[item] ?? 0) + perMin / 1200;
    for (const [item, perMin] of Object.entries(board.demand)) {
      if (perMin <= 0) continue;
      const want = perMin / 1200;
      const take = Math.min(want, sim.stock[item] ?? 0);
      sim.stock[item] = (sim.stock[item] ?? 0) - take;
      if (want - take > 1e-9) sim.unmet[item] = (sim.unmet[item] ?? 0) + (want - take);
    }
    // Farms feeding the network
    for (const g of board.gauges) {
      if (g.mode !== 'farm' || !g.item || g.farmPerMin <= 0) continue;
      if (g.farmStopsAtTarget && (sim.stock[g.item] ?? 0) >= targetAmount(g, stackSize)) continue;
      sim.stock[g.item] = (sim.stock[g.item] ?? 0) + g.farmPerMin / 1200;
    }
    // Restock inventories being used
    for (const g of board.gauges) {
      if (g.mode === 'restock' && g.consumptionPerMin > 0) sim.local[g.id] = Math.max(0, (sim.local[g.id] ?? 0) - g.consumptionPerMin / 1200);
    }
    // Packages
    for (const p of sim.packages) {
      if (p.until > sim.tick || p.status === 'delivered' || p.status === 'undeliverable') continue;
      const dest = board.destinations.find((d) => d.id === p.destination);
      const g = p.gauge ? byId.get(p.gauge) : undefined;
      if (p.status === 'transit') {
        if (!dest) {
          p.status = 'undeliverable';
          log(sim, `Colis #${p.id} : aucune adresse ne correspond à « ${p.address} », il n'est livré nulle part`, p.gauge ?? undefined, 'warn');
          continue;
        }
        if (p.kind === 'restock' && g) {
          for (const s of p.contents) sim.local[g.id] = (sim.local[g.id] ?? 0) + s.count;
          p.status = 'delivered';
          if (p.last) sim.promises = sim.promises.filter((pr) => pr.request !== p.request);
          log(sim, `Colis #${p.id} livré à « ${dest.address} » (réappro. ${g.label})`, g.id);
        } else if (dest.treatments.length > 0 || (p.kind === 'recipe' && p.last)) {
          p.status = 'processing';
          p.until = sim.tick + Math.round(dest.processSec * TICKS_PER_SECOND);
          log(sim, `Colis #${p.id} arrivé à « ${dest.address} », traitement en cours`, p.gauge ?? undefined);
        } else {
          p.status = 'delivered';
          if (p.kind === 'manual') log(sim, `Colis #${p.id} livré à « ${dest.address} »`);
        }
      } else if (p.status === 'processing') {
        // With treatments, the address decides what comes out (chance outputs); otherwise the gauge's promise does.
        p.result = dest && dest.treatments.length > 0 ? processAt(dest, p.contents, board.chanceMode, sim) : p.output ? [p.output] : [];
        p.status = 'returning';
        p.until = sim.tick + Math.round((dest?.travelSec ?? 0) * TICKS_PER_SECOND);
      } else if (p.status === 'returning') {
        p.status = 'delivered';
        for (const r of p.result ?? []) sim.stock[r.item] = (sim.stock[r.item] ?? 0) + r.count;
        const got = (p.result ?? []).filter((r) => r.count > 0);
        let note = '';
        if (p.kind === 'recipe' && p.last) {
          const before = sim.promises.length;
          const promise = sim.promises.find((pr) => pr.request === p.request);
          sim.promises = sim.promises.filter((pr) => pr.request !== p.request);
          if (before === sim.promises.length) note = ' (promesse déjà expirée)';
          else if (promise) note = ` (promis ${promise.count})`;
        }
        log(
          sim,
          got.length ? `${got.map((r) => `+${fmtCount(r.count)} ${r.item}`).join(', ')} ajoutés au réseau${note}` : `Colis #${p.id} traité : rien obtenu${note}`,
          p.gauge ?? undefined,
          got.length ? 'info' : 'warn',
        );
      }
    }
    // Gauges
    for (const g of board.gauges) {
      if (!g.item) continue;
      if (g.mode === 'farm' || (g.mode === 'recipe' && g.inputs.length === 0)) continue;
      const expiry = promiseTimeoutTicks(g.promiseTimeout);
      const expired = sim.promises.filter((pr) => pr.gauge === g.id && sim.tick - pr.createdAt >= expiry);
      if (expired.length) {
        sim.promises = sim.promises.filter((pr) => !expired.includes(pr));
        log(sim, `${g.label} : promesse de ${expired.reduce((s, e) => s + e.count, 0)} expirée`, g.id, 'warn');
      }
      const st = gaugeStatus(sim, g, stackSize);
      if (st.state === 'satisfied' || st.state === 'promised') continue;
      if ((sim.timers[g.id] ?? 0) > 0) {
        sim.timers[g.id] = Math.min(sim.timers[g.id], GAUGE_TIMER) - 1;
        continue;
      }
      sim.timers[g.id] = GAUGE_TIMER;
      if (!g.address.trim()) {
        if (sim.blocked[g.id] !== 'address') log(sim, `${g.label} : adresse vide, aucune requête`, g.id, 'warn');
        sim.blocked[g.id] = 'address';
        continue;
      }
      if (g.mode === 'restock') {
        const want = Math.max(0, Math.min(st.target - st.promised - st.inStorage, stackSize(g.item) * PACKAGE_SLOTS));
        const order = Math.floor(Math.min(want, sim.stock[g.item] ?? 0));
        if (order <= 0) {
          if (sim.blocked[g.id] !== 'inputs') log(sim, `${g.label} : rien à commander dans le réseau`, g.id, 'warn');
          sim.blocked[g.id] = 'inputs';
          continue;
        }
        sim.stock[g.item] -= order;
        const request = ship(board, sim, g.address, [{ item: g.item, count: order }], 'restock', g.id, stackSize);
        sim.promises.push({ gauge: g.id, item: g.item, count: order, createdAt: sim.tick, request });
        sim.blocked[g.id] = '';
        log(sim, `${g.label} commande ${order} ${g.item} → « ${g.address} »`, g.id);
        continue;
      }
      // Recipe mode: every input, all or nothing
      const need = new Map<Id, number>();
      let broken = false;
      for (const inp of g.inputs) {
        const src = byId.get(inp.from);
        if (!src?.item) {
          broken = true;
          continue;
        }
        need.set(src.item, (need.get(src.item) ?? 0) + inp.amount);
      }
      const missing = [...need].filter(([item, n]) => (sim.stock[item] ?? 0) < n);
      if (broken || missing.length || need.size === 0) {
        if (sim.blocked[g.id] !== 'inputs')
          log(sim, `${g.label} : entrées insuffisantes (${missing.map(([i, n]) => `${n} ${i}`).join(', ') || 'jauge d’entrée sans objet'})`, g.id, 'warn');
        sim.blocked[g.id] = 'inputs';
        continue;
      }
      for (const [item, n] of need) sim.stock[item] -= n;
      const items = [...need].map(([item, count]) => ({ item, count }));
      const output = { item: g.item, count: g.recipeOutput };
      const request = ship(board, sim, g.address, items, 'recipe', g.id, stackSize, output);
      sim.promises.push({ gauge: g.id, item: g.item, count: g.recipeOutput, createdAt: sim.tick, request });
      sim.blocked[g.id] = '';
      log(sim, `${g.label} envoie ${items.map((i) => `${i.count} ${i.item}`).join(' + ')} → « ${g.address} » (promet ${g.recipeOutput})`, g.id);
    }
  }
  return sim;
}

/** Remove a gauge and every connection that used it. */
export function removeGauge(board: Board, id: string): Board {
  return {
    ...board,
    gauges: board.gauges.filter((g) => g.id !== id).map((g) => ({ ...g, inputs: g.inputs.filter((i) => i.from !== id) })),
  };
}

export function normalizeBoard(raw: unknown): Board {
  const base = emptyBoard();
  if (typeof raw !== 'object' || raw === null) throw new Error('Fichier invalide');
  const b = raw as Partial<Board>;
  if (!Array.isArray(b.gauges)) throw new Error('Fichier invalide : pas de jauges');
  return {
    ...base,
    ...b,
    version: 1,
    chanceMode: b.chanceMode === 'random' ? 'random' : 'average',
    gauges: b.gauges.map((g) => ({ ...newGauge(0, 0, 0), ...g })),
    destinations: Array.isArray(b.destinations) ? b.destinations.map((d) => ({ ...newDestination(''), ...d })) : [],
    stock: b.stock ?? {},
    supply: b.supply ?? {},
    demand: b.demand ?? {},
  };
}
