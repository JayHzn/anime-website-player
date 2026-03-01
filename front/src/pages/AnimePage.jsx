import { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Play, CheckCircle2, Film } from 'lucide-react';
import { api } from '../api';

function getInitials(title) {
  if (!title?.trim()) return '?';
  const words = title.trim().split(/\s+/);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase().slice(0, 2);
  return title.slice(0, 2).toUpperCase();
}

/** Clean title for VF/VOSTFR search — returns multiple search terms to try */
function getSearchTerms(title) {
  if (!title) return [];
  // Strip VF/VOSTFR suffix
  let clean = title
    .replace(/\s*[-–—]\s*(VOSTFR|VF|vostfr|vf)\s*$/i, '')
    .replace(/\s+(VOSTFR|VF|vostfr|vf)\s*$/i, '')
    .trim();

  const terms = [clean];

  // Remove brackets: [Oshi no Ko] → Oshi no Ko
  const noBrackets = clean.replace(/[\[\]()]/g, '').replace(/\s+/g, ' ').trim();
  if (noBrackets !== clean) terms.push(noBrackets);

  // Replace "Xrd/nd/st/th Season" with just the number: "3rd Season" → "3"
  const noSeason = noBrackets
    .replace(/\s*(\d+)(?:st|nd|rd|th)\s*season/i, ' $1')
    .replace(/\s*season\s*(\d+)/i, ' $1')
    .replace(/\s+/g, ' ')
    .trim();
  if (noSeason !== noBrackets) terms.push(noSeason);

  return terms;
}

export default function AnimePage() {
  const { source, animeId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [episodes, setEpisodes] = useState([]);
  const [animeInfo, setAnimeInfo] = useState(null);
  const [progress, setProgress] = useState(null);
  const [loading, setLoading] = useState(true);
  const [coverLoaded, setCoverLoaded] = useState(false);
  const [coverError, setCoverError] = useState(false);
  const [altLang, setAltLang] = useState(null); // { id, lang } if alternate version exists
  const currentLang = animeId.endsWith('-vf') ? 'VF' : 'VOSTFR';

  useEffect(() => {
    loadAnime();
  }, [source, animeId]);

  async function loadAnime() {
    setLoading(true);
    setAltLang(null);
    try {
      const [eps, prog, info] = await Promise.all([
        api.getEpisodes(source, animeId),
        api.getAnimeProgress(animeId).catch(() => null),
        api.getAnimeInfo(source, animeId).catch(() => null),
      ]);
      setEpisodes(eps);
      setProgress(prog);
      // Use cover passed via navigation state (from catalogue) — more reliable than Jikan search
      const navCover = location.state?.cover;
      if (info) {
        if (navCover) info.cover = navCover;
        setAnimeInfo(info);
      } else if (navCover) {
        setAnimeInfo({ id: animeId, title: animeId.replace(/-/g, ' '), cover: navCover, type: '', year: null });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }

    // Find alternate VF/VOSTFR version (non-blocking — don't delay page render)
    try {
      const isVF = animeId.endsWith('-vf');
      const altLangLabel = isVF ? 'VOSTFR' : 'VF';

      // Strategy 1: try direct slug (most reliable)
      const directSlug = isVF ? animeId.replace(/-vf$/, '') : animeId + '-vf';
      try {
        const altEps = await api.getEpisodes(source, directSlug);
        if (altEps && altEps.length > 0) {
          setAltLang({ id: directSlug, lang: altLangLabel });
          return;
        }
      } catch { /* try strategy 2 */ }

      // Strategy 2: search by title variants, match closest slug
      const title = animeInfo?.title || animeId;
      const terms = getSearchTerms(title);
      const baseSlug = isVF ? animeId.replace(/-vf$/, '') : animeId;

      for (const term of terms) {
        const searchQuery = isVF ? term : term + ' VF';
        const results = await api.search(searchQuery, source);
        const altResult = results.find((r) => {
          if (r.id === animeId) return false;
          const rIsVF = r.id.endsWith('-vf');
          if (rIsVF === isVF) return false;
          const rBase = rIsVF ? r.id.replace(/-vf$/, '') : r.id;
          return rBase === baseSlug || rBase.includes(baseSlug);
        });
        if (altResult) {
          setAltLang({ id: altResult.id, lang: altLangLabel });
          break;
        }
      }
    } catch { /* no alt found */ }
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
  const title = animeInfo?.title || animeId;
  const hasCover = Boolean(animeInfo?.cover?.trim());
  const showPlaceholder = !hasCover || coverError || (hasCover && !coverLoaded);

  useEffect(() => {
    setCoverLoaded(false);
    setCoverError(false);
  }, [animeInfo?.cover]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-white/10 border-t-accent-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div>
      {/* Banner background */}
      <div className="relative -mt-16 pt-16 mb-8 overflow-hidden">
        {/* Blurred cover background */}
        {hasCover && coverLoaded && (
          <div className="absolute inset-0 -z-10">
            <img
              src={animeInfo.cover}
              alt=""
              className="w-full h-full object-cover"
              style={{ filter: 'blur(40px) saturate(1.5) brightness(0.4)', transform: 'scale(1.2)' }}
            />
            {/* Gradient overlays */}
            <div className="absolute inset-0 bg-gradient-to-b from-bg-primary/60 via-transparent to-bg-primary" />
            <div className="absolute inset-0 bg-gradient-to-r from-bg-primary/80 via-bg-primary/20 to-transparent" />
          </div>
        )}

        {/* Hero content */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-10 pb-8">
          <div className="flex flex-col sm:flex-row gap-6 animate-fade-up">
            {/* Cover */}
            <div className="relative shrink-0 w-48 aspect-[3/4] rounded-xl overflow-hidden shadow-2xl shadow-black/50 bg-bg-card ring-1 ring-white/10">
              {hasCover && (
                <img
                  src={animeInfo.cover}
                  alt=""
                  className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
                    coverLoaded ? 'opacity-100' : 'opacity-0'
                  }`}
                  onLoad={() => setCoverLoaded(true)}
                  onError={() => setCoverError(true)}
                />
              )}
              <div
                className={`absolute inset-0 flex items-center justify-center bg-gradient-to-br from-white/10 to-white/5 transition-opacity duration-300 ${
                  showPlaceholder ? 'opacity-100' : 'opacity-0 pointer-events-none'
                }`}
                aria-hidden={!showPlaceholder}
              >
                <span className="text-4xl font-bold text-white/30 select-none">{getInitials(title)}</span>
                <Film className="absolute bottom-3 right-3 w-8 h-8 text-white/20" aria-hidden />
              </div>
            </div>

            {/* Info */}
            <div className="flex-1">
              <h1 className="font-display font-extrabold text-2xl sm:text-3xl text-white leading-tight drop-shadow-lg">
                {title}
              </h1>

              <div className="flex flex-wrap items-center gap-3 mt-3 text-sm text-white/50">
                {animeInfo?.year && <span>{animeInfo.year}</span>}
                {animeInfo?.type && (
                  <span className="px-2 py-0.5 bg-white/10 rounded-md text-xs">{animeInfo.type}</span>
                )}
                <span>{episodes.length} épisodes</span>
                <span className="text-xs bg-white/10 px-2 py-0.5 rounded-md">{source}</span>
              </div>

              {/* VF / VOSTFR toggle */}
              {altLang && (
                <div className="flex items-center gap-1 mt-4 bg-black/30 backdrop-blur-sm rounded-xl p-1 w-fit">
                  <button
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                      currentLang === 'VOSTFR'
                        ? 'bg-accent-primary text-white shadow'
                        : 'text-white/50 hover:text-white hover:bg-white/5'
                    }`}
                    onClick={() => {
                      if (currentLang !== 'VOSTFR') {
                        navigate(`/anime/${source}/${encodeURIComponent(altLang.id)}`, { replace: true });
                      }
                    }}
                  >
                    VOSTFR
                  </button>
                  <button
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                      currentLang === 'VF'
                        ? 'bg-accent-primary text-white shadow'
                        : 'text-white/50 hover:text-white hover:bg-white/5'
                    }`}
                    onClick={() => {
                      if (currentLang !== 'VF') {
                        navigate(`/anime/${source}/${encodeURIComponent(altLang.id)}`, { replace: true });
                      }
                    }}
                  >
                    VF
                  </button>
                </div>
              )}

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
        </div>
      </div>

      {/* Episodes */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 pb-8">
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
    </div>
  );
}