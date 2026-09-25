// Import report: which recipe types exist and whether a machine file models them.

import type { MachineFile, ModData } from '../../src/core/types';

export interface TypeReport {
  type: string;
  count: number;
  mods: string[];
  modelled: boolean;
  machines: string[];
  /** Recipes of this type whose inputs/outputs were only partly understood. */
  partial: number;
}

export interface ImportReport {
  generatedAt: string;
  mods: { id: string; name: string; version?: string; source: string; recipes: number; items: number; icons: number }[];
  types: TypeReport[];
  unmodelled: string[];
  errors: string[];
  warnings: string[];
}

export function recipeTypeReport(mods: ModData[], machineFiles: MachineFile[], partialIds: Set<string>): TypeReport[] {
  const machinesByType = new Map<string, string[]>();
  for (const f of machineFiles)
    for (const m of f.machines ?? [])
      for (const t of m.recipeTypes) machinesByType.set(t, [...(machinesByType.get(t) ?? []), m.id]);
  const byType = new Map<string, TypeReport>();
  for (const mod of mods) {
    for (const r of mod.recipes) {
      let t = byType.get(r.type);
      if (!t) {
        const machines = machinesByType.get(r.type) ?? [];
        t = { type: r.type, count: 0, mods: [], modelled: machines.length > 0, machines, partial: 0 };
        byType.set(r.type, t);
      }
      t.count++;
      if (!t.mods.includes(mod.mod.id)) t.mods.push(mod.mod.id);
      if (partialIds.has(r.id)) t.partial++;
    }
  }
  return [...byType.values()].sort((a, b) => Number(a.modelled) - Number(b.modelled) || b.count - a.count);
}
