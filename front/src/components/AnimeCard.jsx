import { memo, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Play, Film } from 'lucide-react';

/** First 2 letters of title for placeholder */
function getInitials(title) {
  if (!title?.trim()) return '?';
  const words = title.trim().split(/\s+/);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase().slice(0, 2);
  return title.slice(0, 2).toUpperCase();
}

export default memo(function AnimeCard({ anime, index = 0 }) {
  const delayClass = `animate-fade-up-delay-${(index % 4) + 1}`;
  const hasCover = Boolean(anime.cover?.trim());
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const showPlaceholder = !hasCover || error || (hasCover && !loaded);

  useEffect(() => {
    setLoaded(false);
    setError(false);
  }, [anime.cover]);

  return (
    <Link
      to={`/anime/${anime.source}/${encodeURIComponent(anime.id)}`}
      className={`group block animate-fade-up ${delayClass}`}
    >
      <div className="relative aspect-[3/4] rounded-xl overflow-hidden bg-bg-card">
        {/* Cover image */}
        {hasCover && (
          <img
            src={anime.cover}
            alt={anime.title}
            className={`w-full h-full object-cover transition-all duration-500 group-hover:scale-110 ${
              loaded ? 'opacity-100' : 'opacity-0'
            }`}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onLoad={() => setLoaded(true)}
            onError={() => setError(true)}
          />
        )}

        {/* Placeholder when no cover, loading or error */}
        <div
          className={`absolute inset-0 flex items-center justify-center bg-gradient-to-br from-white/10 to-white/5 transition-opacity duration-300 ${
            showPlaceholder ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
          aria-hidden={!showPlaceholder}
        >
          <span className="text-3xl font-bold text-white/30 select-none">
            {getInitials(anime.title)}
          </span>
          <Film className="absolute bottom-2 right-2 w-6 h-6 text-white/20" aria-hidden />
        </div>

        {/* Overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
          <div className="absolute bottom-0 left-0 right-0 p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-full bg-accent-primary flex items-center justify-center">
                <Play className="w-4 h-4 text-white fill-white" />
              </div>
              <span className="text-xs text-white/70 font-medium">Regarder</span>
            </div>
          </div>
        </div>

        {/* Type badge */}
        {anime.type && (
          <div className="absolute top-2 right-2 bg-black/60 backdrop-blur-sm text-[10px] font-semibold text-white/80 px-2 py-0.5 rounded-md uppercase tracking-wider">
            {anime.type}
          </div>
        )}
      </div>

      {/* Title */}
      <div className="mt-2.5 px-0.5">
        <h3 className="font-display font-semibold text-sm text-white/90 leading-tight line-clamp-2 group-hover:text-accent-primary transition-colors">
          {anime.title}
        </h3>
        {anime.year && (
          <p className="text-xs text-white/30 mt-1">{anime.year}</p>
        )}
      </div>
    </Link>
  );
})