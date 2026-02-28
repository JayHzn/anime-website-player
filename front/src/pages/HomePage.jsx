import { useState, useEffect, useRef } from 'react';
import { Link, useOutletContext, useNavigate } from 'react-router-dom';
import { Play, Clock, Trash2, ChevronLeft, ChevronRight, Flame, Film } from 'lucide-react';
import { api, onCoversUpdate } from '../api';
import AnimeCard from '../components/AnimeCard';

export default function HomePage() {
  const { selectedSource } = useOutletContext();
  const navigate = useNavigate();
  const [progress, setProgress] = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [latestEpisodes, setLatestEpisodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [imgErrors, setImgErrors] = useState(new Set());
  const carouselRef = useRef(null);

  useEffect(() => {
    loadData();
  }, [selectedSource]);

  // Listen for cover updates — merge uniquement les cartes modifiées (évite re-renders en cascade)
  useEffect(() => {
    return onCoversUpdate((patches) => {
      setSearchResults((prev) =>
        prev.map((a) => {
          const p = patches.find((x) => x.id === a.id && x.source === a.source);
          return p ? { ...a, cover: p.cover } : a;
        })
      );
    });
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [prog, results, latest] = await Promise.all([
        api.getProgress(),
        api.search('', selectedSource),
        api.getLatestEpisodes(selectedSource).catch(() => []),
      ]);
      setProgress(prog);
      setSearchResults(results);
      setLatestEpisodes(latest);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function removeProgress(animeId) {
    await api.deleteProgress(animeId);
    setProgress((p) => p.filter((x) => x.anime_id !== animeId));
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
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
                      <Link
                        to={`/anime/${p.source}/${encodeURIComponent(p.anime_id)}`}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-accent-primary text-white text-xs font-medium hover:bg-accent-glow transition"
                      >
                        <Play className="w-3 h-3 fill-white" />
                        Reprendre
                      </Link>
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
              <h2 className="font-display font-bold text-xl text-white">Derniers épisodes</h2>
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
                  // Store anime context so WatchPage can find prev/next episodes
                  sessionStorage.setItem('currentAnime', JSON.stringify({
                    animeId: anime.id,
                    title: anime.title,
                    cover: anime.cover || '',
                    source: anime.source,
                  }));
                  navigate(href);
                }
              };

              return (
                <Link
                  key={`latest-${anime.id}`}
                  to={href}
                  onClick={handleClick}
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

      {/* Browse / Catalogue */}
      <section>
        <h2 className="font-display font-bold text-xl text-white mb-5">
          Catalogue
        </h2>
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-white/10 border-t-accent-primary rounded-full animate-spin" />
          </div>
        ) : searchResults.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 sm:gap-5">
            {searchResults.map((anime, i) => (
              <AnimeCard key={`${anime.source}-${anime.id}`} anime={anime} index={i} />
            ))}
          </div>
        ) : (
          <div className="text-center py-20 text-white/30">
            <p className="font-display text-lg">Aucun anime trouvé</p>
            <p className="text-sm mt-1">Essaie de chercher quelque chose !</p>
          </div>
        )}
      </section>
    </div>
  );
}