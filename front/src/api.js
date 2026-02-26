const BASE = import.meta.env.DEV ? '/api' : '';

async function fetchJSON(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export const api = {
  getSources: () => fetchJSON('/sources'),
  search: (query, source) => {
    const params = new URLSearchParams({ q: query });
    if (source) params.append('source', source);
    return fetchJSON(`/search?${params}`);
  },
  getAnimeInfo: (source, animeId) =>
    fetchJSON(`/anime/${source}/${encodeURIComponent(animeId)}/info`),
  getEpisodes: (source, animeId) =>
    fetchJSON(`/anime/${source}/${encodeURIComponent(animeId)}/episodes`),
  getVideoUrl: (source, episodeId) =>
    fetchJSON(`/episode/${source}/${episodeId}/video`),
  getProgress: () => fetchJSON('/progress'),
  getAnimeProgress: (animeId) => fetchJSON(`/progress/${encodeURIComponent(animeId)}`),
  updateProgress: (data) =>
    fetch(`${BASE}/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),
  deleteProgress: (animeId) =>
    fetch(`${BASE}/progress/${encodeURIComponent(animeId)}`, { method: 'DELETE' }),
  getSkipSegments: (source, episodeId, episodeNumber) => {
    const params = episodeNumber ? `?ep=${episodeNumber}` : '';
    return fetchJSON(`/episode/${source}/${episodeId}/skip-segments${params}`);
  },
  triggerSkipAnalysis: (source, animeId) =>
    fetch(`${BASE}/anime/${source}/${encodeURIComponent(animeId)}/analyze-skip`, { method: 'POST' }),
  correctSkipSegment: (source, animeId, episodeNumber, data) =>
    fetch(`${BASE}/anime/${source}/${encodeURIComponent(animeId)}/skip-segments/${episodeNumber}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),
  deleteSkipSegments: (source, animeId, episodeNumber) =>
    fetch(`${BASE}/anime/${source}/${encodeURIComponent(animeId)}/skip-segments/${episodeNumber}`, { method: 'DELETE' }),
};