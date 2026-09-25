// Machine throughput and stress, driven entirely by machine data formulas.

import { bindLets, evaluate, type Env } from './expr';
import type { BlockCount, HeatLevel, KineticSourceDef, MachineDef, Recipe } from './types';

export const TICKS_PER_SECOND = 20;

export interface OpContext {
  /** Rotation speed (sign ignored). */
  rpm: number;
  /** Recipe duration in ticks; falls back to the machine default. */
  duration?: number;
  /** Items fed per operation (crushing wheels, fans). */
  batch?: number;
  /** Crafting cells (mechanical crafters). */
  cells?: number;
}

export function machineEnv(m: MachineDef, ctx: OpContext): Env {
  const env: Env = {
    rpm: m.kinetic ? Math.abs(ctx.rpm) : 0,
    duration: ctx.duration && ctx.duration > 0 ? ctx.duration : (m.speed.defaultDuration ?? 0),
    batch: Math.max(1, ctx.batch ?? m.speed.defaultBatch ?? 1),
    cells: Math.max(1, ctx.cells ?? 9),
  };
  return bindLets(m.speed.let, env);
}

export function ticksPerOperation(m: MachineDef, ctx: OpContext): number {
  return evaluate(m.speed.ticksPerOperation, machineEnv(m, ctx));
}

export function executionsPerOperation(m: MachineDef, ctx: OpContext): number {
  return m.speed.executionsPerOperation ? evaluate(m.speed.executionsPerOperation, machineEnv(m, ctx)) : 1;
}

/** Recipe executions per second for one machine. 0 when the machine cannot run. */
export function executionsPerSecond(m: MachineDef, ctx: OpContext): number {
  if (m.kinetic && (Math.abs(ctx.rpm) === 0 || belowMinRpm(m, ctx.rpm))) return 0;
  const t = ticksPerOperation(m, ctx);
  if (!(t > 0) || !Number.isFinite(t)) return 0;
  return (TICKS_PER_SECOND * executionsPerOperation(m, ctx)) / t;
}

export function belowMinRpm(m: MachineDef, rpm: number): boolean {
  return !!m.minRpm && Math.abs(rpm) < m.minRpm.value;
}

export function unitsPerMachine(m: MachineDef, ctx: OpContext): number {
  if (!m.unitsPerMachine) return 1;
  return evaluate(m.unitsPerMachine, { cells: Math.max(1, ctx.cells ?? 9) });
}

/** Stress impact in SU of one machine turning at rpm. */
export function stressPerMachine(m: MachineDef, ctx: OpContext): number {
  if (!m.kinetic) return 0;
  return m.stressImpact.value * unitsPerMachine(m, ctx) * Math.abs(ctx.rpm);
}

export function recipeContext(r: Recipe | undefined, rpm: number, batch?: number): OpContext {
  return { rpm, duration: r?.duration, batch, cells: r?.cells };
}

/** Blocks for n machines, including heat sources. */
export function machineBlocks(m: MachineDef, n: number, ctx: OpContext, heat?: HeatLevel): BlockCount[] {
  const units = unitsPerMachine(m, ctx);
  const out: BlockCount[] = m.blocks.map((b) => ({ id: b.id, count: b.count * units * n }));
  for (const b of (heat && m.heatBlocks?.[heat]) || []) out.push({ id: b.id, count: b.count * n });
  return out;
}

/** True when any value used for this machine is not verified against a source. */
export function machineUnverified(m: MachineDef): boolean {
  return !m.speed.verified || !m.stressImpact.verified || (!!m.minRpm && !m.minRpm.verified);
}

// ---------------------------------------------------------------------------
// Kinetic sources
// ---------------------------------------------------------------------------

export interface SourceOutput {
  rpm: number;
  /** Total stress capacity in SU. */
  capacity: number;
  blocks: BlockCount[];
}

export function sourceParams(def: KineticSourceDef, params?: Record<string, number>): Env {
  const env: Env = {};
  for (const p of def.params ?? []) {
    const v = params?.[p.name] ?? p.default;
    env[p.name] = Math.min(p.max, Math.max(p.min, v));
  }
  return env;
}

export function sourceOutput(def: KineticSourceDef, params?: Record<string, number>): SourceOutput {
  const env = bindLets(def.let, sourceParams(def, params));
  const rpm = evaluate(def.rpm, env);
  const full = { ...env, rpm };
  const capacity = evaluate(def.capacity, full);
  const blocks = def.blocks.map((b) => ({
    id: b.id,
    count: typeof b.count === 'number' ? b.count : Math.ceil(evaluate(b.count, full)),
  }));
  return { rpm, capacity, blocks };
}

export interface SourceSuggestion {
  source: KineticSourceDef;
  count: number;
  output: SourceOutput;
}

/** How many of each source type (default parameters) cover a stress load. */
export function suggestSources(sources: KineticSourceDef[], loadSU: number): SourceSuggestion[] {
  if (loadSU <= 0) return [];
  return sources
    .map((source) => {
      const output = sourceOutput(source);
      return { source, output, count: output.capacity > 0 ? Math.ceil(loadSU / output.capacity) : Infinity };
    })
    .filter((s) => Number.isFinite(s.count))
    .sort((a, b) => a.count - b.count);
}
