import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Clock, Play, Trash2 } from 'lucide-react';
import { api } from '../api';

export default function HistoryPage() {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getProgress()
      .then(setHistory)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  async function removeEntry(animeId) {
    await api.deleteProgress(animeId);
    setHistory((h) => h.filter((x) => x.anime_id !== animeId));
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-white/10 border-t-accent-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-center gap-2 mb-6">
        <Clock className="w-5 h-5 text-accent-primary" />
        <h1 className="font-display font-bold text-xl text-white">Historique</h1>
      </div>

      {history.length === 0 ? (
        <div className="text-center py-20 text-white/30">
          <p className="font-display text-lg">Aucun historique</p>
          <p className="text-sm mt-1">Les animes que tu regardes apparaitront ici</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 sm:gap-5">
          {history.map((item, i) => (
            <div
              key={item.anime_id}
              className="group animate-fade-up"
              style={{ animationDelay: `${(i % 12) * 30}ms`, opacity: 0 }}
            >
              <Link to={`/anime/${item.source}/${encodeURIComponent(item.anime_id)}`}>
                <div className="relative aspect-[3/4] rounded-xl overflow-hidden bg-bg-card">
                  {/* Cover */}
                  {item.anime_cover ? (
                    <img
                      src={item.anime_cover}
                      alt={item.anime_title}
                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-bg-secondary">
                      <Play className="w-8 h-8 text-white/10" />
                    </div>
                  )}

                  {/* Progress overlay at bottom */}
                  <div className="absolute bottom-0 left-0 right-0">
                    {/* Episode progress bar */}
                    {item.total_episodes && item.total_episodes > 0 && (
                      <div className="w-full h-1 bg-black/50">
                        <div
                          className="h-full bg-accent-primary"
                          style={{ width: `${Math.min((item.episode_number / item.total_episodes) * 100, 100)}%` }}
                        />
                      </div>
                    )}
                  </div>

                  {/* Hover overlay */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                    <div className="absolute bottom-0 left-0 right-0 p-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-accent-primary flex items-center justify-center">
                          <Play className="w-4 h-4 text-white fill-white" />
                        </div>
                        <span className="text-xs text-white/70 font-medium">Reprendre</span>
                      </div>
                    </div>
                  </div>

                  {/* Episode badge */}
                  <div className="absolute top-2 right-2 bg-black/70 backdrop-blur-sm text-[10px] font-semibold text-white/90 px-2 py-0.5 rounded-md">
                    Ep. {item.episode_number}{item.total_episodes ? ` / ${item.total_episodes}` : ''}
                  </div>

                  {/* Source badge */}
                  <div className="absolute top-2 left-2 bg-black/70 backdrop-blur-sm text-[10px] font-semibold text-white/60 px-2 py-0.5 rounded-md uppercase tracking-wider">
                    {item.source}
                  </div>
                </div>
              </Link>

              {/* Title + actions */}
              <div className="mt-2.5 px-0.5 flex items-start gap-2">
                <Link
                  to={`/anime/${item.source}/${encodeURIComponent(item.anime_id)}`}
                  className="flex-1 min-w-0"
                >
                  <h3 className="font-display font-semibold text-sm text-white/90 leading-tight line-clamp-2 group-hover:text-accent-primary transition-colors">
                    {item.anime_title}
                  </h3>
                </Link>
                <button
                  onClick={() => removeEntry(item.anime_id)}
                  className="shrink-0 p-1 rounded-lg text-white/20 hover:text-red-400 hover:bg-red-400/10 transition mt-0.5"
                  title="Supprimer de l'historique"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
