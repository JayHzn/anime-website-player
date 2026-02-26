"""
Base class for anime sources (plugin interface).

Every source plugin must:
1. Create a file in sources/ (e.g. sources/my_source.py)
2. Define a class named `Source` that inherits from `AnimeSource`
3. Implement all abstract methods

Search results format:
[
    {
        "id": "unique-anime-id",
        "title": "Anime Title",
        "cover": "https://...",          # cover image URL
        "type": "TV | Movie | OVA",
        "year": 2024,
        "episodes_count": 12,            # optional
    }
]

Episodes list format:
[
    {
        "id": "unique-episode-id",
        "number": 1,
        "title": "Episode Title",        # optional
    }
]

Video URL format:
{
    "url": "https://direct-video-url.mp4",
    "referer": "https://source-site.com",  # if needed for CORS
    "headers": {},                          # extra headers if needed
    "subtitles": [                          # optional
        {"lang": "fr", "url": "https://..."}
    ]
}
"""

from abc import ABC, abstractmethod


class AnimeSource(ABC):
    name: str = "base"
    language: str = "en"
    base_url: str = ""

    @abstractmethod
    async def search(self, query: str) -> list[dict]:
        """Search for anime by title. Returns list of anime results."""
        ...

    @abstractmethod
    async def get_episodes(self, anime_id: str) -> list[dict]:
        """Get all episodes for a given anime. Returns list of episodes."""
        ...

    @abstractmethod
    async def get_video_url(self, episode_id: str) -> dict:
        """Get the video stream URL for a given episode."""
        ...

    async def get_anime_info(self, anime_id: str) -> dict | None:
        """
        Get anime details (title, cover, type, year, etc).
        Optional — returns None by default. Override in source plugins.

        Expected format:
        {
            "id": "anime-slug",
            "title": "Anime Title",
            "cover": "https://...",
            "type": "TV",
            "year": 2024,
        }
        """
        return None