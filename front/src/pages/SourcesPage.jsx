import { useState, useEffect } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { Check, Globe, MousePointer } from 'lucide-react';
import { api, getSourceMeta, getAvailableSources, isExtensionAvailable } from '../api';

// Fallback metadata for desktop (where ping returns no sourceMeta)
const DESKTOP_SOURCE_META = [
  { id: 'anime-sama',   name: 'Anime-Sama',  initials: 'AS', color: 'indigo',  url: 'anime-sama.to',    lang: 'fr' },
  { id: 'french-anime', name: 'French Anime', initials: 'FA', color: 'pink',    url: 'french-anime.com', lang: 'fr' },
  { id: 'vostfree',     name: 'Vostfree',     initials: 'VF', color: 'emerald', url: 'vostfree.ws',      lang: 'fr' },
];

const COLOR_CLASSES = {
  indigo:  { bg: 'bg-indigo-500/15',  text: 'text-indigo-400' },
  pink:    { bg: 'bg-pink-500/15',    text: 'text-pink-400' },
  emerald: { bg: 'bg-emerald-500/15', text: 'text-emerald-400' },
  blue:    { bg: 'bg-blue-500/15',    text: 'text-blue-400' },
  purple:  { bg: 'bg-purple-500/15',  text: 'text-purple-400' },
};

export default function SourcesPage() {
  const { selectedSource, extMissing, mobile } = useOutletContext();
  const navigate = useNavigate();
  const [switching, setSwitching] = useState(null);
  const [meta, setMeta] = useState([]);
  const [available, setAvailable] = useState([]);

  useEffect(() => {
    isExtensionAvailable().then(() => {
      setMeta(getSourceMeta() || DESKTOP_SOURCE_META);
      setAvailable(getAvailableSources());
    });
  }, []);

  // Filter to sources actually registered (or show all fallback on desktop)
  const sources = available.length > 0
    ? meta.filter((m) => available.includes(m.id))
    : meta;

  async function handleSelect(sourceId) {
    if (!mobile) return; // desktop uses extension popup
    if (switching) return;
    setSwitching(sourceId);
    try {
      await api.selectSource(sourceId);
      // Full reload so Layout.jsx gets the updated selectedSource from a fresh bridge ping
      window.location.href = '/';
    } catch (e) {
      console.error('[sources] selectSource failed:', e);
      setSwitching(null);
    }
  }

  useEffect(() => {
    if (extMissing) navigate('/');
  }, [extMissing, navigate]);

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10">
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-1">
          <Globe className="w-5 h-5 text-accent-primary" />
          <h1 className="font-display font-bold text-2xl text-white">Sources</h1>
        </div>
        <p className="text-white/40 text-sm">
          {mobile
            ? 'Choisissez la source à utiliser pour parcourir les animes.'
            : 'Sélectionnez une source via l\'icône Shinani dans votre navigateur.'}
        </p>
      </div>

      {!mobile && (
        <div className="mb-6 flex items-start gap-3 px-4 py-3 rounded-xl bg-amber-500/8 border border-amber-500/20">
          <MousePointer className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
          <p className="text-amber-200/70 text-sm leading-relaxed">
            Sur PC, la sélection de source se fait via le popup de l'extension Shinani dans la barre d'outils du navigateur.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {sources.map((src) => {
          const colors = COLOR_CLASSES[src.color] || COLOR_CLASSES.indigo;
          const isActive = src.id === selectedSource;
          const isLoading = switching === src.id;

          return (
            <button
              key={src.id}
              onClick={() => handleSelect(src.id)}
              disabled={!mobile || isLoading}
              className={`
                relative flex items-center gap-4 px-4 py-4 rounded-xl border text-left transition-all
                ${isActive
                  ? 'bg-accent-primary/10 border-accent-primary/30'
                  : 'bg-bg-card border-white/5 hover:border-white/15'}
                ${mobile && !isLoading ? 'cursor-pointer hover:bg-white/[0.04]' : ''}
                ${mobile ? '' : 'cursor-default opacity-80'}
              `}
            >
              {/* Logo */}
              <div className={`w-12 h-12 rounded-xl ${colors.bg} flex items-center justify-center font-bold text-sm ${colors.text} shrink-0`}>
                {isLoading ? (
                  <div className={`w-5 h-5 border-2 border-current/30 border-t-current rounded-full animate-spin`} />
                ) : (
                  src.initials
                )}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-display font-semibold text-sm text-white">{src.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-white/5 text-white/30 font-medium uppercase">
                    {src.lang}
                  </span>
                </div>
                <span className="text-xs text-white/30">{src.url}</span>
              </div>

              {/* Active indicator */}
              {isActive && (
                <div className="shrink-0 w-6 h-6 rounded-full bg-accent-primary/20 flex items-center justify-center">
                  <Check className="w-3.5 h-3.5 text-accent-primary" />
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
