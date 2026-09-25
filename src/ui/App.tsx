import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { emptyProject, normalizeProject, type Project } from '../core/project';
import { buildDataSet } from '../core/registry';
import { loadMods } from '../data/loader';
import { machineFiles } from '../data/machineFiles';
import { Ctx } from './context';
import { DataView } from './DataView';
import { PlannerView } from './PlannerView';
import {
  downloadJson,
  lastProjectId,
  listProjects,
  loadProject,
  removeProject,
  saveProject,
  type ProjectSummary,
} from './storage';

const loaded = loadMods();
const allMods = loaded.mods.map((m) => m.mod);

type Tab = 'plan' | 'data';
const TABS: { id: Tab; label: string }[] = [
  { id: 'plan', label: 'Production' },
  { id: 'data', label: 'Données & mods' },
];

export function App() {
  const [project, setProject] = useState<Project>(() => emptyProject());
  const [tab, setTab] = useState<Tab>('plan');
  const [saved, setSaved] = useState<'saved' | 'saving' | 'error'>('saved');
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const ready = useRef(false);

  // Load the last project on start.
  useEffect(() => {
    (async () => {
      try {
        const id = lastProjectId();
        const p = id ? await loadProject(id) : undefined;
        if (p) setProject(p);
        setProjects(await listProjects());
      } catch {
        setSaved('error');
      } finally {
        ready.current = true;
      }
    })();
  }, []);

  // Autosave (debounced).
  useEffect(() => {
    if (!ready.current) return;
    setSaved('saving');
    const t = setTimeout(async () => {
      try {
        await saveProject(project);
        setProjects(await listProjects());
        setSaved('saved');
      } catch {
        setSaved('error');
      }
    }, 400);
    return () => clearTimeout(t);
  }, [project]);

  const update = useCallback((fn: (p: Project) => Project) => {
    setProject((p) => ({ ...fn(p), updatedAt: new Date().toISOString() }));
  }, []);

  const ds = useMemo(() => buildDataSet(loaded.mods, machineFiles, project.enabledMods ?? undefined), [project.enabledMods]);
  const ctx = useMemo(() => ({ ds, lang: project.lang, project, update, origin: loaded.origin }), [ds, project, update]);

  const fileInput = useRef<HTMLInputElement>(null);
  const importFile = async (f: File) => {
    try {
      const p = normalizeProject(JSON.parse(await f.text()));
      // Imported projects get a fresh id so they never overwrite an existing one.
      setProject({ ...p, id: emptyProject().id, updatedAt: new Date().toISOString() });
    } catch (e) {
      alert(`Import impossible : ${(e as Error).message}`);
    }
  };

  const views: Record<Tab, ReactNode> = {
    plan: <PlannerView />,
    data: <DataView allMods={allMods} />,
  };

  return (
    <Ctx.Provider value={ctx}>
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden>
            ⚙
          </span>
          <strong>Create Planner</strong>
        </div>
        <input
          className="project-name"
          value={project.name}
          onChange={(e) => update((p) => ({ ...p, name: e.target.value }))}
          aria-label="Nom du projet"
        />
        <select
          aria-label="Ouvrir un projet"
          value={project.id}
          onChange={async (e) => {
            const p = await loadProject(e.target.value);
            if (p) setProject(p);
          }}
        >
          {!projects.some((x) => x.id === project.id) && <option value={project.id}>{project.name}</option>}
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button onClick={() => setProject(emptyProject())}>Nouveau</button>
        <button
          className="ghost"
          onClick={async () => {
            if (!confirm(`Supprimer le projet « ${project.name} » de ce navigateur ?`)) return;
            await removeProject(project.id);
            const list = await listProjects();
            setProjects(list);
            const next = list[0] ? await loadProject(list[0].id) : undefined;
            setProject(next ?? emptyProject());
          }}
        >
          Supprimer
        </button>
        <button onClick={() => downloadJson(`${project.name.replace(/[^\w-]+/g, '_') || 'projet'}.createplan.json`, project)}>Exporter JSON</button>
        <button onClick={() => fileInput.current?.click()}>Importer JSON</button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importFile(f);
            e.target.value = '';
          }}
        />
        <div className="lang" role="group" aria-label="Langue des objets">
          {(['fr', 'en'] as const).map((l) => (
            <button key={l} className={project.lang === l ? 'active' : 'ghost'} onClick={() => update((p) => ({ ...p, lang: l }))}>
              {l.toUpperCase()}
            </button>
          ))}
        </div>
        <span className={`save ${saved}`}>{saved === 'saved' ? 'Enregistré' : saved === 'saving' ? 'Enregistrement…' : 'Erreur de sauvegarde'}</span>
      </header>
      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
      <main>{views[tab]}</main>
    </Ctx.Provider>
  );
}
