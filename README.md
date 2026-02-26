# 🎬 AnimeHub - Local Anime Streaming Aggregator

Un lecteur d'anime local qui agrège des sources de streaming avec un système de plugins.

## Features

- 🔍 **Recherche** multi-sources
- 📺 **Lecteur vidéo** intégré avec support HLS (`.m3u8`)
- ▶️ **Autoplay** épisode suivant
- 📊 **Suivi de progression** (reprendre là où tu t'es arrêté)
- 🔌 **Système de plugins** pour ajouter des sources facilement
- ⌨️ **Raccourcis clavier** : Espace (play/pause), F (fullscreen), ←→ (±10s), ↑↓ (volume), M (mute)

## Architecture

```
anime-hub/
├── backend/
│   ├── main.py              # FastAPI server
│   ├── requirements.txt
│   ├── db/
│   │   └── database.py      # SQLite progress tracking
│   └── sources/
│       ├── base.py           # Plugin interface (abstract)
│       ├── demo.py           # Source démo avec données mock
│       └── _example_template.py  # Template pour créer une source
└── frontend/
    ├── package.json
    ├── vite.config.js        # Proxy vers le backend
    └── src/
        ├── api.js            # Client API
        ├── App.jsx           # Router
        ├── components/
        │   ├── Layout.jsx    # Navbar + search
        │   ├── AnimeCard.jsx # Card anime
        │   └── VideoPlayer.jsx # Lecteur vidéo custom
        └── pages/
            ├── HomePage.jsx   # Accueil + continuer à regarder
            ├── SearchPage.jsx # Résultats de recherche
            ├── AnimePage.jsx  # Détail anime + liste épisodes
            └── WatchPage.jsx  # Plein écran lecteur
```

## Installation

### Option 1 : Docker (recommandé) 🐳

```bash
# Clone le projet puis :
cd anime-hub
docker compose up --build
```

C'est tout. Ouvre **http://localhost:3000**.

- Le hot-reload est actif : modifie les fichiers et ça se met à jour tout seul
- La base de données est persistée dans un volume Docker
- Pour arrêter : `docker compose down`
- Pour tout supprimer (y compris les données) : `docker compose down -v`

### Option 2 : Installation locale

#### Prérequis

- Python 3.11+
- Node.js 18+

#### Backend

```bash
cd backend
pip install -r requirements.txt
python main.py
# → API sur http://localhost:8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
# → App sur http://localhost:3000
```

Ouvre **http://localhost:3000** dans ton navigateur.

## Ajouter une source

1. Copie `backend/sources/_example_template.py` → `backend/sources/ma_source.py`
2. Implémente les 3 méthodes :
   - `search(query)` → liste d'animes
   - `get_episodes(anime_id)` → liste d'épisodes
   - `get_video_url(episode_id)` → URL vidéo + headers
3. Redémarre le backend → ta source est auto-détectée

### Format attendu

**search()** retourne :

```python
[{"id": "...", "title": "...", "cover": "https://...", "type": "TV", "year": 2024}]
```

**get_episodes()** retourne :

```python
[{"id": "...", "number": 1, "title": "Episode 1"}]
```

**get_video_url()** retourne :

```python
{"url": "https://...m3u8", "referer": "...", "headers": {}, "subtitles": []}
```

## Stack

- **Backend** : FastAPI + SQLite + httpx + BeautifulSoup
- **Frontend** : React 18 + Vite + Tailwind CSS + hls.js
- **Lecteur** : Custom avec HLS, autoplay, raccourcis clavier
