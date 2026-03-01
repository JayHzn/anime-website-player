import { Outlet, Link, useNavigate } from 'react-router-dom';
import { Search, Play, Home, Clock, ChevronDown, X, Puzzle } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { api, isExtensionAvailable } from '../api';

export default function Layout() {
  const [query, setQuery] = useState('');
  const [sources, setSources] = useState([]);
  const [selectedSource, setSelectedSource] = useState(null); // null = all sources
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);
  const navigate = useNavigate();

  const [extMissing, setExtMissing] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  useEffect(() => {
    api.getSources().then(setSources).catch(console.error);
    isExtensionAvailable().then((ok) => setExtMissing(!ok));
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleSearch = (e) => {
    e.preventDefault();
    if (query.trim()) {
      const params = new URLSearchParams({ q: query.trim() });
      if (selectedSource) params.append('source', selectedSource);
      navigate(`/search?${params}`);
    }
  };

  const currentSourceLabel = selectedSource
    ? sources.find((s) => s.name === selectedSource)?.name || selectedSource
    : 'Toutes';

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

          {/* Source selector */}
          <div className="relative shrink-0" ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-bg-secondary border border-white/5 text-sm text-white/70 hover:text-white hover:border-white/10 transition-all"
            >
              <span className="capitalize">{currentSourceLabel}</span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {dropdownOpen && (
              <div className="absolute top-full left-0 mt-1.5 w-44 bg-bg-card border border-white/10 rounded-xl shadow-2xl shadow-black/50 overflow-hidden z-50">
                <button
                  onClick={() => { setSelectedSource(null); setDropdownOpen(false); }}
                  className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                    !selectedSource
                      ? 'bg-accent-primary/10 text-accent-primary font-medium'
                      : 'text-white/70 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  Toutes les sources
                </button>
                {sources.map((s) => (
                  <button
                    key={s.name}
                    onClick={() => { setSelectedSource(s.name); setDropdownOpen(false); }}
                    className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                      selectedSource === s.name
                        ? 'bg-accent-primary/10 text-accent-primary font-medium'
                        : 'text-white/70 hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    <span className="capitalize">{s.name}</span>
                    <span className="text-white/30 text-xs ml-2">{s.language.toUpperCase()}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Search bar */}
          <form onSubmit={handleSearch} className="flex-1 max-w-xl">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Rechercher un anime..."
                className="w-full bg-bg-secondary border border-white/5 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-accent-primary/50 focus:ring-1 focus:ring-accent-primary/20 transition-all"
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
        <Outlet context={{ selectedSource }} />
      </main>
    </div>
  );
}
