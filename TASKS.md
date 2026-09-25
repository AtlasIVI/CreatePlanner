# TASKS

Suivi du développement de CreatePlanner (Create 6.x, Minecraft 1.21.1, NeoForge).

## État actuel

Une grille 2D vide (taille réglable, mémorisée dans le navigateur) et, à côté, la bibliothèque des blocs vanilla.
Les fonctionnalités précédentes (jauges, écran façon jeu, adresses, simulation) sont retirées ; elles restent
récupérables dans l'historique git.

## Bibliothèque de blocs vanilla

- [x] `npm run import:blocks` : liste des blocs 1.21.1 (minecraft-data), modèles (archive JSON misode/mcmeta, 15 Mo),
      textures (misode/mcmeta), noms FR/EN officiels → `data/generated/blocks/` (non versionné, textures Mojang)
- [x] Icônes façon inventaire : cube 3D en CSS (dessus, face nord à gauche, face ouest à droite, ombrage des côtés),
      calques teintés (herbe, feuillages) ; icône plate pour les autres formes
- [x] Panneau « Blocs Minecraft » à côté de la grille, avec recherche FR/EN/id
- [ ] Rendu 3D des formes non cubiques (escaliers, dalles, clôtures…) : icône plate pour l'instant (451 blocs)
- [ ] Blocs à rendu spécial (coffres, lits, têtes, bannières…) : pas d'icône (61 blocs)
- [ ] Teintes : couleurs par défaut des objets (herbe #91BD59, feuillage #48B518…) ; à comparer au jeu

## Données conservées

- [x] `src/data/seed/` : objets, recettes, tags, noms FR/EN (vraies recettes Create 6 + vanilla)
- [x] `src/data/items.ts` : catalogue d'objets (noms, icônes, recettes de traitement)
- [x] `npm run import:mods` : lecture des jars + minecraft-data

## Découvertes utiles pour la suite

- Jauge d'usine (FactoryPanelBehaviour) : une requête toutes les 101 ticks tant que stock + promis < cible,
  entrées tout-ou-rien, adresse vide = aucun envoi, promesses 0 = 30 s / n = n min / -1 = jamais.
- Textes officiels FR de l'écran de jauge : clés `create.gui.factory_panel.*` dans `fr_fr.json` de Create.
- Modrinth est bloqué par le filtre réseau ; `maven.createmod.net` et GitHub sont accessibles.
