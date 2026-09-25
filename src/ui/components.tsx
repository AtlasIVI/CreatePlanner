import { useMemo, useRef, useState, type ReactNode } from 'react';
import { itemName, namespaceOf } from '../core/registry';
import type { Id, Names, Sourced } from '../core/types';
import { useApp } from './context';

const hue = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

export function ItemIcon({ id, size = 20 }: { id: Id; size?: number }) {
  const { ds } = useApp();
  const url = ds.iconUrls[id];
  if (url) return <img className="icon" src={url} width={size} height={size} alt="" />;
  const name = id.split(':')[1] ?? id;
  return (
    <span className="icon icon-fallback" style={{ width: size, height: size, background: `hsl(${hue(id)} 35% 38%)` }} aria-hidden>
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

export function ItemName({ id, showId = false }: { id: Id; showId?: boolean }) {
  const { ds, lang } = useApp();
  return (
    <span className="item-name" title={id}>
      <ItemIcon id={id} />
      <span>{itemName(ds, id, lang)}</span>
      {showId && <code className="muted">{id}</code>}
    </span>
  );
}

export function nameOf(names: Names, lang: 'fr' | 'en'): string {
  return names[lang] ?? names.en ?? names.fr ?? '?';
}

/** Marker for values not checked against a source. */
export function Unverified({ source, note }: { source?: string; note?: string }) {
  return (
    <span className="unverified" title={`Valeur non vérifiée${note ? ` — ${note}` : ''}${source ? `\nSource : ${source}` : ''}`}>
      ⚠ non vérifié
    </span>
  );
}

export function SourcedValue({ v, unit }: { v: Sourced<number>; unit?: string }) {
  return (
    <span title={`${v.source}${v.note ? `\n${v.note}` : ''}`}>
      {v.value}
      {unit ? ` ${unit}` : ''} {!v.verified && <Unverified source={v.source} note={v.note} />}
    </span>
  );
}

export function ItemPicker({
  value,
  onChange,
  placeholder = 'Chercher un objet…',
  filter,
}: {
  value: Id | null;
  onChange: (id: Id) => void;
  placeholder?: string;
  filter?: (id: Id) => boolean;
}) {
  const { ds, lang } = useApp();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const all = useMemo(() => {
    const list = [...ds.items.values()]
      .filter((i) => !filter || filter(i.id))
      .map((i) => ({ id: i.id, name: itemName(ds, i.id, lang), other: itemName(ds, i.id, lang === 'fr' ? 'en' : 'fr') }));
    return list.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  }, [ds, lang, filter]);
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return all.slice(0, 60);
    return all
      .filter((i) => i.name.toLowerCase().includes(s) || i.other.toLowerCase().includes(s) || i.id.includes(s))
      .slice(0, 60);
  }, [all, q]);
  const input = useRef<HTMLInputElement>(null);
  const openList = () => {
    if (!open) {
      setQ('');
      setOpen(true);
    }
  };
  const choose = (id: Id) => {
    onChange(id);
    setOpen(false);
    input.current?.blur();
  };
  return (
    <div className="picker">
      <input
        ref={input}
        value={open ? q : value ? itemName(ds, value, lang) : ''}
        placeholder={placeholder}
        onFocus={openList}
        onClick={openList}
        onBlur={() => setOpen(false)}
        onChange={(e) => {
          setOpen(true);
          setQ(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && matches[0]) choose(matches[0].id);
          if (e.key === 'Escape') input.current?.blur();
        }}
        aria-label={placeholder}
      />
      {open && (
        <ul className="picker-list" role="listbox" onMouseDown={(e) => e.preventDefault()}>
          {matches.map((m) => (
            <li
              key={m.id}
              role="option"
              aria-selected={m.id === value}
              // mousedown (not click) so the choice lands before the input blurs
              onMouseDown={(e) => {
                e.preventDefault();
                choose(m.id);
              }}
            >
              <ItemIcon id={m.id} />
              <span>{m.name}</span>
              <code className="muted">{namespaceOf(m.id) === 'minecraft' ? m.id.slice(10) : m.id}</code>
            </li>
          ))}
          {matches.length === 0 && <li className="muted">Aucun résultat</li>}
        </ul>
      )}
    </div>
  );
}

export function NumberField({
  value,
  onChange,
  min,
  max,
  step,
  label,
  width = 80,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  width?: number;
}) {
  return (
    <input
      type="number"
      aria-label={label}
      title={label}
      style={{ width }}
      value={Number.isFinite(value) ? value : ''}
      min={min}
      max={max}
      step={step ?? 'any'}
      onChange={(e) => {
        const v = e.target.valueAsNumber;
        if (Number.isFinite(v)) onChange(max !== undefined ? Math.min(max, min !== undefined ? Math.max(min, v) : v) : v);
      }}
    />
  );
}

export function Section({ title, children, actions }: { title: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="card">
      <header className="card-head">
        <h2>{title}</h2>
        {actions && <div className="actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: 'ok' | 'bad' | 'warn' }) {
  return (
    <div className={`stat ${tone ?? ''}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
