// Helpers to display "Saison X · Épisode Y" consistently across the player, the
// history page and the home "continue watching" section.
//
// The player has the authoritative season (the episode object's `season` field).
// History / home only have the stored `episode_id`, so we derive the season number
// from it. Single-season sources (no season in the id) fall back to episode-only.

/** Derive a season number from a source-specific episode id, or null if absent. */
export function seasonFromEpisodeId(episodeId) {
  if (!episodeId) return null;
  const id = String(episodeId);
  // anime-sama ("…/saison1/…"), jetanimes ("…-saison-1-episode-9")
  const m = id.match(/saison[\s_-]?(\d+)/i);
  if (m) return parseInt(m[1], 10);
  // franime ("{animeId}/{season}/{episode}/{lang}")
  const parts = id.split('/');
  if (parts.length === 4 && /^\d+$/.test(parts[1])) return parseInt(parts[1], 10);
  return null;
}

/** Format a season label from a value that may be a number, a "Saison N" string,
 *  a custom title, or null. Returns "" when there's no season. */
export function seasonLabel(season) {
  if (season == null) return '';
  const s = String(season).trim();
  if (!s) return '';
  if (/^\d+$/.test(s)) return `Saison ${s}`;
  return s; // already "Saison N …" or a custom title (e.g. "Films", "OAV")
}

/** Build a full "Saison X · Épisode Y" label (or just "Épisode Y" with no season).
 *  `season` may be a number, string, or null. `compact` uses "S/Ép." abbreviations. */
export function formatSeasonEpisode(season, number, { compact = false } = {}) {
  const ep = number ?? '?';
  const label = seasonLabel(season);
  if (compact) {
    const m = label.match(/(\d+)/);
    const sPart = label ? (m ? `S${m[1]}` : label) : '';
    return sPart ? `${sPart} · Ép. ${ep}` : `Ép. ${ep}`;
  }
  return label ? `${label} · Épisode ${ep}` : `Épisode ${ep}`;
}
