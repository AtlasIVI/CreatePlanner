// Normalizes any recipe JSON (vanilla, Create, add-ons) into the internal Recipe model.
// Unknown recipe types are kept: inputs/outputs are extracted when the shape is
// recognisable, and the report flags types that no machine file models.

import type { HeatLevel, Id, IngredientRef, OutputStack, Recipe, SequenceStep } from '../../src/core/types';

type Json = Record<string, unknown>;

const COOKING_DEFAULTS: Record<string, number> = {
  'minecraft:smelting': 200,
  'minecraft:blasting': 100,
  'minecraft:smoking': 100,
  'minecraft:campfire_cooking': 600,
};

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** "data/create/recipe/pressing/iron_ingot.json" -> "create:pressing/iron_ingot" */
export function recipeIdFromPath(path: string): Id | undefined {
  const m = /^data\/([^/]+)\/recipes?\/(.+)\.json$/.exec(path.replace(/\\/g, '/'));
  return m ? `${m[1]}:${m[2]}` : undefined;
}

export function withNamespace(id: string): Id {
  return id.includes(':') ? id : `minecraft:${id}`;
}

/** Parse one ingredient. Returns undefined when the shape is not understood. */
export function parseIngredient(raw: unknown, amount = 1): IngredientRef | undefined {
  if (typeof raw === 'string') {
    return raw.startsWith('#')
      ? { kind: 'item', tag: withNamespace(raw.slice(1)), amount }
      : { kind: 'item', id: withNamespace(raw), amount };
  }
  if (Array.isArray(raw)) {
    const parts = raw.map((r) => parseIngredient(r, amount)).filter((r): r is IngredientRef => !!r);
    if (parts.length === 0) return undefined;
    const first = { ...parts[0] };
    const alts = parts.slice(1).map((p) => p.id).filter((x): x is string => !!x);
    if (alts.length) first.alternatives = alts;
    return first;
  }
  if (!isObj(raw)) return undefined;
  const type = str(raw.type);
  const count = num(raw.count) ?? amount;
  // NeoForge fluid ingredients (Create 6 on 1.21.1)
  if (type === 'neoforge:single' || type === 'fluid_stack' || (str(raw.fluid) && !str(raw.item))) {
    const fluid = str(raw.fluid);
    if (fluid) return { kind: 'fluid', id: withNamespace(fluid), amount: num(raw.amount) ?? 1000 };
  }
  if (type === 'neoforge:tag' || type === 'fluid_tag' || str(raw.fluid_tag) || str(raw.fluidTag)) {
    const tag = str(raw.tag) ?? str(raw.fluid_tag) ?? str(raw.fluidTag);
    if (tag) return { kind: 'fluid', tag: withNamespace(tag), amount: num(raw.amount) ?? 1000 };
  }
  if (type === 'neoforge:compound' && Array.isArray(raw.children)) return parseIngredient(raw.children, count);
  if (type === 'neoforge:difference' || type === 'neoforge:intersection') {
    return parseIngredient(raw.base ?? (Array.isArray(raw.children) ? raw.children[0] : undefined), count);
  }
  if (type === 'neoforge:components' && raw.items !== undefined) return parseIngredient(raw.items, count);
  if (str(raw.item)) return { kind: 'item', id: withNamespace(str(raw.item)!), amount: count };
  if (str(raw.tag)) return { kind: 'item', tag: withNamespace(str(raw.tag)!), amount: count };
  if (raw.ingredient !== undefined) return parseIngredient(raw.ingredient, count);
  return undefined;
}

/** Parse one result stack. */
export function parseOutput(raw: unknown): OutputStack | undefined {
  if (typeof raw === 'string') return { kind: 'item', id: withNamespace(raw), amount: 1, chance: 1 };
  if (!isObj(raw)) return undefined;
  const chance = num(raw.chance) ?? 1;
  const fluid = str(raw.fluid);
  if (fluid) return { kind: 'fluid', id: withNamespace(fluid), amount: num(raw.amount) ?? 1000, chance };
  const id = str(raw.id) ?? str(raw.item);
  if (!id) return undefined;
  // Create 6: fluid results carry "amount", item results carry "count".
  if (num(raw.amount) !== undefined && num(raw.count) === undefined) {
    return { kind: 'fluid', id: withNamespace(id), amount: num(raw.amount)!, chance };
  }
  return { kind: 'item', id: withNamespace(id), amount: num(raw.count) ?? 1, chance };
}

const ingKey = (i: IngredientRef) => `${i.kind}|${i.id ?? ''}|#${i.tag ?? ''}`;

/** Merge identical ingredients (Create repeats an ingredient to ask for several). */
export function mergeIngredients(list: IngredientRef[]): IngredientRef[] {
  const out = new Map<string, IngredientRef>();
  for (const i of list) {
    const k = ingKey(i);
    const prev = out.get(k);
    if (prev) prev.amount += i.amount;
    else out.set(k, { ...i });
  }
  return [...out.values()];
}

function parseList(raw: unknown): { items: IngredientRef[]; failed: number } {
  const items: IngredientRef[] = [];
  let failed = 0;
  if (!Array.isArray(raw)) return { items, failed };
  for (const r of raw) {
    const p = parseIngredient(r);
    if (p) items.push(p);
    else failed++;
  }
  return { items, failed };
}

function parseOutputs(raw: unknown): OutputStack[] {
  if (!Array.isArray(raw)) {
    const one = parseOutput(raw);
    return one ? [one] : [];
  }
  return raw.map(parseOutput).filter((o): o is OutputStack => !!o);
}

function parseShaped(json: Json): { inputs: IngredientRef[]; cells: number } {
  const key = isObj(json.key) ? json.key : {};
  const pattern = Array.isArray(json.pattern) ? json.pattern.filter((r): r is string => typeof r === 'string') : [];
  const counts = new Map<string, number>();
  let cells = 0;
  for (const row of pattern) {
    for (const ch of row) {
      if (ch === ' ') continue;
      cells++;
      counts.set(ch, (counts.get(ch) ?? 0) + 1);
    }
  }
  const inputs: IngredientRef[] = [];
  for (const [ch, n] of counts) {
    const ing = parseIngredient(key[ch], n);
    if (ing) {
      ing.amount = n;
      inputs.push(ing);
    }
  }
  return { inputs: mergeIngredients(inputs), cells };
}

function parseHeat(v: unknown): HeatLevel | undefined {
  const s = str(v);
  if (s === 'heated' || s === 'superheated') return s;
  return undefined;
}

function parseConditions(json: Json): string[] | undefined {
  const conds = json['neoforge:conditions'] ?? json['conditions'];
  if (!Array.isArray(conds)) return undefined;
  const mods = conds
    .filter(isObj)
    .filter((c) => str(c.type) === 'neoforge:mod_loaded' || str(c.type) === 'forge:mod_loaded')
    .map((c) => str(c.modid))
    .filter((m): m is string => !!m);
  return mods.length ? mods : undefined;
}

function parseSequenced(json: Json, base: Recipe): Recipe {
  const baseIng = parseIngredient(json.ingredient);
  const transitional = parseOutput(json.transitional_item ?? json.transitionalItem)?.id;
  const loops = num(json.loops) ?? 1;
  const steps: SequenceStep[] = [];
  const extra: IngredientRef[] = [];
  for (const s of Array.isArray(json.sequence) ? json.sequence : []) {
    if (!isObj(s)) continue;
    const { items } = parseList(s.ingredients);
    // The first ingredient of every step is the transitional item itself.
    const rest = items.filter((i, idx) => !(idx === 0 && (i.id === transitional || i.id === baseIng?.id)));
    steps.push({ type: str(s.type) ?? 'unknown', inputs: rest, duration: num(s.processing_time) ?? num(s.processingTime) });
    for (const r of rest) extra.push({ ...r, amount: r.amount * loops });
  }
  // Sequenced assembly result "chance" values are weights.
  const outs = parseOutputs(json.results);
  const total = outs.reduce((s, o) => s + o.chance, 0) || 1;
  return {
    ...base,
    inputs: mergeIngredients([...(baseIng ? [baseIng] : []), ...extra]),
    outputs: outs.map((o) => ({ ...o, chance: o.chance / total })),
    sequence: steps,
    loops,
    transitional,
  };
}

export interface NormalizeResult {
  recipe?: Recipe;
  /** Why the recipe could not be read at all. */
  error?: string;
  /** Recipe kept but some ingredients or outputs were not understood. */
  partial?: boolean;
}

export function normalizeRecipe(id: Id, mod: string, raw: unknown): NormalizeResult {
  if (!isObj(raw)) return { error: 'not an object' };
  const type = str(raw.type);
  if (!type) return { error: 'missing type' };
  const base: Recipe = { id, type: withNamespace(type), mod, inputs: [], outputs: [] };
  const requiresMods = parseConditions(raw);
  if (requiresMods) base.requiresMods = requiresMods;
  const t = base.type;
  let partial = false;

  if (t === 'minecraft:crafting_shaped' || t === 'create:mechanical_crafting') {
    const { inputs, cells } = parseShaped(raw);
    base.inputs = inputs;
    base.cells = cells;
    base.outputs = parseOutputs(raw.result);
  } else if (t === 'minecraft:crafting_shapeless') {
    const { items, failed } = parseList(raw.ingredients);
    base.inputs = mergeIngredients(items);
    base.cells = items.length;
    base.outputs = parseOutputs(raw.result);
    partial = failed > 0;
  } else if (t in COOKING_DEFAULTS || t === 'minecraft:stonecutting') {
    const ing = parseIngredient(raw.ingredient);
    base.inputs = ing ? [ing] : [];
    base.outputs = parseOutputs(raw.result);
    if (typeof raw.result === 'string' && num(raw.count)) base.outputs[0].amount = num(raw.count)!;
    if (t in COOKING_DEFAULTS) base.duration = num(raw.cookingtime) ?? COOKING_DEFAULTS[t];
    partial = !ing;
  } else if (t === 'minecraft:smithing_transform' || t === 'minecraft:smithing_trim') {
    base.inputs = mergeIngredients(
      [raw.template, raw.base, raw.addition].map((r) => parseIngredient(r)).filter((i): i is IngredientRef => !!i),
    );
    base.outputs = parseOutputs(raw.result);
  } else if (t === 'create:sequenced_assembly') {
    return { recipe: parseSequenced(raw, base) };
  } else {
    // Generic processing shape used by Create and most add-ons.
    const ingRaw = raw.ingredients ?? (raw.ingredient !== undefined ? [raw.ingredient] : undefined);
    const { items, failed } = parseList(ingRaw);
    base.inputs = mergeIngredients(items);
    base.outputs = parseOutputs(raw.results ?? raw.result ?? raw.output ?? raw.outputs);
    partial = failed > 0;
  }
  const duration = num(raw.processing_time) ?? num(raw.processingTime);
  if (duration !== undefined) base.duration = duration;
  const heat = parseHeat(raw.heat_requirement ?? raw.heatRequirement);
  if (heat) base.heat = heat;
  return { recipe: base, partial: partial || base.outputs.length === 0 };
}
