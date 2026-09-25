# TASKS

Suivi du développement de CreatePlanner (Create 6.x, Minecraft 1.21.1, NeoForge).

## Planificateur de jauges d'usine

- [x] Grille 2D : poser, sélectionner, glisser-déplacer des jauges ; taille réglable
- [x] Configuration comme en jeu : objet filtré, quantité à garder (objets / piles), posée sur lien de stock (recette)
      ou empaqueteur (réapprovisionnement), adresse, sortie de recette, délai d'expiration des promesses
- [x] Connexions entre jauges (entrées avec quantité par requête), flèches sur la grille
- [x] Liste d'adresses (temps de trajet, temps de fabrication sur place), plaçables sur la grille, joker « * »
- [x] Simulation au tick : requête toutes les 101 ticks tant que stock + promis < cible, entrées tout-ou-rien,
      colis de 9 piles max, promesses et expiration, colis sans adresse correspondante non livrés
- [x] Jauge alimentée par une ferme (ex. pierre 1300/min) : ne commande rien, surveille le stock ; option « la ferme
      s'arrête à la cible »
- [x] Stock du réseau : initial, apports et consommations par minute
- [x] Envoi manuel de colis vers une adresse
- [x] Sauvegarde automatique (navigateur), export / import JSON

## Données

- [x] `src/data/seed/` et `npm run import:mods` : objets, noms FR/EN, icônes (quand les jars sont importés)

## À valider avec l'utilisateur

- Représentation : une case = une jauge (en jeu, jusqu'à 4 jauges par face de bloc)
- Adresses : correspondance insensible à la casse avec « * » — vérifier le comportement exact en jeu
- Temps de trajet / fabrication par adresse : valeurs saisies, pas calculées depuis les machines

## Découvertes

- Jauge (FactoryPanelBehaviour) : minuteur figé tant que la jauge est satisfaite (stock + promis ≥ cible) ; après
  l'expiration d'une promesse elle attend encore 100 ticks avant de redemander.
- Une adresse vide bloque tout envoi (`recipeAddress.isBlank()`).
- Modrinth est bloqué par le filtre réseau ; `maven.createmod.net` et GitHub sont accessibles.
