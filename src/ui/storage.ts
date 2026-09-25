// Project persistence in IndexedDB (one object store, keyed by project id).

import { normalizeProject, type Project } from '../core/project';

const DB_NAME = 'createplanner';
const STORE = 'projects';
const LAST_KEY = 'createplanner:lastProject';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    t.oncomplete = () => db.close();
  });
}

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const all = await tx<Project[]>('readonly', (s) => s.getAll() as IDBRequest<Project[]>);
  return all
    .map((p) => ({ id: p.id, name: p.name, updatedAt: p.updatedAt }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function loadProject(id: string): Promise<Project | undefined> {
  const raw = await tx<unknown>('readonly', (s) => s.get(id));
  return raw ? normalizeProject(raw) : undefined;
}

export async function saveProject(p: Project): Promise<void> {
  await tx('readwrite', (s) => s.put(p));
  rememberLast(p.id);
}

export async function removeProject(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id));
}

export function rememberLast(id: string) {
  try {
    localStorage.setItem(LAST_KEY, id);
  } catch {
    /* storage unavailable: not critical */
  }
}

export function lastProjectId(): string | null {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}

export function downloadJson(filename: string, data: unknown) {
  downloadText(filename, JSON.stringify(data, null, 2), 'application/json');
}

export function downloadText(filename: string, text: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
