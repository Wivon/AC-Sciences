# Labo Claveille

Application de bureau pour la physique-chimie expérimentale — pointage vidéo, tableur scientifique, graphique avec modélisation et conversions d'unités.

Construite avec [Electron](https://www.electronjs.org/) et [Chart.js](https://www.chartjs.org/), sans framework frontend.

---

## Fonctionnalités

### Pointage vidéo
Importe une vidéo (MP4, AVI, MOV…) et effectue un suivi manuel image par image.

1. Charge la vidéo — elle est automatiquement retranscodée via **ffmpeg** si nécessaire.
2. Définis l'**origine** (clic sur l'image) et l'**échelle** (distance réelle en mètres pour une longueur mesurée sur l'image).
3. Choisis la **frame de départ** (t = 0).
4. Active le mode **Pointer** puis clique sur l'objet à chaque frame : les coordonnées (x, y) et le temps (t) sont automatiquement injectés dans le tableur.
5. **Annuler** retire le dernier point enregistré.

### Tableur
Feuille de calcul orientée sciences avec des colonnes nommées et des unités.

- **Colonnes** : chaque colonne a un nom (ex. `t`, `v`, `x`) et une unité optionnelle.
- **Formules** : toute cellule commençant par `=` est évaluée.
  - Référence à la valeur courante d'une colonne : `[NomColonne]`
  - Référence à une ligne précise (1-indexé) : `NomColonne[3]`
  - Valeur de la ligne précédente : `PREV([NomColonne])`
  - Fonctions agrégées : `SUM([col])`, `AVG([col])`, `MIN([col])`, `MAX([col])`, `COUNT([col])`
  - Fonctions mathématiques : `SQRT`, `ABS`, `LN`, `LOG`, `EXP`, `SIN`, `COS`, `TAN`, `PI`
  - Opérateurs : `+`, `-`, `*`, `/`, `^` (puissance), `×`, `÷`
  - Alias français supportés : `SOMME`, `MOYENNE`, `RACINE`, `SINUS`, `COSINUS`, etc.
- **Mode trigonométrique** : bascule degrés / radians (affecte SIN, COS, TAN).
- **Sélection multiple** : drag pour sélectionner une plage, Suppr/Backspace pour effacer.
- **Poignée de remplissage** : étire une valeur ou une formule vers le bas.

### Graphique
Visualisation XY interactive avec outils d'analyse.

- **Axes** : choix libre de la colonne X et d'une ou plusieurs colonnes Y ; contrôle de l'origine (décalage).
- **Dériver** : calcule la dérivée numérique d(col)/dX et l'ajoute comme nouvelle colonne dans le tableur.
- **Modéliser** : ajuste une courbe sur les données et la trace sur tout le graphique.
  - Types de courbes : droite, exponentielle, parabolique, logarithmique (ln ou log₁₀), inverse, inverse carré, puissance.
  - **Plage de données** : champs *Début (X)* et *Fin (X)* pour restreindre les points utilisés dans le calcul des coefficients.
  - Les coefficients et l'équation ajustée sont affichés sous le bouton *Tracer*.
- **Export** : capture le graphique en image ou exporte les données en Excel.

### Conversions d'unités
Convertisseur multi-catégories intégré.

| Catégorie | Exemples d'unités |
|---|---|
| Distances | m, km, cm, mm, µm, nm, in, ft, mi |
| Temps | s, ms, µs, min, h, j, sem, an |
| Vitesse | m/s, km/h, mph, nœud, ft/s |
| Masse | kg, g, mg, t, lb, oz |
| Température | °C, °F, K |
| Pression | Pa, hPa, bar, atm, mmHg, psi |
| Énergie | J, kJ, cal, kcal, kWh, eV |
| Puissance | W, kW, MW, ch, BTU/h |
| Aire | m², km², cm², ha, acre |
| Volume | L, mL, m³, cm³, fl oz, gal |
| Force | N, kN, kgf, lbf |
| Fréquence | Hz, kHz, MHz, GHz, rpm |
| Quantité de matière | mol, mmol, µmol, particules |
| Concentration molaire | mol/L, mmol/L, µmol/L |
| Concentration massique | g/L, mg/L, µg/L |

---

## Format de fichier

Les projets sont sauvegardés en `.lab` (JSON). Le fichier contient :
- les colonnes et données du tableur,
- la configuration du graphique (axes, régressions, origine),
- l'état du pointage vidéo (origine, échelle, points enregistrés),
- les préférences de conversions.

---

## Installation et lancement

**Télécharger la [dernière version ici](https://labo-claveille.vecting.org)**

### Lancement local (pour le développement)

**Prérequis** : [Node.js](https://nodejs.org/) ≥ 18 et npm.

```bash
# Cloner le dépôt
git clone https://github.com/Wivon/AC-Sciences.git
cd AC-Sciences

# Installer les dépendances
npm install

# Lancer en mode développement
npm start
```

> **Note :** une seule instance peut tourner à la fois (`requestSingleInstanceLock`). Si l'app ne s'ouvre pas, vérifie qu'aucun processus précédent ne tourne encore.

---

## Build / Distribution

```bash
# macOS — génère un .dmg
npm run dist:mac

# Windows — génère un portable .exe
npm run dist:win

# Linux — génère un AppImage et un .deb
npm run dist:linux

# Toutes les plateformes
npm run dist
```

Les binaires sont produits dans le dossier `dist/` par [electron-builder](https://www.electron.build/).

---

## Stack technique

| Couche | Technologie |
|---|---|
| Shell applicatif | Electron 41 |
| Interface | HTML / CSS / JavaScript vanilla |
| Graphiques | Chart.js 4 |
| Transcodage vidéo | ffmpeg-static |
| Build desktop | electron-builder |

---

## Structure du projet

```
ac-sciences/
├── main.js          # Processus principal Electron (fenêtre, menus, IPC)
├── preload.js       # Bridge IPC contextIsolation
├── src/
│   ├── index.html   # Structure de l'interface (onglets, sidebar, canvas)
│   ├── styles.css   # Styles de l'application
│   ├── app.js       # Contrôleur principal (état projet, sauvegarde/chargement)
│   ├── sheet.js     # Tableur (colonnes, formules, rendu DOM)
│   ├── graph.js     # Graphique (Chart.js, dérivée, régression)
│   ├── video.js     # Pointage vidéo (ffmpeg, canvas, tracking)
│   └── conversions.js  # Convertisseur d'unités
├── build/           # Icônes pour le packaging
├── misc/            # Exemples de projets .lab (pendule, bille, tennis)
└── scripts/
    └── prepare-ffmpeg-win.js  # Préparation ffmpeg pour le build Windows
```

---

## Informations
- Labo Claveille est open-source, les contributions sont bienvenues.
- Développé par Lilian Brousse: [contact](mailto:brousselilian6@gmail.com)
- Créé au [lycée Albert Claveille](https://claveille.org) de Périgueux
