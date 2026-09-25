import { createContext, useContext } from 'react';
import type { Project } from '../core/project';
import type { DataSet } from '../core/registry';
import type { Lang } from '../core/types';

export interface AppCtx {
  ds: DataSet;
  lang: Lang;
  project: Project;
  update: (fn: (p: Project) => Project) => void;
  origin: 'generated' | 'seed';
}

export const Ctx = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('App context missing');
  return c;
}
