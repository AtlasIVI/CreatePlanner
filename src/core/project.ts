// A saved plan: everything the user edits. Serialisable as JSON (import/export, IndexedDB).

import type { Id, Lang } from './types';

export type RateUnit = 's' | 'min' | 'h';

export interface PlannerState {
  target: Id | null;
  rate: number;
  rateUnit: RateUnit;
  rpm: number;
  recipeChoice: Record<Id, string>;
  machineChoice: Record<string, Id>;
  tagChoice: Record<Id, Id>;
  rpmOverride: Record<Id, number>;
  batch: Record<Id, number>;
}

export interface PlacedSource {
  id: string;
  sourceId: Id;
  count: number;
  params: Record<string, number>;
}

export interface GaugeInput {
  /** Upstream gauge module feeding this input, or null for an external/raw supply. */
  from: string | null;
  item: Id;
  /** Amount per request (one batch). */
  amount: number;
}

export type LinkKind = 'chain' | 'frogport' | 'belt' | 'direct';

export interface GaugeModule {
  id: string;
  name: string;
  mode: 'recipe' | 'restock';
  output: Id | null;
  /** Items promised per request (the gauge's "recipe output"). */
  outputPerRequest: number;
  targetStock: number;
  address: string;
  /** Promise timeout in seconds; null = never expires. */
  promiseTimeout: number | null;
  inputs: GaugeInput[];
  /** Crafts per second the attached machines can do (from the planner or typed in). */
  machineRate: number;
  /** How incoming packages reach this module. */
  link: { kind: LinkKind; rpm: number; length: number; frogports: number };
  /** External demand on this module's output, items/s (the factory's goal). */
  demand: number;
}

export interface LogisticsState {
  modules: GaugeModule[];
  /** Simulated duration in seconds. */
  horizon: number;
}

export type Facing = '+x' | '-x' | '+y' | '-y' | '+z' | '-z';

export interface PlacedBlock {
  block: Id;
  facing: Facing;
  /** Kinetic source parameters (windmill sails, engine count...). */
  params?: Record<string, number>;
  /** Machine recipe on the grid (for production readout). */
  recipe?: Id;
  reversed?: boolean;
}

export interface GridState {
  /** "x,y,z" -> block */
  cells: Record<string, PlacedBlock>;
  layer: number;
  width: number;
  depth: number;
}

export interface Project {
  version: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  /** null = every loaded mod. */
  enabledMods: string[] | null;
  lang: Lang;
  planner: PlannerState;
  sources: PlacedSource[];
  logistics: LogisticsState;
  /** Items already owned, subtracted from the material list. */
  stock: Record<Id, number>;
  /** Recipe choices for the material list (item -> recipe id or 'raw'). */
  materialChoice: Record<Id, string>;
  /** Which parts of the project feed the material list. */
  materialSources: { plan: boolean; sources: boolean; logistics: boolean; grid: boolean };
  grid: GridState;
}

export const RATE_FACTORS: Record<RateUnit, number> = { s: 1, min: 60, h: 3600 };

export function newId(prefix = 'p'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function emptyProject(name = 'Nouveau projet'): Project {
  const now = new Date().toISOString();
  return {
    version: 1,
    id: newId(),
    name,
    createdAt: now,
    updatedAt: now,
    enabledMods: null,
    lang: 'fr',
    planner: {
      target: null,
      rate: 60,
      rateUnit: 'min',
      rpm: 64,
      recipeChoice: {},
      machineChoice: {},
      tagChoice: {},
      rpmOverride: {},
      batch: {},
    },
    sources: [],
    logistics: { modules: [], horizon: 600 },
    stock: {},
    materialChoice: {},
    materialSources: { plan: true, sources: true, logistics: true, grid: true },
    grid: { cells: {}, layer: 0, width: 24, depth: 16 },
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Validate and fill defaults for a project coming from JSON (import or older saves). */
export function normalizeProject(raw: unknown): Project {
  if (!isObj(raw)) throw new Error('Projet invalide : objet JSON attendu');
  if (raw.version !== undefined && raw.version !== 1) throw new Error(`Version de projet non prise en charge : ${String(raw.version)}`);
  const base = emptyProject(typeof raw.name === 'string' ? raw.name : undefined);
  const p = raw as Partial<Project>;
  return {
    ...base,
    ...p,
    version: 1,
    id: typeof p.id === 'string' ? p.id : base.id,
    lang: p.lang === 'en' ? 'en' : 'fr',
    enabledMods: Array.isArray(p.enabledMods) ? p.enabledMods.filter((m) => typeof m === 'string') : null,
    planner: { ...base.planner, ...(isObj(p.planner) ? p.planner : {}) },
    sources: Array.isArray(p.sources) ? p.sources : [],
    logistics: { ...base.logistics, ...(isObj(p.logistics) ? p.logistics : {}) },
    stock: isObj(p.stock) ? (p.stock as Record<Id, number>) : {},
    materialChoice: isObj(p.materialChoice) ? (p.materialChoice as Record<Id, string>) : {},
    materialSources: { ...base.materialSources, ...(isObj(p.materialSources) ? p.materialSources : {}) },
    grid: { ...base.grid, ...(isObj(p.grid) ? p.grid : {}) },
  };
}

export function rateToPerSecond(rate: number, unit: RateUnit): number {
  return rate / RATE_FACTORS[unit];
}
