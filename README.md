# AnimeHub

Plateforme de streaming d'anime et drama en VF et VOSTFR.

## Fonctionnalités

### Accueil

- **Continuer à regarder** : reprends tes animes en cours avec barre de progression
- **Dernières sorties** : carrousel des épisodes récemment ajoutés
- **Catalogue de saison** : animes de la saison en cours / catalogue drama

### Recherche & Catalogue

- **Recherche multi-sources** : Voiranime (anime VF/VOSTFR), VoirDrama (dramas)
- **Sélecteur de source** dans la navbar
- **Fiches anime** avec couverture, note, nombre d'épisodes, type et année

### Page anime

- Bannière avec couverture et infos détaillées
- **Basculer VF / VOSTFR** automatiquement si une version alternative existe
- Liste des épisodes avec indicateur de progression (vu / en cours)
- Bouton de reprise rapide

### Lecteur vidéo

- Streaming **HLS** avec qualité adaptative
- **Autoplay** de l'épisode suivant
- Barre de progression cliquable avec prévisualisation du temps
- Contrôle du volume
- Navigation épisode précédent / suivant
- **Sauvegarde automatique** de la progression toutes les 5 secondes
- Reprise automatique là où tu t'es arrêté
- Fallback iframe si le HLS échoue

### Raccourcis clavier (PC)

| Touche     | Action                   |
| ---------- | ------------------------ |
| Espace / K | Play / Pause             |
| F          | Plein écran              |
| ← →        | Avancer / Reculer de 10s |
| ↑ ↓        | Volume                   |
| M          | Couper / Remettre le son |

### Contrôles mobiles (Android)

- **Simple tap** : afficher les contrôles / play-pause
- **Double tap à droite** : avancer de 10s
- **Double tap à gauche** : reculer de 10s
- Masquage automatique des contrôles pendant la lecture

### Historique

- Liste de tous les animes regardés avec progression
- Reprise rapide en un clic
- Suppression individuelle

## Comment utiliser

### Sur PC (Chrome, Edge, Brave...)

1. Télécharge l'extension depuis les [Releases](https://github.com/JayHzn/anime-website-player/releases)
2. Décompresse le fichier `AnimeHub-v1.1.10.zip`
3. Ouvre `chrome://extensions` dans ton navigateur
4. Active le **mode développeur**
5. Clique sur **"Charger l'extension non empaquetée"** et sélectionne le dossier décompressé
6. Va sur le site : **https://anime-website-player.onrender.com**

L'extension est nécessaire pour que le site fonctionne — c'est elle qui récupère les vidéos depuis les sources de streaming. Compatible avec tous les navigateurs basés sur Chromium.

### Sur Android

Télécharge l'APK depuis les [Releases](https://github.com/JayHzn/anime-website-player/releases) et installe-le sur ton téléphone (activer "Sources inconnues" dans les paramètres si demandé).

L'app mobile fonctionne sans extension, tout est intégré.

## Architecture technique

```
anime-website-player/
├── back/                  # Backend FastAPI
│   ├── main.py            # Serveur principal + proxy HLS
│   ├── sources/           # Plugins de sources (voiranime, voirdrama)
│   └── db/                # SQLite (progression, skip segments)
├── front/                 # Frontend React SPA
│   └── src/
│       ├── api.js         # Bridge extension ↔ site (postMessage)
│       ├── components/    # VideoPlayer, AnimeCard, Layout...
│       └── pages/         # Home, Search, Anime, Watch, History
├── extension/             # Extension Chrome (Manifest V3)
│   ├── background.js      # Service worker (scraping, cache IndexedDB)
│   ├── content.js         # Injection du bridge dans le site
│   └── sources/           # Parsers JS (voiranime, voirdrama)
└── mobile/                # App Android (React Native / Expo)
    ├── App.js             # WebView + gestion des sources
    ├── bridge.js          # Script injecté (CSS mobile, bridge)
    └── sources/           # Mêmes parsers que l'extension
```

### Comment ça marche

Le scraping des sites de streaming est effectué **côté client** (extension navigateur ou app mobile), jamais par le backend. Cela évite de surcharger le serveur et contourne les protections anti-hotlink.

```
Utilisateur → Extension / App Mobile → Sites de streaming (voiranime, voirdrama)
                                      → Hébergeurs vidéo (vidmoly, voe, etc.)

Utilisateur → Backend (FastAPI)       → Proxy HLS, sauvegarde progression
```

L'extension et l'app mobile communiquent avec le site via `window.postMessage`. Le site envoie des requêtes (recherche, épisodes, URL vidéo) et l'extension/app exécute le scraping puis renvoie les résultats.

### Stack

| Composant | Technologies                               |
| --------- | ------------------------------------------ |
| Backend   | FastAPI, SQLite, httpx, BeautifulSoup      |
| Frontend  | React 18, Vite, Tailwind CSS, hls.js       |
| Extension | Manifest V3, IndexedDB, postMessage bridge |
| Mobile    | React Native (Expo), WebView, AsyncStorage |
