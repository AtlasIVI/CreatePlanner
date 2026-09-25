# TASKS

Suivi du développement de CreatePlanner (Create 6.x, Minecraft 1.21.1, NeoForge).

## Phase 1 — Modèle, données, calculateur, vue production

- [x] Modèle de domaine pur dans `src/core` (Item, Tag, Recipe, MachineDef, SpeedModel, KineticSourceDef)
- [x] Évaluateur de formules sûr (`expr.ts`) pour décrire les machines en JSON sans code
- [x] Données machines `data/machines/create.json` et `minecraft.json`, chaque valeur avec `source` + `verified`
- [x] Formules vérifiées dans le code source de Create (branche `mc1.21.1/dev`) — voir « Découvertes »
- [x] Normaliseur de recettes (vanilla, Create, add-ons, types inconnus conservés)
- [x] Jeu de données seed (`src/data/seed`) généré depuis les vraies recettes Create 6 + recettes vanilla
- [x] Importeur `npm run import:mods` (jars, tags, noms EN/FR, icônes, rapport des types non modélisés)
- [x] Mode `--download` (Modrinth API v2, User-Agent, cache dans `mods/`) — non testé en réel (réseau filtré)
- [x] Données vanilla via PrismarineJS minecraft-data + fichiers de langue officiels (FR/EN)
- [x] Calculateur : arbre de recettes, choix de recette, machines par étape, matières premières, sous-produits, chances
- [x] Assemblage séquencé : étapes et boucles, machines par étape
- [x] Stress total vs capacité, suggestions de sources
- [x] Vue production : /s, /min, /h par étape
- [x] Tests : presse 16/64/256, mélangeur 30/64/256, meule 32, broyeurs, sources, chaînes laiton / alliage d'andésite
- [x] Projets en IndexedDB, import/export JSON, bascule de mods, noms FR/EN

## Phase 2 — Logistique

- [ ] Modules jauge d'usine (sortie, entrées, stock cible, adresse, délai de promesse)
- [ ] Empaqueteurs, ports grenouille, convoyeurs à chaîne, liens de stock
- [ ] Débit par lien et détection de goulot
- [ ] Bilan de stock dans le temps (accumulation / pénurie)

## Phase 3 — Liste de matériaux

- [ ] Blocs à poser (plan + grille + logistique)
- [ ] Ressources brutes (déroulé récursif des crafts)
- [ ] Stock existant éditable, soustrait
- [ ] Export CSV et copie presse-papiers

## Phase 4 — Grille de placement 2D

- [ ] Grille par couche (vue de dessus, curseur Y)
- [ ] Placer / tourner / supprimer machines, arbres, roues dentées, boîtes de vitesses, tapis, sources, ports, jauges
- [ ] Réseau cinétique déduit : propagation des tr/min (×2 / ÷2, boîte de vitesses), stress par réseau
- [ ] Conflits (sens opposés, vitesses différentes) et surcharge
- [ ] La grille alimente la liste de matériaux et le calculateur

## Découvertes

Valeurs vérifiées dans `Creators-of-Create/Create` branche `mc1.21.1/dev` (juin–sept. 2026).

- **Presse** : `CYCLE = 240`, avance `(int) lerp(clamp(|rpm|/512,0,1), 1, 60)` par tick, mais `runningTicks` est bloqué à 120
  (moment de la presse) puis doit dépasser 240. Ticks réels = `ceil(120/a) + floor(120/a) + 2` au lieu de `240/a` (wiki).
  16 tr/min → 122 t (wiki 120), 64 → 32 (30), 256 → 10 (8). `bulkPressing=false` : 1 objet par presse.
- **Mélangeur** : `Mth.log2` est un log2 entier → `15 × floor(log2(floor(512/rpm))) + 1`, +1 tick en régime établi
  (`continueWithPreviousRecipe` garde la tête baissée). Formule du brief légèrement fausse (log2 réel donne 63 t à 30 tr/min),
  les valeurs annoncées (62/47/32/17) sont bonnes. Le facteur 15 est `ceil(duration/100 × 15)`. Premier lot : ~40 t de plus.
  Vitesse minimale : `SpeedLevel.MEDIUM` = `mediumSpeed` = 30 tr/min (vérifié).
- **Meule** : facteur de vitesse entier `(int)(rpm/16)` → 24 tr/min se comporte comme 16.
- **Roues de broyage** : `crushingspeed = |rpm|/50`, vitesse `×4`, divisée par `log2(taille de pile)`. Avec 1 objet, `log2(1)=0`
  → division par zéro → plafonné à 20 quelle que soit la vitesse. La pile entière est traitée d'un coup : le débit dépend
  énormément de la taille de lot (paramètre « Lot » dans l'UI).
- **Scie** : phase recette jusqu'à < 5 puis phase de sortie fixe de 20 unités ; vitesse `clamp(rpm/24, 1, 128)` (pas d'arrondi).
- **Déployeur** : minuteur 1000 (sortie) + 1000 (retour) + 500 (attente), décrément `(int)clamp(rpm×2, 8, 512)`.
- **Ventilateur** : `fanProcessingTime = 150` ticks par pile de ≤16, indépendant des tr/min.
- **Établis mécaniques** : vitesse `clamp(|rpm|, 4, 250)`, phases 2000 / 1000 — nombre de transferts approximé (non vérifié).
- **Stress (AllBlocks.java)** : Bras mécanique **2** SU/tr/min (pas 8), Tapis **0** (`setNoImpact`, pas 1), Convoyeur à chaîne 1.
- **Sources** : Grande roue à eau 4 tr/min × 128 = 512 SU ; Moulin à vent `clamp(floor(voiles/8), 1, 16)` tr/min × 512 SU/tr/min
  (8 voiles min.) ; Moteur à vapeur : efficacité `min(1, niveau/moteurs)` (passif 1/8), vitesse 16×(1..4), capacité
  `e × 1024 × 16` SU par moteur — cohérent avec 2048 / 16384 SU du brief.
- **Jauge d'usine** : en mode recette, **une seule requête (un lot) toutes les `factoryGaugeTimer + 1` = 101 ticks** →
  plafond ≈ `sortie par requête × 0,198/s`. Une adresse vide bloque l'envoi (`recipeAddress.isBlank()`). Délai de promesse :
  0 = 30 s, n = n minutes, -1 = jamais. 4 jauges par face.
- **Empaqueteur** : `CYCLE = 20` ticks d'animation par colis ; colis = 9 piles.
- **Convoyeur à chaîne** : colis à `|rpm|/360` bloc/tick, capacité 20 colis par convoyeur (`chainConveyorCapacity`).
- **Port grenouille** : animation 0→1 à 0,1/tick ; cycle complet estimé à 20 t (non vérifié).
- Create 6.0.11 existe déjà sur le maven officiel (le brief cite 6.0.10).

### Valeurs non vérifiées (marquées dans l'UI)

- Établis mécaniques : temps de cycle (nombre de transferts dans la grille).
- Établi / tailleur de pierre à la main : 1 opération/s supposée.
- Tapis : 1 objet « Tapis roulant » pour 2 blocs.
- Espacement des colis sur une chaîne, espacement des objets sur un tapis, cycle du port grenouille, délai de promesse max (30 min).

### Réseau / environnement

- Modrinth (`api.modrinth.com`) est bloqué par le filtre FortiGuard de ce réseau (catégorie « Games ») : `--download`
  détecte la page de blocage et continue. `maven.createmod.net` et GitHub sont accessibles.
