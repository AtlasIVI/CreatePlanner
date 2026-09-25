// Core domain model. Pure data types: no React, no browser APIs.
// Every id is namespaced ("create:mechanical_press", "c:ingots/iron").

export type Id = string;
export type Lang = 'en' | 'fr';
export type Names = Partial<Record<Lang, string>>;
export type StackKind = 'item' | 'fluid';
export type HeatLevel = 'none' | 'heated' | 'superheated';

/** A numeric game value with its provenance. */
export interface Sourced<T = number> {
  value: T;
  /** URL or source-file path the value comes from. */
  source: string;
  verified: boolean;
  note?: string;
}

// ---------------------------------------------------------------------------
// Mod data (importer output / seed data)
// ---------------------------------------------------------------------------

export interface ItemDef {
  id: Id;
  kind: StackKind;
  stackSize?: number;
  /** Icon file name inside the mod's icons/ folder. */
  icon?: string;
}

/** Tag id -> members. A member starting with '#' is another tag. */
export type TagMap = Record<Id, Id[]>;

/** lang -> item id -> display name */
export type LangMap = Partial<Record<Lang, Record<Id, string>>>;

export interface IngredientRef {
  kind: StackKind;
  /** Concrete item/fluid. Exactly one of id / tag is set. */
  id?: Id;
  tag?: Id;
  /** Other acceptable concrete ids (ingredient given as a list). */
  alternatives?: Id[];
  /** Item count, or fluid amount in mB. */
  amount: number;
}

export interface OutputStack {
  kind: StackKind;
  id: Id;
  /** Item count, or fluid amount in mB. */
  amount: number;
  /** 0..1 probability. 1 when guaranteed. */
  chance: number;
}

/** One step of a sequenced (looped) recipe. Inputs exclude the transitional item. */
export interface SequenceStep {
  type: Id;
  inputs: IngredientRef[];
  duration?: number;
}

export interface Recipe {
  id: Id;
  type: Id;
  /** Mod (jar) the recipe was read from. */
  mod: string;
  inputs: IngredientRef[];
  outputs: OutputStack[];
  /** processing_time / cookingtime in ticks when the recipe defines one. */
  duration?: number;
  heat?: HeatLevel;
  /** Number of filled crafting-grid cells (shaped/mechanical crafting). */
  cells?: number;
  sequence?: SequenceStep[];
  loops?: number;
  transitional?: Id;
  /** Mod ids that must be enabled for the recipe to exist (neoforge:mod_loaded). */
  requiresMods?: string[];
}

export interface ModInfo {
  id: string;
  name: string;
  version?: string;
  source: 'seed' | 'jar' | 'minecraft-data';
}

export interface ModData {
  mod: ModInfo;
  items: ItemDef[];
  tags: TagMap;
  lang: LangMap;
  recipes: Recipe[];
  /** item id -> icon URL, filled in by the app loader. */
  iconUrls?: Record<Id, string>;
}

// ---------------------------------------------------------------------------
// Machine data (hand-written data/machines/<namespace>.json)
// ---------------------------------------------------------------------------

/**
 * Throughput model expressed with small formulas (see expr.ts) so that add-ons
 * can describe their machines in JSON without code changes.
 * Variables available: rpm (absolute), duration (recipe or default ticks),
 * batch (items fed per operation), cells (crafting cells) and any `let` binding.
 */
export interface SpeedModel {
  /** Ordered helper bindings evaluated before the main formulas. */
  let?: Record<string, string>;
  ticksPerOperation: string;
  /** Recipe executions completed per operation. Default "1". */
  executionsPerOperation?: string;
  defaultDuration?: number;
  defaultBatch?: number;
  source: string;
  verified: boolean;
  note?: string;
}

export interface BlockCount {
  id: Id;
  count: number;
}

/** Block count that may be a formula over the owner's parameters (sources). */
export interface FormulaBlockCount {
  id: Id;
  count: number | string;
}

export type Axis = 'x' | 'y' | 'z';

export type KineticShape =
  | 'none'
  | 'shaft' // shafts on both faces along its axis
  | 'half_shaft' // a single shaft face (the block's facing)
  | 'cog' // small cogwheel (meshes) + shafts along its axis
  | 'large_cog'
  | 'gearbox'
  | 'belt';

export interface MachineDef {
  id: Id;
  names: Names;
  recipeTypes: Id[];
  /** Manual workstations (crafting table...) have no kinetic behaviour. */
  kinetic: boolean;
  manual?: boolean;
  /** Blocks placed per machine unit. */
  blocks: BlockCount[];
  /** Extra blocks per heat level. */
  heatBlocks?: Partial<Record<HeatLevel, BlockCount[]>>;
  /** Stress impact in SU per RPM, for one machine unit. */
  stressImpact: Sourced<number>;
  /** Units per machine as a formula (mechanical crafters: "cells"). Default "1". */
  unitsPerMachine?: string;
  minRpm?: Sourced<number>;
  speed: SpeedModel;
  /** Machine made of other machines (sequenced assembly): the calculator expands its steps. */
  composite?: boolean;
  /** Block placed on the grid and its kinetic behaviour. */
  gridBlock?: Id;
  shape?: KineticShape;
  /** For 'cog' shapes: which axis faces carry a shaft ('+', '-'). Default both. */
  cogShaftFaces?: ('+' | '-')[];
  /** Fixed axis on the grid (mixer and millstone are always vertical). */
  axis?: Axis;
  note?: string;
}

export interface SourceParam {
  name: string;
  label: Names;
  default: number;
  min: number;
  max: number;
  step?: number;
}

export interface KineticSourceDef {
  id: Id;
  names: Names;
  blocks: FormulaBlockCount[];
  params?: SourceParam[];
  let?: Record<string, string>;
  /** Generated RPM (formula). */
  rpm: string;
  /** Total stress capacity in SU (formula; may use rpm). */
  capacity: string;
  source: string;
  verified: boolean;
  note?: string;
  gridBlock?: Id;
  shape?: KineticShape;
}

/** Non-machine blocks placeable on the grid. */
export interface PlaceableDef {
  id: Id;
  names: Names;
  shape: KineticShape;
  category: 'kinetic' | 'logistics' | 'other';
  stressImpact?: Sourced<number>;
  /** Item consumed per placed block when it differs from the block id (belt -> belt connector). */
  material?: { id: Id; perBlock: Sourced<number> };
}

/** Numeric logistics constants (packager cycle, gauge timer...). */
export interface LogisticsConstant extends Sourced<number> {
  names: Names;
  unit: string;
}

export interface MachineFile {
  namespace: string;
  machines?: MachineDef[];
  sources?: KineticSourceDef[];
  placeables?: PlaceableDef[];
  logistics?: Record<string, LogisticsConstant>;
  /** Items (or #tags) treated as raw resources unless the user picks a recipe. */
  rawByDefault?: Id[];
  /** Recipe types a player does by hand: preferred for material lists, avoided by the planner. */
  handCraftTypes?: Id[];
  /** Absolute speed limit applied everywhere. */
  maxRpm?: Sourced<number>;
}
