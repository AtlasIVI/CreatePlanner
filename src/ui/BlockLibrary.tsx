import { useMemo, useState } from 'react';
import { blockLibrary, blockLibraryVersion } from '../data/blocks';
import { BlockIcon } from './BlockIcon';

export function BlockLibrary() {
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return blockLibrary;
    return blockLibrary.filter((b) => (b.fr ?? '').toLowerCase().includes(s) || b.en.toLowerCase().includes(s) || b.id.includes(s));
  }, [q]);

  return (
    <aside className="library">
      <h2>Blocs Minecraft {blockLibraryVersion ?? ''}</h2>
      {blockLibrary.length === 0 ? (
        <p className="muted">
          Bibliothèque vide : lancez <code>npm run import:blocks</code> puis rechargez la page.
        </p>
      ) : (
        <>
          <input className="search" value={q} placeholder="Chercher un bloc…" onChange={(e) => setQ(e.target.value)} aria-label="Chercher un bloc" />
          <p className="muted small">
            {list.length} / {blockLibrary.length} blocs
          </p>
          <ul className="block-list">
            {list.map((b) => {
              const name = b.fr ?? b.en;
              return (
                <li key={b.id} title={`${name}\n${b.en}\n${b.id}`}>
                  <BlockIcon icon={b.icon} label={name} />
                  <span className="block-name">{name}</span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </aside>
  );
}
