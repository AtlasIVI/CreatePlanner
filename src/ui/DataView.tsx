import { useMemo } from 'react';
import { machineUnverified } from '../core/machines';
import type { Sourced } from '../core/types';
import { Section, Unverified, nameOf } from './components';
import { useApp } from './context';

interface Row {
  owner: string;
  what: string;
  value: string;
  v: Pick<Sourced, 'source' | 'verified' | 'note'>;
}

export function DataView({ allMods }: { allMods: { id: string; name: string; version?: string; source: string }[] }) {
  const { ds, lang, project, update, origin } = useApp();
  const enabled = project.enabledMods ?? allMods.map((m) => m.id);
  const toggle = (id: string) =>
    update((p) => {
      const cur = new Set(p.enabledMods ?? allMods.map((m) => m.id));
      if (cur.has(id)) cur.delete(id);
      else cur.add(id);
      return { ...p, enabledMods: [...cur] };
    });

  const rows = useMemo(() => {
    const out: Row[] = [];
    for (const m of ds.machines) {
      const n = nameOf(m.names, lang);
      out.push({ owner: n, what: 'Impact (SU/tr/min)', value: String(m.stressImpact.value), v: m.stressImpact });
      out.push({ owner: n, what: 'Temps de cycle', value: m.speed.ticksPerOperation, v: m.speed });
      if (m.minRpm) out.push({ owner: n, what: 'Vitesse minimale', value: `${m.minRpm.value} tr/min`, v: m.minRpm });
    }
    for (const s of ds.sources) out.push({ owner: nameOf(s.names, lang), what: 'Vitesse / capacité', value: `${s.rpm} · ${s.capacity}`, v: s });
    for (const p of ds.placeables) {
      if (p.stressImpact) out.push({ owner: nameOf(p.names, lang), what: 'Impact (SU/tr/min)', value: String(p.stressImpact.value), v: p.stressImpact });
      if (p.material) out.push({ owner: nameOf(p.names, lang), what: `Objets ${p.material.id} par bloc`, value: String(p.material.perBlock.value), v: p.material.perBlock });
    }
    for (const [k, c] of Object.entries(ds.logistics)) out.push({ owner: nameOf(c.names, lang), what: k, value: `${c.value} ${c.unit}`, v: c });
    return out;
  }, [ds, lang]);
  const unverified = rows.filter((r) => !r.v.verified);

  return (
    <div className="view">
      <Section title="Mods chargés">
        <p className="muted small">
          Données : {origin === 'generated' ? 'importées (data/generated)' : 'jeu de données de démonstration (seed) — lancez npm run import:mods'}.
        </p>
        <ul className="mods">
          {allMods.map((m) => (
            <li key={m.id}>
              <label>
                <input
                  type="checkbox"
                  checked={m.id === 'minecraft' || enabled.includes(m.id)}
                  disabled={m.id === 'minecraft'}
                  onChange={() => toggle(m.id)}
                />{' '}
                <strong>{m.name}</strong> <code className="muted">{m.id}</code> {m.version && <span className="muted">{m.version}</span>}{' '}
                <span className="tag">{m.source}</span>
              </label>
            </li>
          ))}
        </ul>
        <p className="muted small">
          {ds.recipes.length} recettes actives, {ds.items.size} objets, {ds.machines.length} machines modélisées.
        </p>
      </Section>

      <Section title={`Valeurs non vérifiées (${unverified.length})`}>
        <ValueTable rows={unverified} />
      </Section>

      <Section title="Toutes les valeurs de jeu et leurs sources">
        <ValueTable rows={rows} />
        <p className="muted small">
          Les machines sont décrites dans <code>data/machines/&lt;namespace&gt;.json</code>. Machines avec au moins une valeur non vérifiée :{' '}
          {ds.machines.filter(machineUnverified).map((m) => nameOf(m.names, lang)).join(', ') || 'aucune'}.
        </p>
      </Section>
    </div>
  );
}

function ValueTable({ rows }: { rows: Row[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Élément</th>
            <th>Valeur</th>
            <th>Formule / nombre</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>{r.owner}</td>
              <td>{r.what}</td>
              <td>
                <code>{r.value}</code> {!r.v.verified && <Unverified source={r.v.source} note={r.v.note} />}
              </td>
              <td className="small">
                {/^https?:/.test(r.v.source.split(' ')[0]) ? (
                  <a href={r.v.source.split(' ')[0]} target="_blank" rel="noreferrer">
                    {r.v.source.replace(/^https:\/\/github\.com\/Creators-of-Create\/Create\/blob\/mc1\.21\.1\/dev\/src\/main\/java\/com\/simibubi\/create\//, 'Create: ')}
                  </a>
                ) : (
                  r.v.source
                )}
                {r.v.note && <div className="muted">{r.v.note}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
