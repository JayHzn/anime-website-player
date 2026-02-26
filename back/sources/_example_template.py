"""
Template pour créer une vraie source.

Pour ajouter une nouvelle source :
1. Copie ce fichier et renomme-le (ex: vostfree.py)
2. Implémente les 3 méthodes : search, get_episodes, get_video_url
3. Le fichier sera auto-détecté au démarrage du serveur

Libs utiles :
  pip install httpx beautifulsoup4 lxml
  pip install playwright  (si le site utilise beaucoup de JS)
"""

import httpx
from bs4 import BeautifulSoup
from sources.base import AnimeSource


class Source(AnimeSource):
    name = "example"        # Nom unique de la source
    language = "fr"          # Langue (fr, en, jp...)
    base_url = "https://example-anime-site.com"

    def __init__(self):
        self.client = httpx.AsyncClient(
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                              "AppleWebKit/537.36 (KHTML, like Gecko) "
                              "Chrome/120.0.0.0 Safari/537.36"
            },
            follow_redirects=True,
            timeout=15.0,
        )

    async def search(self, query: str) -> list[dict]:
        """
        Exemple : scrape la page de recherche du site.
        """
        # resp = await self.client.get(f"{self.base_url}/search", params={"q": query})
        # soup = BeautifulSoup(resp.text, "lxml")
        # results = []
        # for card in soup.select(".anime-card"):
        #     results.append({
        #         "id": card.get("data-id") or card.select_one("a")["href"].split("/")[-1],
        #         "title": card.select_one(".title").text.strip(),
        #         "cover": card.select_one("img")["src"],
        #         "type": "TV",
        #         "year": None,
        #         "episodes_count": None,
        #     })
        # return results
        return []

    async def get_episodes(self, anime_id: str) -> list[dict]:
        """
        Exemple : scrape la page de l'anime pour lister les épisodes.
        """
        # resp = await self.client.get(f"{self.base_url}/anime/{anime_id}")
        # soup = BeautifulSoup(resp.text, "lxml")
        # episodes = []
        # for ep in soup.select(".episode-item"):
        #     episodes.append({
        #         "id": ep.select_one("a")["href"].split("/")[-1],
        #         "number": int(ep.select_one(".ep-num").text),
        #         "title": ep.select_one(".ep-title").text.strip() if ep.select_one(".ep-title") else None,
        #     })
        # return episodes
        return []

    async def get_video_url(self, episode_id: str) -> dict:
        """
        Exemple : récupère l'URL du flux vidéo.
        Souvent il faut :
        1. Charger la page de l'épisode
        2. Trouver l'iframe du lecteur
        3. Charger l'iframe et extraire l'URL du .m3u8 ou .mp4
        """
        # resp = await self.client.get(f"{self.base_url}/episode/{episode_id}")
        # soup = BeautifulSoup(resp.text, "lxml")
        # iframe_url = soup.select_one("iframe")["src"]
        #
        # # Charger l'iframe pour trouver la source vidéo
        # resp2 = await self.client.get(iframe_url, headers={"Referer": self.base_url})
        # # Extraire l'URL vidéo (regex, JSON dans le JS, etc.)
        # import re
        # match = re.search(r'file:\s*"(https://[^"]+\.m3u8[^"]*)"', resp2.text)
        # video_url = match.group(1) if match else ""
        #
        # return {
        #     "url": video_url,
        #     "referer": self.base_url,
        #     "headers": {},
        #     "subtitles": [],
        # }
        return {"url": "", "referer": "", "headers": {}, "subtitles": []}