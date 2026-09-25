import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { seedMods } from './data/seed';

// Placeholder: the planner features were removed; only the item data remains.
function App() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24 }}>
      <h1>Create Planner</h1>
      <p>Données disponibles :</p>
      <ul>
        {seedMods.map((m) => (
          <li key={m.mod.id}>
            {m.mod.name} — {m.items.length} objets, {m.recipes.length} recettes
          </li>
        ))}
      </ul>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
