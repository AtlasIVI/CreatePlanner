import { machinesFor } from '../core/calculator';
import { itemName } from '../core/registry';
import type { Recipe } from '../core/types';
import { nameOf } from './components';
import { useApp } from './context';
import { fmt } from './format';

export function useRecipeText() {
  const { ds, lang } = useApp();
  return (r: Recipe): string => {
    const m = machinesFor(ds, r.type)[0];
    const kind = m ? nameOf(m.names, lang) : `${r.type} (non modélisé)`;
    const ins = r.inputs
      .map((i) => `${fmt(i.amount)}${i.kind === 'fluid' ? ' mB' : '×'} ${i.id ? itemName(ds, i.id, lang) : `#${i.tag}`}`)
      .join(' + ');
    const outs = r.outputs
      .map((o) => `${fmt(o.amount)}${o.kind === 'fluid' ? ' mB' : '×'} ${itemName(ds, o.id, lang)}${o.chance < 1 ? ` (${fmt(o.chance * 100)} %)` : ''}`)
      .join(', ');
    return `${kind} : ${ins} → ${outs}`;
  };
}

export function RecipeLine({ recipe }: { recipe: Recipe }) {
  const text = useRecipeText();
  return <span className="recipe-line" title={recipe.id}>{text(recipe)}</span>;
}
