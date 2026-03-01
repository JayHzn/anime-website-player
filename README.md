# AnimeHub

Plateforme de streaming d'anime et drama en VF et VOSTFR.

## Fonctionnalités

- **Recherche multi-sources** : Voiranime (anime VF/VOSTFR), VoirDrama (dramas)
- **Lecteur vidéo** HLS avec contrôles personnalisés
- **Suivi de progression** : reprendre là où tu t'es arrêté
- **Autoplay** de l'épisode suivant
- **Raccourcis clavier** : Espace (play/pause), F (fullscreen), ←→ (±10s), ↑↓ (volume), M (mute)
- **App mobile Android** : double-tap pour avancer/reculer, contrôles tactiles

## Comment utiliser

### Sur PC (Chrome/Firefox)

1. Télécharge l'extension depuis les [Releases](https://github.com/JayHzn/anime-website-player/releases)
2. Décompresse le fichier `extension-v1.0.0.zip`
3. Ouvre `chrome://extensions` (Chrome) ou `about:debugging` (Firefox)
4. Active le **mode développeur**
5. Clique sur **"Charger l'extension non empaquetée"** et sélectionne le dossier décompressé
6. Va sur le site : **https://anime-website-player.onrender.com**

L'extension est nécessaire pour que le site fonctionne — c'est elle qui récupère les vidéos depuis les sources de streaming.

### Sur Android

Télécharge l'APK depuis les [Releases](https://github.com/JayHzn/anime-website-player/releases) et installe-le sur ton téléphone (activer "Sources inconnues" dans les paramètres si demandé).

L'app mobile fonctionne sans extension, tout est intégré.

## Stack

| Composant | Technologies |
|-----------|-------------|
| Backend | FastAPI, SQLite, httpx, BeautifulSoup |
| Frontend | React 18, Vite, Tailwind CSS, hls.js |
| Extension | Manifest V3, IndexedDB, postMessage bridge |
| Mobile | React Native (Expo), WebView, AsyncStorage |
