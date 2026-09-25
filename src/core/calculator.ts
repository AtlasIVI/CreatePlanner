// Production calculator: target item + rate -> recipe tree, machines per step, raw inputs,
// byproducts and stress. Generic over recipe types; machine behaviour comes from data.

import {
  belowMinRpm,
  executionsPerSecond,
  machineUnverified,
  recipeContext,
  stressPerMachine,
  ticksPerOperation,
  unitsPerMachine,
} from './machines';
import { concreteIds, defaultTagMember, type DataSet } from './registry';
import type { HeatLevel, Id, IngredientRef, MachineDef, Recipe, StackKind } from './types';

export const RAW = 'raw';

export interface PlanOptions {
  target: Id;
  /** Target rate in items (or mB) per second. */
  rate: number;
  /** Default rotation speed for every kinetic machine. */
  rpm: number;
  /** item id -> recipe id, or RAW to treat the item as a raw input. */
  recipeChoice?: Record<Id, string>;
  /** recipe id (or "recipeId#stepIndex" for sequenced steps) -> machine id */
  machineChoice?: Record<string, Id>;
  /** tag -> concrete item */
  tagChoice?: Record<Id, Id>;
  /** recipe id -> rpm */
  rpmOverride?: Record<Id, number>;
  /** recipe id -> items fed per operation */
  batch?: Record<Id, number>;
  maxDepth?: number;
}

export type RawReason = 'no-recipe' | 'default' | 'user' | 'cycle' | 'depth';

export interface PlanNode {
  item: Id;
  kind: StackKind;
  rate: number;
  viaTag?: Id;
  recipe?: Recipe;
  options: Recipe[];
  rawReason?: RawReason;
  executions: number;
  children: PlanNode[];
}

export interface Flow {
  id: Id;
  kind: StackKind;
  rate: number;
}

export interface MachineLoad {
  machine?: MachineDef;
  machineOptions: MachineDef[];
  executions: number;
  rpm: number;
  batch: number;
  ticksPerOperation: number;
  /** Recipe executions per second for one machine. */
  perMachine: number;
  machinesExact: number;
  machines: number;
  units: number;
  stress: number;
  belowMinRpm: boolean;
  unverified: boolean;
}

export interface SubStep extends MachineLoad {
  index: number;
  type: Id;
}

export interface Step extends MachineLoad {
  recipe: Recipe;
  heat?: HeatLevel;
  inputs: Flow[];
  outputs: Flow[];
  subSteps?: SubStep[];
}

export interface PlanResult {
  root: PlanNode;
  steps: Step[];
  raw: Flow[];
  byproducts: Flow[];
  totalStress: number;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Recipe choice
// ---------------------------------------------------------------------------

export function machinesFor(ds: DataSet, type: Id): MachineDef[] {
  const list = ds.machinesByType.get(type) ?? [];
  // Automated machines first, manual workstations last.
  return [...list].sort((a, b) => Number(!!a.manual) - Number(!!b.manual));
}

export function isModelled(ds: DataSet, r: Recipe): boolean {
  return machinesFor(ds, r.type).length > 0;
}

export function outputYield(r: Recipe, item: Id): number {
  const made = r.outputs.filter((o) => o.id === item).reduce((s, o) => s + o.amount * o.chance, 0);
  const used = r.inputs.filter((i) => i.id === item).reduce((s, i) => s + i.amount, 0);
  return made - used;
}

export function resolveIngredient(ds: DataSet, ing: IngredientRef, tagChoice?: Record<Id, Id>): Id | undefined {
  if (ing.id) return ing.id;
  if (!ing.tag) return undefined;
  const chosen = tagChoice?.[ing.tag];
  if (chosen) return chosen;
  return defaultTagMember(ds, ing.tag);
}

function isRawItem(ds: DataSet, id: Id): boolean {
  return ds.rawByDefault.has(id) || !(ds.recipesByOutput.get(id)?.length);
}

function isReversible(ds: DataSet, r: Recipe): boolean {
  const out = r.outputs[0]?.id;
  if (!out) return false;
  return r.inputs.some((i) => concreteIds(ds, i).some((x) => ds.conversions.has(`${out}>${x}`)));
}

function allInputsRaw(ds: DataSet, r: Recipe): boolean {
  return r.inputs.every((i) => {
    const id = resolveIngredient(ds, i);
    return !id || isRawItem(ds, id);
  });
}

export type Preference = 'automation' | 'hand';

/** Recipes that can reasonably produce an item by default (primary output, modelled, not a storage round-trip). */
export function defaultCandidates(ds: DataSet, item: Id, prefer: Preference): Recipe[] {
  const list = (ds.recipesByOutput.get(item) ?? []).filter(
    (r) =>
      r.outputs[0]?.id === item &&
      isModelled(ds, r) &&
      outputYield(r, item) > 0 &&
      !(isReversible(ds, r) && !allInputsRaw(ds, r)),
  );
  const key = (r: Recipe): (number | string)[] => {
    const hand = ds.handCraftTypes.has(r.type) ? 1 : 0;
    const manual = machinesFor(ds, r.type)[0]?.manual ? 1 : 0;
    const raw = allInputsRaw(ds, r) ? 0 : 1;
    return prefer === 'automation'
      ? [manual, hand, raw, r.inputs.length, r.id]
      : [1 - hand, raw, r.inputs.length, r.id];
  };
  return list.sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) {
      if (ka[i] < kb[i]) return -1;
      if (ka[i] > kb[i]) return 1;
    }
    return 0;
  });
}

/** Recipes offered to the user for an item: primary output or a likely (>= 50 %) output. */
export function recipeOptions(ds: DataSet, item: Id): Recipe[] {
  const list = (ds.recipesByOutput.get(item) ?? []).filter(
    (r) => outputYield(r, item) > 0 && (r.outputs[0]?.id === item || r.outputs.some((o) => o.id === item && o.chance >= 0.5)),
  );
  return list.sort((a, b) => Number(a.outputs[0]?.id !== item) - Number(b.outputs[0]?.id !== item) || a.id.localeCompare(b.id));
}

export interface RecipePick {
  recipe?: Recipe;
  rawReason?: RawReason;
}

export function pickRecipe(
  ds: DataSet,
  item: Id,
  choice: Record<Id, string> | undefined,
  prefer: Preference,
): RecipePick {
  const c = choice?.[item];
  if (c === RAW) return { rawReason: 'user' };
  if (c) {
    const r = ds.recipeById.get(c);
    if (r && r.outputs.some((o) => o.id === item)) return { recipe: r };
  }
  if (ds.rawByDefault.has(item)) return { rawReason: 'default' };
  const best = defaultCandidates(ds, item, prefer)[0];
  if (best) return { recipe: best };
  return { rawReason: (ds.recipesByOutput.get(item)?.length ?? 0) > 0 ? 'default' : 'no-recipe' };
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

function addFlow(map: Map<Id, Flow>, id: Id, kind: StackKind, rate: number) {
  const f = map.get(id);
  if (f) f.rate += rate;
  else map.set(id, { id, kind, rate });
}

function machineLoad(
  ds: DataSet,
  machineOptions: MachineDef[],
  chosenId: Id | undefined,
  recipe: Recipe | undefined,
  duration: number | undefined,
  executions: number,
  opts: PlanOptions,
  key: Id,
): MachineLoad {
  const machine = machineOptions.find((m) => m.id === chosenId) ?? machineOptions[0];
  const maxRpm = ds.maxRpm.value;
  const rpm = Math.min(maxRpm, Math.max(0, opts.rpmOverride?.[key] ?? opts.rpm));
  const batch = opts.batch?.[key] ?? machine?.speed.defaultBatch ?? 1;
  const base: MachineLoad = {
    machine,
    machineOptions,
    executions,
    rpm,
    batch,
    ticksPerOperation: NaN,
    perMachine: 0,
    machinesExact: Infinity,
    machines: Infinity,
    units: 1,
    stress: 0,
    belowMinRpm: false,
    unverified: false,
  };
  if (!machine) return base;
  const ctx = { ...recipeContext(recipe, rpm, batch), duration: duration ?? recipe?.duration };
  const perMachine = executionsPerSecond(machine, ctx);
  const machinesExact = perMachine > 0 ? executions / perMachine : Infinity;
  const machines = Number.isFinite(machinesExact) ? Math.ceil(machinesExact - 1e-9) : Infinity;
  return {
    ...base,
    ticksPerOperation: ticksPerOperation(machine, ctx),
    perMachine,
    machinesExact,
    machines,
    units: unitsPerMachine(machine, ctx),
    stress: Number.isFinite(machines) ? machines * stressPerMachine(machine, ctx) : 0,
    belowMinRpm: belowMinRpm(machine, rpm),
    unverified: machineUnverified(machine),
  };
}

export function computeStep(ds: DataSet, recipe: Recipe, executions: number, opts: PlanOptions): Step {
  const machineOptions = machinesFor(ds, recipe.type);
  const load = machineLoad(ds, machineOptions, opts.machineChoice?.[recipe.id], recipe, undefined, executions, opts, recipe.id);
  const step: Step = {
    ...load,
    recipe,
    heat: recipe.heat,
    inputs: recipe.inputs.map((i) => ({
      id: resolveIngredient(ds, i, opts.tagChoice) ?? i.tag ?? '?',
      kind: i.kind,
      rate: i.amount * executions,
    })),
    outputs: recipe.outputs.map((o) => ({ id: o.id, kind: o.kind, rate: o.amount * o.chance * executions })),
  };
  if (load.machine?.composite && recipe.sequence) {
    const loops = recipe.loops ?? 1;
    step.subSteps = recipe.sequence.map((s, index) => {
      const key = `${recipe.id}#${index}`;
      const sub = machineLoad(
        ds,
        machinesFor(ds, s.type),
        opts.machineChoice?.[key],
        undefined,
        s.duration,
        executions * loops,
        { ...opts, rpmOverride: { ...opts.rpmOverride, [key]: opts.rpmOverride?.[key] ?? opts.rpmOverride?.[recipe.id] ?? opts.rpm } },
        key,
      );
      return { ...sub, index, type: s.type };
    });
    step.stress = step.subSteps.reduce((s, x) => s + x.stress, 0);
    step.unverified = step.subSteps.some((x) => x.unverified || !x.machine);
    step.belowMinRpm = step.subSteps.some((x) => x.belowMinRpm);
    // A sequenced line runs at the pace of its slowest step.
    step.machinesExact = Math.max(0, ...step.subSteps.map((x) => x.machinesExact));
    step.machines = Math.max(0, ...step.subSteps.map((x) => x.machines));
    step.perMachine = Math.min(...step.subSteps.map((x) => x.perMachine)) / loops;
  }
  return step;
}

const MAX_NODES = 5000;

export function plan(ds: DataSet, opts: PlanOptions): PlanResult {
  const warnings: string[] = [];
  const execByRecipe = new Map<Id, number>();
  const order: Id[] = [];
  const raw = new Map<Id, Flow>();
  const byproducts = new Map<Id, Flow>();
  const maxDepth = opts.maxDepth ?? 32;
  let nodes = 0;

  function expand(item: Id, kind: StackKind, rate: number, path: Set<Id>, depth: number, viaTag?: Id): PlanNode {
    nodes++;
    const options = recipeOptions(ds, item);
    const node: PlanNode = { item, kind, rate, viaTag, options, executions: 0, children: [] };
    let pick = pickRecipe(ds, item, opts.recipeChoice, 'automation');
    if (pick.recipe && path.has(item)) pick = { rawReason: 'cycle' };
    if (pick.recipe && (depth >= maxDepth || nodes > MAX_NODES)) {
      pick = { rawReason: 'depth' };
      if (!warnings.includes('depth')) warnings.push('depth');
    }
    if (!pick.recipe) {
      node.rawReason = pick.rawReason;
      addFlow(raw, item, kind, rate);
      return node;
    }
    const r = pick.recipe;
    const net = outputYield(r, item);
    if (!(net > 0)) {
      node.rawReason = 'cycle';
      addFlow(raw, item, kind, rate);
      return node;
    }
    const exec = rate / net;
    node.recipe = r;
    node.executions = exec;
    if (!execByRecipe.has(r.id)) order.push(r.id);
    execByRecipe.set(r.id, (execByRecipe.get(r.id) ?? 0) + exec);
    for (const o of r.outputs) {
      if (o.id === item) continue;
      addFlow(byproducts, o.id, o.kind, o.amount * o.chance * exec);
    }
    const nextPath = new Set(path).add(item);
    for (const ing of r.inputs) {
      if (ing.id === item) continue; // catalyst-like self input already netted
      const id = resolveIngredient(ds, ing, opts.tagChoice);
      if (!id) {
        warnings.push(`empty-tag:${ing.tag}`);
        continue;
      }
      node.children.push(expand(id, ing.kind, ing.amount * exec, nextPath, depth + 1, ing.tag));
    }
    return node;
  }

  const targetKind = ds.items.get(opts.target)?.kind ?? 'item';
  const root = expand(opts.target, targetKind, opts.rate, new Set(), 0);
  const steps = order.map((id) => computeStep(ds, ds.recipeById.get(id)!, execByRecipe.get(id)!, opts));
  for (const s of steps) {
    if (!s.machine) warnings.push(`unmodelled:${s.recipe.type}`);
    if (s.belowMinRpm) warnings.push(`min-rpm:${s.recipe.id}`);
  }
  return {
    root,
    steps,
    raw: [...raw.values()],
    byproducts: [...byproducts.values()],
    totalStress: steps.reduce((s, x) => s + x.stress, 0),
    warnings: [...new Set(warnings)],
  };
}

export const perMinute = (perSecond: number) => perSecond * 60;
export const perHour = (perSecond: number) => perSecond * 3600;
