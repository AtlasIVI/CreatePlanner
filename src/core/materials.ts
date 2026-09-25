// Material list: blocks to place (plan, sources, logistics, grid) and the raw resources
// needed to craft them, after subtracting what the player already owns.

import { outputYield, pickRecipe, resolveIngredient, type PlanResult } from './calculator';
import { machineBlocks, sourceOutput } from './machines';
import type { GaugeModule, GridState, PlacedSource } from './project';
import type { DataSet } from './registry';
import type { BlockCount, Id, StackKind } from './types';

export type Origin = 'plan' | 'sources' | 'logistics' | 'grid';

export interface OriginCount extends BlockCount {
  origin: Origin;
}

export function planBlocks(plan: PlanResult): BlockCount[] {
  const out: BlockCount[] = [];
  for (const s of plan.steps) {
    const loads = s.subSteps ?? [s];
    for (const l of loads) {
      if (!l.machine || !Number.isFinite(l.machines) || l.machines <= 0) continue;
      const ctx = { rpm: l.rpm, duration: s.recipe.duration, batch: l.batch, cells: s.recipe.cells };
      out.push(...machineBlocks(l.machine, l.machines, ctx, s.heat));
    }
  }
  return out;
}

export function sourceBlocks(ds: DataSet, sources: PlacedSource[]): BlockCount[] {
  const out: BlockCount[] = [];
  for (const s of sources) {
    const def = ds.sources.find((d) => d.id === s.sourceId);
    if (!def || s.count <= 0) continue;
    for (const b of sourceOutput(def, s.params).blocks) out.push({ id: b.id, count: b.count * s.count });
  }
  return out;
}

/** Longest chain conveyor connection (CKinetics.maxChainConveyorLength). */
export const MAX_CHAIN_LENGTH = 32;

export function logisticsBlocks(modules: GaugeModule[]): BlockCount[] {
  const out: BlockCount[] = [];
  for (const m of modules) {
    out.push({ id: 'create:factory_gauge', count: 1 });
    out.push({ id: m.mode === 'recipe' ? 'create:stock_link' : 'create:packager', count: 1 });
    if (m.mode === 'recipe') out.push({ id: 'create:packager', count: 1 });
    if (m.link.kind === 'frogport') out.push({ id: 'create:package_frogport', count: Math.max(1, m.link.frogports) });
    if (m.link.kind === 'chain') {
      out.push({ id: 'create:package_frogport', count: 1 });
      out.push({ id: 'create:chain_conveyor', count: Math.ceil(Math.max(1, m.link.length) / MAX_CHAIN_LENGTH) + 1 });
    }
  }
  return out;
}

export function gridBlocks(ds: DataSet, grid: GridState): BlockCount[] {
  const counts = new Map<Id, number>();
  for (const cell of Object.values(grid.cells)) counts.set(cell.block, (counts.get(cell.block) ?? 0) + 1);
  const out: BlockCount[] = [];
  for (const [id, n] of counts) {
    const conv = ds.placeables.find((p) => p.id === id)?.material;
    if (conv) out.push({ id: conv.id, count: Math.ceil(n * conv.perBlock.value) });
    else out.push({ id, count: n });
  }
  return out;
}

export function sumCounts(lists: OriginCount[]): Map<Id, { count: number; origins: Set<Origin> }> {
  const out = new Map<Id, { count: number; origins: Set<Origin> }>();
  for (const b of lists) {
    if (b.count <= 0) continue;
    const cur = out.get(b.id) ?? { count: 0, origins: new Set<Origin>() };
    cur.count += b.count;
    cur.origins.add(b.origin);
    out.set(b.id, cur);
  }
  return out;
}

export interface MaterialLine {
  id: Id;
  kind: StackKind;
  /** Total needed. */
  needed: number;
  /** Covered by the stock list. */
  fromStock: number;
  /** Still to obtain (craft or gather). */
  missing: number;
  origins?: Origin[];
  recipe?: Id;
}

export interface MaterialResult {
  blocks: MaterialLine[];
  intermediates: MaterialLine[];
  raw: MaterialLine[];
  /** Extra items produced by whole crafts (e.g. 8 shafts per craft when 2 are needed). */
  leftovers: { id: Id; count: number }[];
  cycles: Id[];
}

export interface MaterialOptions {
  stock?: Record<Id, number>;
  /** item -> recipe id or RAW; defaults prefer recipes made by hand. */
  recipeChoice?: Record<Id, string>;
  tagChoice?: Record<Id, Id>;
  maxDepth?: number;
}

export function materialList(ds: DataSet, needs: OriginCount[], opts: MaterialOptions = {}): MaterialResult {
  const stock = new Map(Object.entries(opts.stock ?? {}).filter(([, v]) => v > 0));
  const maxDepth = opts.maxDepth ?? 24;
  const made = new Map<Id, MaterialLine>();
  const raw = new Map<Id, MaterialLine>();
  const leftovers = new Map<Id, number>();
  const cycles = new Set<Id>();
  const stockUsed = new Map<Id, number>();
  const kindOf = (id: Id): StackKind => ds.items.get(id)?.kind ?? 'item';

  const takeStock = (id: Id, qty: number) => {
    const have = stock.get(id) ?? 0;
    const take = Math.min(have, qty);
    if (take > 0) stock.set(id, have - take);
    return take;
  };

  function need(id: Id, qty: number, path: Set<Id>, depth: number, line?: MaterialLine) {
    if (qty <= 0) return;
    const fromStock = takeStock(id, qty);
    if (line) line.fromStock += fromStock;
    else if (fromStock > 0) stockUsed.set(id, (stockUsed.get(id) ?? 0) + fromStock);
    let rest = qty - fromStock;
    if (rest <= 1e-9) return;
    // Leftovers of earlier whole crafts are used first.
    const left = leftovers.get(id) ?? 0;
    if (left > 0) {
      const use = Math.min(left, rest);
      leftovers.set(id, left - use);
      rest -= use;
      if (rest <= 1e-9) return;
    }
    const pick = pickRecipe(ds, id, opts.recipeChoice, 'hand');
    const r = pick.recipe;
    if (!r || path.has(id) || depth > maxDepth) {
      if (r && path.has(id)) cycles.add(id);
      const cur = raw.get(id) ?? { id, kind: kindOf(id), needed: 0, fromStock: 0, missing: 0 };
      cur.needed += rest;
      cur.missing += rest;
      raw.set(id, cur);
      return;
    }
    const yieldPer = outputYield(r, id);
    const crafts = Math.ceil(rest / yieldPer - 1e-9);
    const extra = crafts * yieldPer - rest;
    if (extra > 1e-9) leftovers.set(id, (leftovers.get(id) ?? 0) + extra);
    if (!line) {
      const cur = made.get(id) ?? { id, kind: kindOf(id), needed: 0, fromStock: 0, missing: 0, recipe: r.id };
      cur.needed += rest;
      cur.missing += rest;
      made.set(id, cur);
    } else line.recipe = r.id;
    const next = new Set(path).add(id);
    for (const ing of r.inputs) {
      if (ing.id === id) continue;
      const inId = resolveIngredient(ds, ing, opts.tagChoice);
      if (inId) need(inId, ing.amount * crafts, next, depth + 1);
    }
  }

  const blocks: MaterialLine[] = [];
  for (const [id, { count, origins }] of sumCounts(needs)) {
    const line: MaterialLine = { id, kind: kindOf(id), needed: count, fromStock: 0, missing: 0, origins: [...origins] };
    blocks.push(line);
    need(id, count, new Set(), 0, line);
    line.missing = line.needed - line.fromStock;
  }
  // Intermediate and raw lines also report what the stock covered for them.
  for (const [id, used] of stockUsed) {
    const line = raw.get(id) ?? made.get(id);
    if (line) {
      line.fromStock += used;
      line.needed += used;
    } else {
      const target = pickRecipe(ds, id, opts.recipeChoice, 'hand').recipe ? made : raw;
      target.set(id, { id, kind: kindOf(id), needed: used, fromStock: used, missing: 0 });
    }
  }
  const byName = (a: MaterialLine, b: MaterialLine) => b.missing - a.missing || a.id.localeCompare(b.id);
  return {
    blocks: blocks.sort(byName),
    intermediates: [...made.values()].sort(byName),
    raw: [...raw.values()].sort(byName),
    leftovers: [...leftovers.entries()].filter(([, v]) => v > 1e-9).map(([id, count]) => ({ id, count })),
    cycles: [...cycles],
  };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

const csvCell = (v: string | number) => {
  const s = typeof v === 'number' ? String(Math.round(v * 1000) / 1000).replace('.', ',') : v;
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Semicolon-separated CSV with decimal commas (opens directly in a French spreadsheet). */
export function materialsCsv(res: MaterialResult, name: (id: Id) => string): string {
  const rows: (string | number)[][] = [['Catégorie', 'Identifiant', 'Nom', 'Nécessaire', 'En stock', 'À obtenir']];
  const add = (cat: string, list: MaterialLine[]) => {
    for (const l of list) rows.push([cat, l.id, name(l.id), l.needed, l.fromStock, l.missing]);
  };
  add('Bloc à poser', res.blocks);
  add('Intermédiaire', res.intermediates);
  add('Ressource brute', res.raw);
  return '﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
}

export function materialsText(res: MaterialResult, name: (id: Id) => string): string {
  const fmt = (l: MaterialLine) => `${Math.ceil(l.missing)}${l.kind === 'fluid' ? ' mB' : ' ×'} ${name(l.id)}`;
  const section = (title: string, list: MaterialLine[]) =>
    list.some((l) => l.missing > 0) ? [`${title} :`, ...list.filter((l) => l.missing > 0).map((l) => `  ${fmt(l)}`)] : [];
  return [...section('Blocs à poser', res.blocks), ...section('Ressources brutes', res.raw)].join('\n');
}
