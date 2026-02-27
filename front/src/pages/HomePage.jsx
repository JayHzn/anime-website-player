import { useState, useEffect } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { Play, Clock, Trash2 } from 'lucide-react';
import { api, onCoversUpdate } from '../api';
import AnimeCard from '../components/AnimeCard';

export default function HomePage() {
  const { selectedSource } = useOutletContext();
  const [progress, setProgress] = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [loading, setLoading] = useState(true);

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
      const [prog, results] = await Promise.all([
        api.getProgress(),
        api.search('', selectedSource),
      ]);
      setProgress(prog);
      setSearchResults(results);
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