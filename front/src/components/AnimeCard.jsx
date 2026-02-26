import { memo } from 'react';
import { Link } from 'react-router-dom';
import { Play } from 'lucide-react';

export default memo(function AnimeCard({ anime, index = 0 }) {
  const delayClass = `animate-fade-up-delay-${(index % 4) + 1}`;

  return (
    <Link
      to={`/anime/${anime.source}/${encodeURIComponent(anime.id)}`}
      className={`group block animate-fade-up ${delayClass}`}
    >
      <div className="relative aspect-[3/4] rounded-xl overflow-hidden bg-bg-card">
        {/* Cover image */}
        <img
          src={anime.cover}
          alt={anime.title}
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
          loading="lazy"
        />

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