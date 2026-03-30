import { useState, useEffect, useRef } from 'react';
import { Link, useOutletContext, useNavigate } from 'react-router-dom';
import { Play, Clock, Trash2, ChevronLeft, ChevronRight, Flame, Film, Sparkles, Puzzle, MousePointer, RefreshCw, CheckCircle, Download, Monitor, Globe, Zap } from 'lucide-react';
import { api, onCoversUpdate, MIN_EXTENSION_VERSION } from '../api';

const EXTENSION_DOWNLOAD_URL = 'https://github.com/JayHzn/anime-website-player/raw/main/extension';

// ── Source list (shared between tutorial sections) ───────────

function SourceList() {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/5">
        <div className="w-8 h-8 rounded-lg bg-indigo-500/15 flex items-center justify-center text-indigo-400 font-bold text-xs">AS</div>
        <div>
          <span className="text-white/70 text-sm font-medium">Anime-sama</span>
          <span className="text-white/25 text-xs ml-2">anime-sama.to</span>
        </div>
      </div>
      <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/5">
        <div className="w-8 h-8 rounded-lg bg-pink-500/15 flex items-center justify-center text-pink-400 font-bold text-xs">FA</div>
        <div>
          <span className="text-white/70 text-sm font-medium">French-anime</span>
          <span className="text-white/25 text-xs ml-2">french-anime.com</span>
        </div>
      </div>
      <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/5">
        <div className="w-8 h-8 rounded-lg bg-emerald-500/15 flex items-center justify-center text-emerald-400 font-bold text-xs">VF</div>
        <div>
          <span className="text-white/70 text-sm font-medium">Vostfree</span>
          <span className="text-white/25 text-xs ml-2">vostfree.ws</span>
        </div>
      </div>
    </div>
  );
}

// ── Step component ───────────────────────────────────────────

function Step({ number, icon: Icon, title, children, delay }) {
  return (
    <div className={`flex gap-5 items-start animate-fade-up animate-fade-up-delay-${delay}`}>
      <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-accent-primary/10 border border-accent-primary/20 flex items-center justify-center">
        <span className="text-accent-primary font-bold text-sm">{number}</span>
      </div>
      <div className="flex-1 bg-bg-card rounded-xl border border-white/5 p-5">
        <div className="flex items-center gap-2 mb-2">
          <Icon className="w-4 h-4 text-accent-primary" />
          <h3 className="font-display font-semibold text-white text-sm">{title}</h3>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── Outdated extension page ───────────────────────────────────

function OutdatedPage() {
  return (
    <div className="relative max-w-2xl mx-auto px-4 sm:px-6 py-16 text-center animate-fade-up">
      <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-amber-500/10 border border-amber-500/20 mb-6">
        <RefreshCw className="w-10 h-10 text-amber-400" />
      </div>
      <h1 className="font-display font-bold text-3xl text-white mb-3">
        Extension obsolète
      </h1>
      <p className="text-white/40 text-base mb-2">
        Votre extension AnimeHub est trop ancienne pour fonctionner avec cette version du site.
      </p>
      <p className="text-white/25 text-sm mb-10">
        Version minimale requise : <span className="text-amber-400 font-mono">{MIN_EXTENSION_VERSION}</span>
      </p>

      <a
        href={EXTENSION_DOWNLOAD_URL}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-2.5 px-6 py-3 rounded-xl bg-accent-primary text-white font-semibold text-sm shadow-lg shadow-accent-primary/20 hover:bg-accent-primary/90 transition-all mb-10"
      >
        <Download className="w-4 h-4" />
        Télécharger la nouvelle version
      </a>

      <div className="bg-bg-card rounded-2xl border border-white/5 p-6 text-left space-y-4">
        <p className="text-white/50 text-sm font-semibold">Comment mettre à jour :</p>
        <ol className="space-y-3">
          {[
            'Téléchargez la nouvelle extension ci-dessus',
            'Ouvrez chrome://extensions dans Chrome',
            'Supprimez l\'ancienne extension AnimeHub',
            'Glissez-déposez le nouveau fichier .zip (ou dossier décompressé) dans la page',
          ].map((step, i) => (
            <li key={i} className="flex items-start gap-3 text-sm text-white/40">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-accent-primary/10 border border-accent-primary/20 flex items-center justify-center text-accent-primary text-xs font-bold mt-0.5">
                {i + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

// ── Welcome page (extension not detected) ────────────────────

function WelcomePage() {
  return (
    <div className="relative max-w-3xl mx-auto px-4 sm:px-6 py-16">
      {/* Hero */}
      <div className="text-center mb-14 animate-fade-up">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-accent-primary to-red-600 shadow-lg shadow-accent-primary/20 mb-6">
          <Play className="w-10 h-10 text-white fill-white ml-1" />
        </div>
        <h1 className="font-display font-bold text-4xl text-white mb-4">
          Anime<span className="text-accent-primary">Hub</span>
        </h1>
        <p className="text-white/50 text-lg max-w-lg mx-auto leading-relaxed">
          Regardez vos animes et dramas favoris en VF et VOSTFR, le tout depuis une seule interface.
        </p>
      </div>

      {/* Features */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-14 animate-fade-up animate-fade-up-delay-1">
        <div className="bg-bg-card rounded-xl border border-white/5 p-5 text-center">
          <Globe className="w-6 h-6 text-accent-primary mx-auto mb-3" />
          <h3 className="font-display font-semibold text-sm text-white mb-1">Multi-sources</h3>
          <p className="text-white/35 text-xs leading-relaxed">Plusieurs sources disponibles, changez en un clic</p>
        </div>
        <div className="bg-bg-card rounded-xl border border-white/5 p-5 text-center">
          <Monitor className="w-6 h-6 text-accent-primary mx-auto mb-3" />
          <h3 className="font-display font-semibold text-sm text-white mb-1">Lecteur integre</h3>
          <p className="text-white/35 text-xs leading-relaxed">Lecteur video complet avec reprise automatique</p>
        </div>
        <div className="bg-bg-card rounded-xl border border-white/5 p-5 text-center">
          <Zap className="w-6 h-6 text-accent-primary mx-auto mb-3" />
          <h3 className="font-display font-semibold text-sm text-white mb-1">Rapide</h3>
          <p className="text-white/35 text-xs leading-relaxed">Recherche instantanee et navigation fluide</p>
        </div>
      </div>

      {/* Download CTA */}
      <div className="bg-bg-card rounded-2xl border border-accent-primary/15 p-8 text-center mb-14 animate-fade-up animate-fade-up-delay-2">
        <Puzzle className="w-10 h-10 text-accent-primary mx-auto mb-4" />
        <h2 className="font-display font-bold text-xl text-white mb-2">Extension requise</h2>
        <p className="text-white/40 text-sm mb-6 max-w-md mx-auto">
          AnimeHub a besoin d'une extension navigateur pour fonctionner. Telechargez-la et installez-la en quelques etapes.
        </p>
        <a
          href={EXTENSION_DOWNLOAD_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-accent-primary text-white font-semibold text-sm hover:bg-accent-glow transition-all shadow-lg shadow-accent-primary/20 hover:shadow-accent-primary/40"
        >
          <Download className="w-4 h-4" />
          Telecharger l'extension
        </a>
      </div>

      {/* Install tutorial */}
      <div className="mb-6">
        <h2 className="font-display font-bold text-lg text-white mb-6 flex items-center gap-2">
          <span className="w-8 h-[2px] bg-accent-primary/50 rounded-full"></span>
          Comment installer
        </h2>
      </div>

      <div className="space-y-5">
        <Step number="1" icon={Download} title="Telecharger l'extension" delay={1}>
          <p className="text-white/40 text-sm leading-relaxed">
            Cliquez sur le bouton ci-dessus pour acceder au dossier de l'extension sur GitHub. Telechargez le dossier <span className="text-white/70 font-medium">extension</span> complet (ou clonez le repo).
          </p>
        </Step>

        <Step number="2" icon={Monitor} title="Ouvrir les extensions Chrome" delay={2}>
          <p className="text-white/40 text-sm leading-relaxed">
            Allez dans <span className="text-white/70 font-medium">chrome://extensions</span> et activez le <span className="text-white/70 font-medium">mode developpeur</span> en haut a droite.
          </p>
        </Step>

        <Step number="3" icon={Puzzle} title="Charger l'extension" delay={3}>
          <p className="text-white/40 text-sm leading-relaxed">
            Cliquez sur <span className="text-white/70 font-medium">"Charger l'extension non empaquetee"</span> et selectionnez le dossier <span className="text-white/70 font-medium">extension/</span> que vous avez telecharge.
          </p>
        </Step>

        <Step number="4" icon={RefreshCw} title="Recharger la page" delay={4}>
          <p className="text-white/40 text-sm leading-relaxed">
            Rechargez cette page. L'extension sera detectee automatiquement et vous pourrez choisir votre source.
          </p>
        </Step>
      </div>

      <div className="text-center mt-10">
        <button
          onClick={() => window.location.reload()}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white/60 text-sm hover:bg-white/10 hover:text-white transition-all"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Recharger la page
        </button>
      </div>
    </div>
  );
}

// ── Source tutorial (extension OK, no source selected) ────────

function SourceTutorial() {
  return (
    <div className="relative max-w-3xl mx-auto px-4 sm:px-6 py-16">
      {/* Header */}
      <div className="text-center mb-12 animate-fade-up">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-accent-primary/10 border border-accent-primary/20 mb-6">
          <CheckCircle className="w-8 h-8 text-emerald-400" />
        </div>
        <h1 className="font-display font-bold text-3xl text-white mb-3">
          Extension detectee !
        </h1>
        <p className="text-white/50 text-base max-w-md mx-auto">
          Il ne reste plus qu'a choisir une source pour commencer.
        </p>
      </div>

      {/* Steps */}
      <div className="space-y-6">
        <Step number="1" icon={MousePointer} title="Ouvrir l'extension" delay={1}>
          <p className="text-white/40 text-sm leading-relaxed">
            Cliquez sur l'icone <span className="text-white/70 font-medium">AnimeHub</span> dans la barre d'extensions de votre navigateur (en haut a droite).
          </p>
        </Step>

        <Step number="2" icon={CheckCircle} title="Choisir une source" delay={2}>
          <p className="text-white/40 text-sm leading-relaxed mb-3">
            Selectionnez la source que vous souhaitez utiliser :
          </p>
          <SourceList />
        </Step>

        <Step number="3" icon={RefreshCw} title="C'est tout !" delay={3}>
          <p className="text-white/40 text-sm leading-relaxed">
            La page se rechargera automatiquement et vous pourrez parcourir le catalogue de la source choisie. Pour changer de source, rouvrez simplement l'extension.
          </p>
        </Step>
      </div>

      {/* Footer hint */}
      <div className="text-center mt-10 animate-fade-up animate-fade-up-delay-4">
        <p className="text-white/20 text-xs">
          Vous pouvez changer de source a tout moment via l'extension
        </p>
      </div>
    </div>
  );
}


// ── Main HomePage ────────────────────────────────────────────

export default function HomePage() {
  const { selectedSource, extMissing, extOutdated } = useOutletContext();
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
    if (selectedSource) loadData();
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
      setSeasonAnime((prev) =>
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

  async function loadData() {
    setLoading(true);
    try {
      const [prog, results, latest, season] = await Promise.all([
        api.getProgress(),
        api.search('', selectedSource),
        api.getLatestEpisodes(selectedSource).catch(() => []),
        api.getSeasonAnime(selectedSource).catch(() => []),
      ]);

      setProgress(prog);
      setSearchResults(results);
      setLatestEpisodes(latest);
      setSeasonAnime(season);
      setLoading(false);
      setLoadingSeason(false);
    } catch (e) {
      console.error(e);
      setLoading(false);
      setLoadingSeason(false);
    }
  }

  async function removeProgress(animeId) {
    await api.deleteProgress(animeId);
    setProgress((p) => p.filter((x) => x.anime_id !== animeId));
  }

  // Extension not installed → welcome page with download + install tutorial
  if (extMissing) return <WelcomePage />;

  // Extension installed but outdated → force update
  if (extOutdated) return <OutdatedPage />;

  // Extension OK but no source selected → source selection tutorial
  if (!selectedSource) return <SourceTutorial />;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <div className="w-10 h-10 border-2 border-white/10 border-t-accent-primary rounded-full animate-spin" />
        <p className="text-white/40 text-sm font-display">Chargement...</p>
      </div>
    );
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
              const href = anime.latestEpisodeId
                ? `/watch/${anime.source}/${anime.latestEpisodeId}`
                : `/anime/${anime.source}/${encodeURIComponent(anime.id)}`;

              const handleClick = (e) => {
                if (anime.latestEpisodeId) {
                  e.preventDefault();
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
                    {anime.latestEpisode && (
                      <div className="absolute bottom-2 left-2 bg-accent-primary/90 backdrop-blur-sm text-white text-[11px] font-bold px-2 py-0.5 rounded-md">
                        Ep. {anime.latestEpisode}
                      </div>
                    )}
                    {anime.rating && (
                      <div className="absolute top-2 right-2 bg-black/60 backdrop-blur-sm text-yellow-400 text-[10px] font-semibold px-1.5 py-0.5 rounded-md">
                        ★ {anime.rating}
                      </div>
                    )}
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

      {/* Catalogue */}
      <section>
        <div className="flex items-center gap-2 mb-5">
          <Sparkles className="w-5 h-5 text-purple-400" />
          <h2 className="font-display font-bold text-xl text-white">Catalogue</h2>
        </div>
        {seasonAnime.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 sm:gap-5">
            {seasonAnime.map((anime, i) => {
              const hasCover = Boolean(anime.cover?.trim()) && !imgErrors.has(anime.id);
              return (
                <Link
                  key={anime.id}
                  to={`/anime/${anime.source || selectedSource}/${encodeURIComponent(anime.id)}`}
                  onMouseEnter={() => setHoveredCover(anime.cover)}
                  onMouseLeave={() => setHoveredCover(null)}
                  className={`group block animate-fade-up animate-fade-up-delay-${(i % 4) + 1}`}
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
                    {anime.score && (
                      <div className="absolute top-2 right-2 bg-black/60 backdrop-blur-sm text-yellow-400 text-[10px] font-semibold px-1.5 py-0.5 rounded-md">
                        ★ {anime.score}
                      </div>
                    )}
                    {(anime.airedEpisodes || anime.episodes) && (
                      <div className="absolute bottom-2 left-2 bg-black/60 backdrop-blur-sm text-white/80 text-[10px] font-semibold px-1.5 py-0.5 rounded-md">
                        {anime.airedEpisodes ? `${anime.airedEpisodes}` : ''}{anime.airedEpisodes && anime.episodes ? ' / ' : ''}{anime.episodes ? `${anime.episodes}` : ''} ep.
                      </div>
                    )}
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
                </Link>
              );
            })}
          </div>
        ) : loadingSeason ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-white/10 border-t-purple-400 rounded-full animate-spin" />
          </div>
        ) : (
          <div className="text-center py-20 text-white/30">
            <p className="font-display text-lg">Aucun contenu trouvé</p>
          </div>
        )}
      </section>
    </div>
  );
}
