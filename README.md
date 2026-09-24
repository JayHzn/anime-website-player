# Shinani

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
2. Décompresse le fichier `Shinani-v1.1.10.zip`
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
│   ├── sources/           # Parsers JS (anime-sama, vostfree, jetanimes, franime)
│   └── lib/               # Bibliothèque d'extraction vidéo (copie de référence)
│       ├── video.js         # Modèle Video + tri par qualité/hébergeur
│       ├── playlist-utils.js# Master m3u8 → une Video par variante
│       ├── unpacker.js      # Dépaquetage des scripts P.A.C.K.E.R.
│       ├── subtitles.js     # Téléchargement + SRT→VTT + inlining data:
│       ├── http.js          # GET avec Referer (DNR côté extension, direct côté RN)
│       ├── resolve.js       # Embeds → réponse pour le lecteur
│       └── extractors/      # Un extracteur par hébergeur + registre
└── mobile/                # App Android (React Native / Expo)
    ├── App.js             # WebView + sources + relais du lecteur natif
    ├── NativePlayer.js    # Lecteur ExoPlayer/AVPlayer (headers par source)
    ├── bridge.js          # Script injecté (CSS mobile, bridge)
    ├── sources/           # Mêmes parsers que l'extension
    └── lib/               # Miroir de extension/lib (`npm run sync:lib`)
```

### Comment ça marche

Le scraping des sites de streaming est effectué **côté client** (extension navigateur ou app mobile), jamais par le backend. Cela évite de surcharger le serveur et contourne les protections anti-hotlink.

```
Utilisateur → Extension / App Mobile → Sites de streaming (voiranime, voirdrama)
                                      → Hébergeurs vidéo (vidmoly, voe, etc.)

Utilisateur → Backend (FastAPI)       → Proxy HLS, sauvegarde progression
```

L'extension et l'app mobile communiquent avec le site via `window.postMessage`. Le site envoie des requêtes (recherche, épisodes, URL vidéo) et l'extension/app exécute le scraping puis renvoie les résultats.

### Récupération du flux vidéo

Le modèle est celui d'Aniyomi : une source ne connaît que **son** site et s'arrête aux URL d'embed ; c'est le registre partagé `lib/extractors/` qui sait résoudre chaque hébergeur.

```
source (anime-sama, vostfree…)      → liste d'embeds  [vidmoly, voe, sendvid…]
lib/extractors (en parallèle)       → extracteur dédié par hébergeur
lib/playlist-utils.extractFromHls   → master m3u8 → une Video par qualité
lib/video.sortVideos                → tri : hébergeur préféré, puis qualité, puis débit
lecteur                             → lit la meilleure, bascule sur la suivante en cas d'échec
```

Chaque `Video` transporte son URL, ses headers (`Referer`/`Origin`), ses sous-titres et sa qualité. Les headers sont appliqués différemment selon la plateforme (`lib/http.js`) : React Native les envoie directement, l'extension passe par une règle `declarativeNetRequest` de session — `Referer` étant un en-tête interdit pour `fetch()` dans un service worker. Cette règle sert aussi à la **lecture** : hls.js télécharge les segments depuis l'origine du site et ne peut pas non plus poser de `Referer`.

L'extraction en iframe cachée (`player-extractor.js`) n'est plus le chemin principal : elle ne sert que pour les hébergeurs qu'aucun extracteur ne sait résoudre — l'équivalent du `UniversalExtractor` (WebView) d'Aniyomi.

> Pour ajouter un hébergeur : un fichier dans `extension/lib/extractors/`, une ligne dans `index.js`, puis `npm run sync:lib`. Les quatre sources en bénéficient d'un coup.

### Lecture sur mobile

Dans la WebView, hls.js télécharge les segments depuis l'origine du site et une page ne peut pas poser de `Referer`/`Origin` : les hébergeurs qui les vérifient renvoient 403 sur chaque segment. L'app ne lit donc plus la vidéo dans la WebView — elle passe par **ExoPlayer/AVPlayer** (`expo-video`), qui accepte des headers par source, exactement comme Aniyomi.

```
WebView (le site)         → résout l'épisode, garde l'UI, la progression et l'historique
  ↓ ANIME_EXT_PLAY_NATIVE   { videos[], titre, position, segments OP/ED }
NativePlayer (RN)         → ExoPlayer avec les headers de chaque Video
  ↑ ANIME_EXT_NATIVE_EVENT  time / ended / next / prev / back / failed
```

Le lecteur natif se superpose à la WebView, qui reste montée : quitter l'épisode est instantané et le site reste seul maître de la navigation. En cas d'échec de **toutes** les variantes, il rend la main (`failed`) et la WebView reprend avec son extracteur en iframe.

Le site détecte la capacité via `window.__ANIMEHUB_NATIVE_PLAYER__`, posé par `bridge.js` : une ancienne version de l'app continue d'utiliser le lecteur WebView.

> `expo-video` est un module natif : après `npx expo install expo-video`, il faut reconstruire l'app (`eas build` ou un dev build). Un simple rechargement JS ne suffit pas.

### Stack

| Composant | Technologies                               |
| --------- | ------------------------------------------ |
| Backend   | FastAPI, SQLite, httpx, BeautifulSoup      |
| Frontend  | React 18, Vite, Tailwind CSS, hls.js       |
| Extension | Manifest V3, IndexedDB, postMessage bridge |
| Mobile    | React Native (Expo), WebView, AsyncStorage |
