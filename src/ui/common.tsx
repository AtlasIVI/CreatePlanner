import { useMemo, useRef, useState } from 'react';
import type { Id } from '../core/types';
import { catalog, catalogList, itemName } from '../data/items';

const hue = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

export function ItemIcon({ id, size = 20 }: { id: Id | null; size?: number }) {
  if (!id) return <span className="icon icon-empty" style={{ width: size, height: size }} aria-hidden />;
  const url = catalog.get(id)?.icon;
  if (url) return <img className="icon" src={url} width={size} height={size} alt="" />;
  return (
    <span className="icon icon-fallback" style={{ width: size, height: size, background: `hsl(${hue(id)} 35% 38%)`, fontSize: size * 0.55 }} aria-hidden>
      {itemName(id).charAt(0).toUpperCase()}
    </span>
  );
}

export function ItemPicker({ value, onChange, placeholder = 'Chercher un objet…' }: { value: Id | null; onChange: (id: Id) => void; placeholder?: string }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = s ? catalogList.filter((i) => i.fr.toLowerCase().includes(s) || i.en.toLowerCase().includes(s) || i.id.includes(s)) : catalogList;
    return list.slice(0, 60);
  }, [q]);
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
        value={open ? q : value ? itemName(value) : ''}
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
            <li key={m.id} role="option" aria-selected={m.id === value} onMouseDown={() => choose(m.id)}>
              <ItemIcon id={m.id} />
              <span>{m.fr}</span>
              <code className="muted">{m.id.replace(/^minecraft:/, '')}</code>
            </li>
          ))}
          {matches.length === 0 && <li className="muted">Aucun résultat</li>}
        </ul>
      )}
    </div>
  );
}

export function Num({ value, onChange, min, max, step = 1, width = 72, label }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; width?: number; label?: string }) {
  return (
    <input
      type="number"
      style={{ width }}
      value={Number.isFinite(value) ? value : ''}
      min={min}
      max={max}
      step={step}
      aria-label={label}
      onChange={(e) => {
        let v = e.target.valueAsNumber;
        if (!Number.isFinite(v)) return;
        if (min !== undefined) v = Math.max(min, v);
        if (max !== undefined) v = Math.min(max, v);
        onChange(v);
      }}
    />
  );
}

export const fmt = (n: number) => (Number.isFinite(n) ? (Math.round(n * 10) / 10).toLocaleString('fr-FR') : '∞');
export const fmtTime = (ticks: number) => {
  const s = Math.floor(ticks / 20);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
