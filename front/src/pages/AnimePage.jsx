import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Play, CheckCircle2 } from 'lucide-react';
import { api } from '../api';

export default function AnimePage() {
  const { source, animeId } = useParams();
  const navigate = useNavigate();
  const [episodes, setEpisodes] = useState([]);
  const [animeInfo, setAnimeInfo] = useState(null);
  const [progress, setProgress] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAnime();
  }, [source, animeId]);

  async function loadAnime() {
    setLoading(true);
    try {
      const [eps, prog, info] = await Promise.all([
        api.getEpisodes(source, animeId),
        api.getAnimeProgress(animeId).catch(() => null),
        api.getAnimeInfo(source, animeId).catch(() => null),
      ]);
      setEpisodes(eps);
      setProgress(prog);
      if (info) setAnimeInfo(info);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  function playEpisode(episode) {
    // Store anime info in sessionStorage for the watch page
    sessionStorage.setItem(
      'currentAnime',
      JSON.stringify({
        animeId,
        source,
        title: animeInfo?.title || animeId,
        cover: animeInfo?.cover || '',
        episodes,
        totalEpisodes: episodes.length,
      })
    );
    navigate(`/watch/${source}/${episode.id}`);
  }

  const currentEp = progress?.episode_number || 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-white/10 border-t-accent-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      {/* Hero */}
      <div className="flex flex-col sm:flex-row gap-6 mb-10 animate-fade-up">
        {/* Cover */}
        {animeInfo?.cover && (
          <div className="shrink-0 w-48 aspect-[3/4] rounded-xl overflow-hidden shadow-2xl shadow-black/50">
            <img src={animeInfo.cover} alt="" className="w-full h-full object-cover" />
          </div>
        )}

        {/* Info */}
        <div className="flex-1">
          <h1 className="font-display font-extrabold text-2xl sm:text-3xl text-white leading-tight">
            {animeInfo?.title || animeId}
          </h1>

          <div className="flex flex-wrap items-center gap-3 mt-3 text-sm text-white/40">
            {animeInfo?.year && <span>{animeInfo.year}</span>}
            {animeInfo?.type && (
              <span className="px-2 py-0.5 bg-white/5 rounded-md text-xs">{animeInfo.type}</span>
            )}
            <span>{episodes.length} épisodes</span>
            <span className="text-xs bg-bg-card px-2 py-0.5 rounded-md">{source}</span>
          </div>

          {/* Resume button */}
          {progress && progress.episode_number > 0 && (
            <button
              onClick={() => {
                const ep = episodes.find((e) => e.number === progress.episode_number);
                if (ep) playEpisode(ep);
              }}
              className="mt-5 flex items-center gap-2 px-5 py-2.5 rounded-xl bg-accent-primary text-white font-display font-semibold text-sm hover:bg-accent-glow transition shadow-lg shadow-accent-primary/20"
            >
              <Play className="w-4 h-4 fill-white" />
              Reprendre Ep. {progress.episode_number}
            </button>
          )}
        </div>
      </div>

      {/* Episodes */}
      <section>
        <h2 className="font-display font-bold text-lg text-white mb-4">Épisodes</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {episodes.map((ep, i) => {
            const isWatched = ep.number < currentEp;
            const isCurrent = ep.number === currentEp;

            return (
              <button
                key={ep.id}
                onClick={() => playEpisode(ep)}
                className={`
                  group relative p-4 rounded-xl border text-left transition-all
                  animate-fade-up
                  ${isCurrent
                    ? 'bg-accent-primary/10 border-accent-primary/30'
                    : isWatched
                      ? 'bg-bg-card/50 border-white/5 opacity-60'
                      : 'bg-bg-card border-white/5 hover:border-accent-primary/20 hover:bg-bg-hover'
                  }
                `}
                style={{ animationDelay: `${(i % 12) * 30}ms`, opacity: 0 }}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className={`font-display font-bold text-lg ${isCurrent ? 'text-accent-primary' : 'text-white/80'}`}>
                    {ep.number}
                  </span>
                  {isWatched && <CheckCircle2 className="w-4 h-4 text-green-400/60" />}
                  {isCurrent && <Play className="w-4 h-4 text-accent-primary fill-accent-primary" />}
                </div>
                {ep.title && (
                  <p className="text-xs text-white/40 line-clamp-1">{ep.title}</p>
                )}

                {/* Hover play icon */}
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition bg-black/40 rounded-xl">
                  <Play className="w-6 h-6 text-white fill-white" />
                </div>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}