import { useState, useEffect, useRef } from 'react';
import { Link, useOutletContext, useNavigate } from 'react-router-dom';
import { Play, Clock, Trash2, ChevronLeft, ChevronRight, Flame, Film, Sparkles } from 'lucide-react';
import { api, onCoversUpdate } from '../api';


export default function HomePage() {
  const { selectedSource } = useOutletContext();
  const navigate = useNavigate();
  const [progress, setProgress] = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [latestEpisodes, setLatestEpisodes] = useState([]);
  const [seasonAnime, setSeasonAnime] = useState([]);
  const [loadingSeason, setLoadingSeason] = useState(true);
  const [loading, setLoading] = useState(true);
  const [imgErrors, setImgErrors] = useState(new Set());
  const [resumingId, setResumingId] = useState(null);
  const [hoveredCover, setHoveredCover] = useState(null);
  const carouselRef = useRef(null);

  useEffect(() => {
    loadData();
  }, [selectedSource]);

  // Listen for cover updates — merge into both catalogue AND carousel
  useEffect(() => {
    return onCoversUpdate((patches) => {
      setSearchResults((prev) =>
        prev.map((a) => {
          const p = patches.find((x) => x.id === a.id && x.source === a.source);
          return p ? { ...a, cover: p.cover } : a;
        })
      );
      setLatestEpisodes((prev) =>
        prev.map((a) => {
          const p = patches.find((x) => x.id === a.id && x.source === a.source);
          return p ? { ...a, cover: p.cover } : a;
        })
      );
      // Clear image errors for covers that just got updated
      setImgErrors((prev) => {
        const updated = new Set(prev);
        for (const p of patches) updated.delete(p.id);
        return updated.size !== prev.size ? updated : prev;
      });
    });
  }, []);

  // Retry missing covers every 2s until all covers loaded (catalogue + carousel)
  useEffect(() => {
    const timer = setInterval(() => {
      const allItems = [...searchResults, ...latestEpisodes];
      const missing = allItems.filter((a) => !a.cover?.trim());
      if (missing.length === 0) return;

      const unique = [];
      const seen = new Set();
      for (const a of missing) {
        if (seen.has(a.id)) continue;
        seen.add(a.id);
        unique.push({ id: a.id, title: a.title, source: a.source });
      }
      if (unique.length > 0) {
        api.retryCovers(unique, selectedSource).catch(() => {});
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [searchResults, latestEpisodes, selectedSource]);

  // Season cache helpers (localStorage, TTL = 30 days)
  const SEASON_CACHE_KEY = 'seasonAnimeCache';
  const SEASON_CACHE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days

  function getCachedSeason() {
    try {
      const raw = localStorage.getItem(SEASON_CACHE_KEY);
      if (!raw) return null;
      const { data, ts } = JSON.parse(raw);
      if (Date.now() - ts > SEASON_CACHE_TTL) {
        localStorage.removeItem(SEASON_CACHE_KEY);
        return null;
      }
      return data;
    } catch {
      return null;
    }
  }

  function setCachedSeason(data) {
    try {
      localStorage.setItem(SEASON_CACHE_KEY, JSON.stringify({ data, ts: Date.now() }));
    } catch { /* quota exceeded, ignore */ }
  }

  async function loadData() {
    setLoading(true);
    try {
      // Check season cache first
      const cached = getCachedSeason();
      if (cached && cached.length > 0) {
        setSeasonAnime(cached);
        setLoadingSeason(false);
      } else {
        setLoadingSeason(true);
        setSeasonAnime([]);
      }

      const [prog, results, latest, season] = await Promise.all([
        api.getProgress(),
        api.search('', selectedSource),
        api.getLatestEpisodes(selectedSource).catch(() => []),
        cached ? Promise.resolve([]) : api.getSeasonAnime().catch(() => []),
      ]);
      setProgress(prog);
      setSearchResults(results);
      setLatestEpisodes(latest);
      setLoading(false);

      // Resolve season anime against voiranime in background (only if not cached)
      if (!cached && season.length > 0) {
        resolveSeasonAnime(season);
      } else if (!cached) {
        setLoadingSeason(false);
      }
    } catch (e) {
      console.error(e);
      setLoading(false);
      setLoadingSeason(false);
    }
  }

  async function resolveSeasonAnime(season) {
    const src = selectedSource || 'voiranime';
    // Resolve all anime titles against voiranime in parallel (batches of 5)
    const BATCH = 5;
    for (let i = 0; i < season.length; i += BATCH) {
      const batch = season.slice(i, i + BATCH);
      const results = await Promise.allSettled(
        batch.map(async (anime) => {
          const res = await api.search(anime.title, src);
          if (res.length > 0) {
            // Prefer VOSTFR version (no -vf suffix) over VF
            const vostfr = res.find((r) => !r.id.endsWith('-vf'));
            const pick = vostfr || res[0];
            return { ...anime, voiranimeId: pick.id, voiranimeSource: pick.source };
          }
          return null;
        })
      );
      const found = results
        .filter((r) => r.status === 'fulfilled' && r.value)
        .map((r) => r.value);
      if (found.length > 0) {
        setSeasonAnime((prev) => {
          const existingIds = new Set(prev.map((a) => a.id));
          const newOnes = found.filter((a) => !existingIds.has(a.id));
          return newOnes.length > 0 ? [...prev, ...newOnes] : prev;
        });
      }
    }
    setLoadingSeason(false);
    // Persist to cache
    setSeasonAnime((final) => { setCachedSeason(final); return final; });
  }

  function goToSeasonAnime(anime) {
    if (anime.voiranimeId) {
      navigate(`/anime/${anime.voiranimeSource}/${encodeURIComponent(anime.voiranimeId)}`);
    }
  }

  async function removeProgress(animeId) {
    await api.deleteProgress(animeId);
    setProgress((p) => p.filter((x) => x.anime_id !== animeId));
  }

  return (
    <div className="relative max-w-7xl mx-auto px-4 sm:px-6 py-8">
      {/* Global blurred background on hover */}
      <div
        className={`fixed inset-0 -z-10 transition-opacity duration-700 pointer-events-none ${
          hoveredCover ? 'opacity-20' : 'opacity-0'
        }`}
      >
        {hoveredCover && (
          <img
            src={hoveredCover}
            alt=""
            className="w-full h-full object-cover"
            style={{ filter: 'blur(60px) saturate(1.8) brightness(0.6)' }}
          />
        )}
      </div>

      {/* Continue Watching */}
      {progress.length > 0 && (
        <section className="mb-12">
          <div className="flex items-center gap-2 mb-5">
            <Clock className="w-5 h-5 text-accent-primary" />
            <h2 className="font-display font-bold text-xl text-white">Continuer à regarder</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {progress.map((p) => (
              <div
                key={p.anime_id}
                className="bg-bg-card rounded-xl overflow-hidden border border-white/5 hover:border-accent-primary/20 transition-all group animate-fade-up"
                onMouseEnter={() => setHoveredCover(p.anime_cover)}
                onMouseLeave={() => setHoveredCover(null)}
              >
                <div className="flex gap-4 p-4">
                  {/* Thumbnail */}
                  <Link
                    to={`/anime/${p.source}/${encodeURIComponent(p.anime_id)}`}
                    className="shrink-0 w-16 h-22 rounded-lg overflow-hidden"
                  >
                    <img
                      src={p.anime_cover || ''}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  </Link>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <Link to={`/anime/${p.source}/${encodeURIComponent(p.anime_id)}`}>
                      <h3 className="font-display font-semibold text-sm text-white/90 truncate group-hover:text-accent-primary transition-colors">
                        {p.anime_title}
                      </h3>
                    </Link>
                    <p className="text-xs text-white/40 mt-1">
                      Episode {p.episode_number}
                      {p.total_episodes ? ` / ${p.total_episodes}` : ''}
                    </p>

                    {/* Progress bar */}
                    {p.timestamp > 0 && (
                      <div className="w-full h-1 bg-white/10 rounded-full mt-3">
                        <div
                          className="h-full bg-accent-primary rounded-full"
                          style={{ width: `${Math.min((p.timestamp / (24 * 60)) * 100, 95)}%` }}
                        />
                      </div>
                    )}

                    <div className="flex items-center gap-2 mt-3">
                      <button
                        disabled={resumingId === p.anime_id}
                        onClick={async () => {
                          setResumingId(p.anime_id);
                          try {
                            const eps = await api.getEpisodes(p.source, p.anime_id);
                            const ep = eps.find((e) => e.number === p.episode_number) || eps[0];
                            if (ep) {
                              sessionStorage.setItem('currentAnime', JSON.stringify({
                                animeId: p.anime_id,
                                source: p.source,
                                title: p.anime_title,
                                cover: p.anime_cover || '',
                                episodes: eps,
                                totalEpisodes: eps.length,
                                episodeNumber: p.episode_number,
                              }));
                              navigate(`/watch/${p.source}/${ep.id}`);
                            } else {
                              navigate(`/anime/${p.source}/${encodeURIComponent(p.anime_id)}`);
                            }
                          } catch {
                            navigate(`/anime/${p.source}/${encodeURIComponent(p.anime_id)}`);
                          } finally {
                            setResumingId(null);
                          }
                        }}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-accent-primary text-white text-xs font-medium hover:bg-accent-glow transition disabled:opacity-60"
                      >
                        {resumingId === p.anime_id ? (
                          <div className="w-3 h-3 border border-white/40 border-t-white rounded-full animate-spin" />
                        ) : (
                          <Play className="w-3 h-3 fill-white" />
                        )}
                        {resumingId === p.anime_id ? 'Chargement...' : 'Reprendre'}
                      </button>
                      <button
                        onClick={() => removeProgress(p.anime_id)}
                        className="p-1.5 rounded-lg text-white/20 hover:text-red-400 hover:bg-red-400/10 transition"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Latest Episodes Carousel */}
      {latestEpisodes.length > 0 && (
        <section className="mb-12">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <Flame className="w-5 h-5 text-orange-400" />
              <h2 className="font-display font-bold text-xl text-white">Dernières sorties</h2>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => carouselRef.current?.scrollBy({ left: -300, behavior: 'smooth' })}
                className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition text-white/60 hover:text-white"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => carouselRef.current?.scrollBy({ left: 300, behavior: 'smooth' })}
                className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition text-white/60 hover:text-white"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div
            ref={carouselRef}
            className="flex gap-4 overflow-x-auto scrollbar-hide pb-2 snap-x snap-mandatory"
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          >
            {latestEpisodes.map((anime) => {
              const hasCover = Boolean(anime.cover?.trim()) && !imgErrors.has(anime.id);
              // If latest episode is available, go directly to watch it; otherwise go to anime page
              const href = anime.latestEpisodeId
                ? `/watch/${anime.source}/${anime.latestEpisodeId}`
                : `/anime/${anime.source}/${encodeURIComponent(anime.id)}`;

              const handleClick = (e) => {
                if (anime.latestEpisodeId) {
                  e.preventDefault();
                  // Store anime context with episode number for WatchPage
                  sessionStorage.setItem('currentAnime', JSON.stringify({
                    animeId: anime.id,
                    title: anime.title,
                    cover: anime.cover || '',
                    source: anime.source,
                    episodeNumber: anime.latestEpisode,
                  }));
                  navigate(href);
                }
              };

              return (
                <Link
                  key={`latest-${anime.id}`}
                  to={href}
                  onClick={handleClick}
                  onMouseEnter={() => setHoveredCover(anime.cover)}
                  onMouseLeave={() => setHoveredCover(null)}
                  className="flex-shrink-0 w-44 snap-start group"
                >
                  <div className="relative aspect-[3/4] rounded-xl overflow-hidden bg-bg-card">
                    {/* Cover image */}
                    {hasCover && (
                      <img
                        src={anime.cover}
                        alt={anime.title}
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110"
                        loading="lazy"
                        decoding="async"
                        referrerPolicy="no-referrer"
                        onError={() => setImgErrors((prev) => new Set(prev).add(anime.id))}
                      />
                    )}

                    {/* Placeholder (no cover, error, or loading) */}
                    {!hasCover && (
                      <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-white/10 to-white/5">
                        <span className="text-3xl font-bold text-white/30 select-none">
                          {anime.title?.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?'}
                        </span>
                        <Film className="absolute bottom-2 right-2 w-5 h-5 text-white/20" />
                      </div>
                    )}

                    {/* Episode badge */}
                    {anime.latestEpisode && (
                      <div className="absolute bottom-2 left-2 bg-accent-primary/90 backdrop-blur-sm text-white text-[11px] font-bold px-2 py-0.5 rounded-md">
                        Ep. {anime.latestEpisode}
                      </div>
                    )}
                    {/* Rating badge */}
                    {anime.rating && (
                      <div className="absolute top-2 right-2 bg-black/60 backdrop-blur-sm text-yellow-400 text-[10px] font-semibold px-1.5 py-0.5 rounded-md">
                        ★ {anime.rating}
                      </div>
                    )}
                    {/* Hover overlay */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
                      <div className="w-10 h-10 rounded-full bg-accent-primary/90 flex items-center justify-center shadow-lg">
                        <Play className="w-5 h-5 text-white fill-white ml-0.5" />
                      </div>
                    </div>
                  </div>
                  <p className="mt-2 text-xs font-medium text-white/80 line-clamp-2 group-hover:text-accent-primary transition-colors">
                    {anime.title}
                  </p>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Season Anime */}
      <section>
        <div className="flex items-center gap-2 mb-5">
          <Sparkles className="w-5 h-5 text-purple-400" />
          <h2 className="font-display font-bold text-xl text-white">Animes de la saison</h2>
        </div>
        {seasonAnime.length > 0 ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 sm:gap-5">
              {seasonAnime.map((anime, i) => {
                const hasCover = Boolean(anime.cover?.trim()) && !imgErrors.has(anime.id);
                return (
                  <div
                    key={anime.id}
                    onClick={() => goToSeasonAnime(anime)}
                    onMouseEnter={() => setHoveredCover(anime.cover)}
                    onMouseLeave={() => setHoveredCover(null)}
                    className={`group block animate-fade-up animate-fade-up-delay-${(i % 4) + 1} cursor-pointer`}
                  >
                    <div className="relative aspect-[3/4] rounded-xl overflow-hidden bg-bg-card">
                      {hasCover && (
                        <img
                          src={anime.cover}
                          alt={anime.title}
                          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110"
                          loading="lazy"
                          decoding="async"
                          referrerPolicy="no-referrer"
                          onError={() => setImgErrors((prev) => new Set(prev).add(anime.id))}
                        />
                      )}
                      {!hasCover && (
                        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-white/10 to-white/5">
                          <span className="text-3xl font-bold text-white/30 select-none">
                            {anime.title?.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?'}
                          </span>
                          <Film className="absolute bottom-2 right-2 w-5 h-5 text-white/20" />
                        </div>
                      )}
                      {/* Score badge */}
                      {anime.score && (
                        <div className="absolute top-2 right-2 bg-black/60 backdrop-blur-sm text-yellow-400 text-[10px] font-semibold px-1.5 py-0.5 rounded-md">
                          ★ {anime.score}
                        </div>
                      )}
                      {/* Episodes badge */}
                      {(anime.airedEpisodes || anime.episodes) && (
                        <div className="absolute bottom-2 left-2 bg-black/60 backdrop-blur-sm text-white/80 text-[10px] font-semibold px-1.5 py-0.5 rounded-md">
                          {anime.airedEpisodes ? `${anime.airedEpisodes}` : ''}{anime.airedEpisodes && anime.episodes ? ' / ' : ''}{anime.episodes ? `${anime.episodes}` : ''} ep.
                        </div>
                      )}
                      {/* Hover overlay */}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
                        <div className="w-10 h-10 rounded-full bg-accent-primary/90 flex items-center justify-center shadow-lg">
                          <Play className="w-5 h-5 text-white fill-white ml-0.5" />
                        </div>
                      </div>
                    </div>
                    <div className="mt-2.5 px-0.5">
                      <h3 className="font-display font-semibold text-sm text-white/90 leading-tight line-clamp-2 group-hover:text-accent-primary transition-colors">
                        {anime.title}
                      </h3>
                    </div>
                  </div>
                );
              })}
            </div>
            {loadingSeason && (
              <div className="flex items-center justify-center py-6">
                <div className="w-6 h-6 border-2 border-white/10 border-t-purple-400 rounded-full animate-spin" />
                <span className="ml-3 text-white/30 text-sm">Recherche en cours...</span>
              </div>
            )}
          </>
        ) : loadingSeason ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-white/10 border-t-purple-400 rounded-full animate-spin" />
          </div>
        ) : (
          <div className="text-center py-20 text-white/30">
            <p className="font-display text-lg">Aucun anime de saison trouvé</p>
          </div>
        )}
      </section>
    </div>
  );
}