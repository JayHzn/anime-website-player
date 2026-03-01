# AnimeHub

Plateforme de streaming d'anime et drama qui agrège plusieurs sources. Disponible en web (avec extension navigateur) et en application mobile Android.

## Fonctionnalités

- **Recherche multi-sources** : Voiranime (anime VF/VOSTFR), VoirDrama (dramas)
- **Lecteur vidéo** HLS avec contrôles personnalisés
- **Suivi de progression** : reprendre là où tu t'es arrêté
- **Skip automatique** des openings/endings (détection IA)
- **Autoplay** de l'épisode suivant
- **Raccourcis clavier** : Espace (play/pause), F (fullscreen), ←→ (±10s), ↑↓ (volume), M (mute)
- **App mobile Android** : double-tap pour avancer/reculer, contrôles tactiles

## Architecture

```
anime-website-player/
├── back/                  # Backend FastAPI (API, proxy HLS, ML)
│   ├── main.py            # Serveur principal
│   ├── sources/           # Plugins de sources (voiranime, voirdrama)
│   ├── db/                # SQLite (progression, skip segments)
│   └── ml/                # Détection OP/ED par CNN
├── front/                 # Frontend React (SPA)
│   └── src/
│       ├── api.js         # Bridge extension + client API
│       ├── components/    # VideoPlayer, AnimeCard, Layout...
│       └── pages/         # Home, Search, Anime, Watch, History
├── extension/             # Extension Chrome/Firefox
│   ├── background.js      # Service worker (scraping, cache)
│   ├── content.js         # Injection du bridge
│   └── sources/           # Parsers (voiranime.js, voirdrama.js)
└── mobile/                # App React Native (Expo)
    ├── App.js             # WebView + handler de sources
    ├── bridge.js          # Script injecté (CSS mobile, bridge)
    └── sources/           # Mêmes parsers que l'extension
```

## Comment ça marche

Le scraping des sites de streaming est effectué **côté client** (extension navigateur ou app mobile), jamais par le backend. Cela évite de surcharger le serveur et contourne les protections anti-hotlink.

```
Utilisateur → Extension/App Mobile → Sites de streaming (voiranime, voirdrama)
                                    → Hébergeurs vidéo (vidmoly, voe, etc.)
Utilisateur → Backend (FastAPI)     → Proxy HLS, progression, détection OP/ED
```

## Installation

### Docker (recommandé)

```bash
git clone https://github.com/JayHzn/anime-website-player.git
cd anime-website-player
docker compose up --build
```

Ouvre **http://localhost:3000**. Hot-reload activé.

### Manuel

**Backend :**
```bash
cd back
pip install -r requirements.txt
python main.py
# → http://localhost:8000
```

**Frontend :**
```bash
cd front
npm install
npm run dev
# → http://localhost:3000
```

### Extension navigateur

1. Ouvre `chrome://extensions` (ou `about:debugging` sur Firefox)
2. Active le mode développeur
3. Charge le dossier `extension/` comme extension non empaquetée

### App mobile (Android)

Télécharge l'APK depuis les [Releases](https://github.com/JayHzn/anime-website-player/releases).

Pour builder toi-même :
```bash
cd mobile
npm install
npx eas build -p android --profile preview
```

## Ajouter une source

1. Copie `back/sources/_example_template.py` → `back/sources/ma_source.py`
2. Implémente les 3 méthodes : `search()`, `get_episodes()`, `get_video_url()`
3. Copie le parser JS correspondant dans `extension/sources/` et `mobile/sources/`
4. Redémarre — la source est auto-détectée

## Stack

| Composant | Technologies |
|-----------|-------------|
| Backend | FastAPI, SQLite, httpx, BeautifulSoup, librosa (ML) |
| Frontend | React 18, Vite, Tailwind CSS, hls.js |
| Extension | Manifest V3, IndexedDB, postMessage bridge |
| Mobile | React Native (Expo), WebView, AsyncStorage |
