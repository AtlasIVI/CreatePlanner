# TASKS

Suivi du développement de CreatePlanner (Create 6.x, Minecraft 1.21.1, NeoForge).

## État actuel

À la demande, l'application est réduite à une grille 2D vide (taille réglable, mémorisée dans le navigateur).
Les fonctionnalités précédentes (jauges, écran façon jeu, adresses, simulation) sont retirées ; elles restent
récupérables dans l'historique git.

## Données conservées

- [x] `src/data/seed/` : objets, recettes, tags, noms FR/EN (vraies recettes Create 6 + vanilla)
- [x] `src/data/items.ts` : catalogue d'objets (noms, icônes, recettes de traitement)
- [x] `npm run import:mods` : lecture des jars + minecraft-data

## Découvertes utiles pour la suite

- Jauge d'usine (FactoryPanelBehaviour) : une requête toutes les 101 ticks tant que stock + promis < cible,
  entrées tout-ou-rien, adresse vide = aucun envoi, promesses 0 = 30 s / n = n min / -1 = jamais.
- Textes officiels FR de l'écran de jauge : clés `create.gui.factory_panel.*` dans `fr_fr.json` de Create.
- Modrinth est bloqué par le filtre réseau ; `maven.createmod.net` et GitHub sont accessibles.
