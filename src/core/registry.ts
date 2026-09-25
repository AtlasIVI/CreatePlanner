// Builds a queryable data set from mod data + machine files, honouring the enabled-mod list.

import type {
  Id,
  IngredientRef,
  ItemDef,
  KineticSourceDef,
  Lang,
  LogisticsConstant,
  MachineDef,
  MachineFile,
  ModData,
  ModInfo,
  PlaceableDef,
  Recipe,
  Sourced,
  TagMap,
} from './types';

export interface RegistryItem extends ItemDef {
  mod: string;
}

export interface DataSet {
  mods: ModInfo[];
  enabledMods: Set<string>;
  items: Map<Id, RegistryItem>;
  lang: Partial<Record<Lang, Record<Id, string>>>;
  tags: TagMap;
  recipes: Recipe[];
  recipeById: Map<Id, Recipe>;
  recipesByOutput: Map<Id, Recipe[]>;
  machines: MachineDef[];
  machineById: Map<Id, MachineDef>;
  machinesByType: Map<Id, MachineDef[]>;
  sources: KineticSourceDef[];
  placeables: PlaceableDef[];
  logistics: Record<string, LogisticsConstant>;
  rawByDefault: Set<Id>;
  handCraftTypes: Set<Id>;
  maxRpm: Sourced<number>;
  iconUrls: Record<Id, string>;
  /** Pairs "a>b" for single-ingredient recipes turning a into b (reversibility check). */
  conversions: Set<string>;
}

export const ALWAYS_ENABLED = 'minecraft';

const DEFAULT_MAX_RPM: Sourced<number> = { value: 256, source: 'Create default maxRotationSpeed', verified: false };

export function namespaceOf(id: Id): string {
  const i = id.indexOf(':');
  return i < 0 ? 'minecraft' : id.slice(0, i);
}

export function pathOf(id: Id): string {
  const i = id.indexOf(':');
  return i < 0 ? id : id.slice(i + 1);
}

/** Resolve a tag to concrete ids (recursive, cycle-safe). */
export function resolveTag(tags: TagMap, tag: Id, seen = new Set<Id>()): Id[] {
  if (seen.has(tag)) return [];
  seen.add(tag);
  const out: Id[] = [];
  for (const m of tags[tag] ?? []) {
    if (m.startsWith('#')) out.push(...resolveTag(tags, m.slice(1), seen));
    else out.push(m);
  }
  return [...new Set(out)];
}

export function buildDataSet(mods: ModData[], machineFiles: MachineFile[], enabled?: Iterable<string>): DataSet {
  const enabledMods = new Set<string>(enabled ?? mods.map((m) => m.mod.id));
  enabledMods.add(ALWAYS_ENABLED);
  const isOn = (mod: string) => enabledMods.has(mod);

  const items = new Map<Id, RegistryItem>();
  const lang: DataSet['lang'] = { en: {}, fr: {} };
  const tags: TagMap = {};
  const recipes: Recipe[] = [];
  const iconUrls: Record<Id, string> = {};

  for (const m of mods) {
    // Tags from every loaded mod stay available (a tag like c:ingots/zinc is shared),
    // but members belonging to disabled mods are filtered out below.
    for (const [tag, members] of Object.entries(m.tags)) {
      tags[tag] = [...new Set([...(tags[tag] ?? []), ...members])];
    }
    if (!isOn(m.mod.id)) continue;
    for (const it of m.items) {
      if (!items.has(it.id)) items.set(it.id, { ...it, mod: m.mod.id });
    }
    for (const l of ['en', 'fr'] as const) Object.assign(lang[l]!, m.lang[l] ?? {});
    Object.assign(iconUrls, m.iconUrls ?? {});
    for (const r of m.recipes) {
      if (r.requiresMods && !r.requiresMods.every(isOn)) continue;
      recipes.push(r);
    }
  }
  const itemEnabled = (id: Id) => isOn(namespaceOf(id)) || items.has(id);
  for (const tag of Object.keys(tags)) {
    tags[tag] = tags[tag].filter((m) => m.startsWith('#') || itemEnabled(m));
  }

  // Recipes referencing items that no mod declared still get a placeholder item.
  const recipeById = new Map<Id, Recipe>();
  const recipesByOutput = new Map<Id, Recipe[]>();
  for (const r of recipes) {
    if (r.outputs.some((o) => !itemEnabled(o.id))) continue;
    recipeById.set(r.id, r);
    for (const o of r.outputs) {
      if (!items.has(o.id)) items.set(o.id, { id: o.id, kind: o.kind, mod: namespaceOf(o.id) });
      const list = recipesByOutput.get(o.id) ?? [];
      if (!list.includes(r)) list.push(r);
      recipesByOutput.set(o.id, list);
    }
    for (const i of r.inputs) {
      if (i.id && !items.has(i.id)) items.set(i.id, { id: i.id, kind: i.kind, mod: namespaceOf(i.id) });
    }
  }

  const files = machineFiles.filter((f) => isOn(f.namespace));
  const machines = files.flatMap((f) => f.machines ?? []);
  const machineById = new Map(machines.map((m) => [m.id, m]));
  const machinesByType = new Map<Id, MachineDef[]>();
  for (const m of machines) {
    for (const t of m.recipeTypes) {
      const list = machinesByType.get(t) ?? [];
      list.push(m);
      machinesByType.set(t, list);
    }
  }
  const logistics: Record<string, LogisticsConstant> = {};
  for (const f of files) Object.assign(logistics, f.logistics ?? {});

  const rawByDefault = new Set<Id>();
  for (const f of files) {
    for (const entry of f.rawByDefault ?? []) {
      if (entry.startsWith('#')) for (const id of resolveTag(tags, entry.slice(1))) rawByDefault.add(id);
      else rawByDefault.add(entry);
    }
  }

  const ds: DataSet = {
    mods: mods.map((m) => m.mod),
    enabledMods,
    items,
    lang,
    tags,
    recipes: [...recipeById.values()],
    recipeById,
    recipesByOutput,
    machines,
    machineById,
    machinesByType,
    sources: files.flatMap((f) => f.sources ?? []),
    placeables: files.flatMap((f) => f.placeables ?? []),
    logistics,
    rawByDefault,
    handCraftTypes: new Set(files.flatMap((f) => f.handCraftTypes ?? [])),
    maxRpm: files.find((f) => f.maxRpm)?.maxRpm ?? DEFAULT_MAX_RPM,
    iconUrls,
    conversions: new Set(),
  };
  for (const r of ds.recipes) {
    const kinds = r.inputs.filter((i) => i.kind === 'item');
    if (kinds.length !== 1 || r.outputs.length !== 1) continue;
    const from = concreteIds(ds, kinds[0]);
    for (const f of from) ds.conversions.add(`${f}>${r.outputs[0].id}`);
  }
  return ds;
}

/** All concrete ids an ingredient accepts. */
export function concreteIds(ds: Pick<DataSet, 'tags'>, ing: IngredientRef): Id[] {
  if (ing.id) return [ing.id, ...(ing.alternatives ?? [])];
  if (ing.tag) return resolveTag(ds.tags, ing.tag);
  return [];
}

/** Default concrete item for a tag: raw resources first, then vanilla, then anything. */
export function defaultTagMember(ds: DataSet, tag: Id): Id | undefined {
  const members = resolveTag(ds.tags, tag);
  return (
    members.find((m) => ds.rawByDefault.has(m)) ??
    members.find((m) => namespaceOf(m) === 'minecraft') ??
    members[0]
  );
}

export function itemName(ds: Pick<DataSet, 'lang'>, id: Id, lang: Lang): string {
  const other: Lang = lang === 'fr' ? 'en' : 'fr';
  return ds.lang[lang]?.[id] ?? ds.lang[other]?.[id] ?? prettify(id);
}

export function prettify(id: Id): string {
  const p = pathOf(id).split('/').pop() ?? id;
  return p.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function tagLabel(tag: Id): string {
  return `#${tag}`;
}
