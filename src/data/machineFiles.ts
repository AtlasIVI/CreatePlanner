// Hand-written machine data (data/machines/<namespace>.json), bundled at build time.

import type { MachineFile } from '../core/types';
import create from '../../data/machines/create.json';
import minecraft from '../../data/machines/minecraft.json';

const extra = import.meta.glob<{ default: unknown }>('../../data/machines/*.json', { eager: true });

const known = new Map<string, MachineFile>([
  ['minecraft', minecraft as unknown as MachineFile],
  ['create', create as unknown as MachineFile],
]);
// Add-on machine files dropped next to the Create one are picked up automatically.
for (const mod of Object.values(extra)) {
  const f = mod.default as MachineFile;
  if (f?.namespace && !known.has(f.namespace)) known.set(f.namespace, f);
}

export const machineFiles: MachineFile[] = [...known.values()];
