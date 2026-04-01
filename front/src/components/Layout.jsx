import { Outlet, Link, useNavigate } from 'react-router-dom';
import { Search, Play, Home, Clock, X, Puzzle, Globe } from 'lucide-react';
import { useState, useEffect } from 'react';
import { isExtensionAvailable, getSelectedSource, isExtensionOutdated, resetExtensionCache, isMobileApp } from '../api';

export default function Layout() {
  const [query, setQuery] = useState('');
  const [selectedSource, setSelectedSource] = useState(null);
  const navigate = useNavigate();

  const [extMissing, setExtMissing] = useState(false);
  const [extOutdated, setExtOutdated] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [mobile, setMobile] = useState(false);

  function checkExtension() {
    isExtensionAvailable().then((ok) => {
      setExtMissing(!ok);
      if (ok) {
        setSelectedSource(getSelectedSource());
        setExtOutdated(isExtensionOutdated());
        setMobile(isMobileApp());
      }
    });
  }

  useEffect(() => {
    checkExtension();

    // Re-check when the content script announces the extension is ready
    // (handles race where ping times out before content script injects)
    function onExtReady(e) {
      if (e.data?.type !== 'ANIME_EXT_READY') return;
      resetExtensionCache();
      checkExtension();
    }
    window.addEventListener('message', onExtReady);
    return () => window.removeEventListener('message', onExtReady);
  }, []);

  const handleSearch = (e) => {
    e.preventDefault();
    if (query.trim()) {
      const params = new URLSearchParams({ q: query.trim() });
      if (selectedSource) params.append('source', selectedSource);
      navigate(`/search?${params}`);
    }
  };

  return (
    <div className="min-h-screen">
      {/* Navbar */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-bg-primary/80 backdrop-blur-xl border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center gap-4">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2.5 shrink-0 group">
            <div className="w-9 h-9 bg-gradient-to-br from-accent-primary to-red-600 rounded-xl flex items-center justify-center shadow-lg shadow-accent-primary/20 group-hover:shadow-accent-primary/40 transition-shadow">
              <Play className="w-4.5 h-4.5 text-white fill-white ml-0.5" />
            </div>
            <span className="font-display font-bold text-lg text-white tracking-tight hidden sm:block">
              Anime<span className="text-accent-primary">Hub</span>
            </span>
          </Link>

          {/* Active source indicator */}
          {selectedSource && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-bg-secondary border border-white/5 text-sm text-white/50">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400"></div>
              <span className="capitalize text-xs">{selectedSource}</span>
            </div>
          )}

          {/* Search bar */}
          <form onSubmit={handleSearch} className="flex-1 max-w-xl">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={selectedSource ? "Rechercher un anime..." : "Sélectionnez une source dans l'extension..."}
                disabled={!selectedSource}
                className="w-full bg-bg-secondary border border-white/5 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-accent-primary/50 focus:ring-1 focus:ring-accent-primary/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              />
            </div>
          </form>

          {/* Nav links */}
          <div className="flex items-center gap-1">
            <Link
              to="/"
              className="p-2.5 rounded-lg text-white/50 hover:text-white hover:bg-bg-hover transition-all"
              title="Accueil"
            >
              <Home className="w-5 h-5" />
            </Link>
            <Link
              to="/history"
              className="p-2.5 rounded-lg text-white/50 hover:text-white hover:bg-bg-hover transition-all"
              title="Historique"
            >
              <Clock className="w-5 h-5" />
            </Link>
            {mobile && (
              <Link
                to="/sources"
                className="p-2.5 rounded-lg text-white/50 hover:text-white hover:bg-bg-hover transition-all"
                title="Sources"
              >
                <Globe className="w-5 h-5" />
              </Link>
            )}
          </div>
        </div>
      </nav>

      {/* Extension missing banner */}
      {extMissing && !bannerDismissed && (
        <div className="fixed top-16 left-0 right-0 z-40 bg-amber-500/10 border-b border-amber-500/20 backdrop-blur-sm">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2.5 flex items-center gap-3">
            <Puzzle className="w-4 h-4 text-amber-400 shrink-0" />
            <p className="text-xs text-amber-200/80 flex-1">
              L'extension AnimeHub n'est pas détectée. Installez-la pour profiter du site.
            </p>
            <button
              onClick={() => setBannerDismissed(true)}
              className="p-1 rounded-md text-amber-400/60 hover:text-amber-300 hover:bg-white/5 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Content */}
      <main className={extMissing && !bannerDismissed ? 'pt-[104px]' : 'pt-16'}>
        <Outlet context={{ selectedSource, extMissing, extOutdated, mobile }} />
      </main>
    </div>
  );
}
