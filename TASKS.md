# TASKS

Suivi du développement de CreatePlanner (Create 6.x, Minecraft 1.21.1, NeoForge).

## État actuel

Les fonctionnalités (calculateur, logistique, liste de matériaux, grille, interface) ont été retirées à la demande.
Restent uniquement les données des objets et l'outil qui les produit :

- [x] `src/data/seed/` : objets, recettes, tags et noms FR/EN (vraies recettes Create 6 + vanilla)
- [x] `src/core/types.ts` : format des données (Item, Tag, Recipe, ModData)
- [x] `npm run import:mods` : lecture des jars (recettes, tags, noms, icônes) + minecraft-data, rapport des types de recettes
- [x] Squelette Vite + React (page affichant le nombre d'objets et de recettes)

Le code supprimé reste récupérable dans l'historique git (commits avant « Remove planner features »).

## Découvertes utiles pour la suite

- Données vanilla : PrismarineJS minecraft-data (1.21.1) + noms officiels FR/EN via le dépôt InventivetalentDev/minecraft-assets.
- Recettes Create 6 : dossier `recipe` (singulier), résultats `{ id, count, chance }`, fluides NeoForge
  (`neoforge:single` / `neoforge:tag` avec `amount`), assemblage séquencé avec poids de résultats (`chance` = poids).
- Modrinth (`api.modrinth.com`) est bloqué par le filtre FortiGuard de ce réseau ; `maven.createmod.net` et GitHub sont accessibles.
