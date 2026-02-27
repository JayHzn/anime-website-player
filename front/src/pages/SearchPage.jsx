import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import { api, onCoversUpdate } from '../api';
import AnimeCard from '../components/AnimeCard';

export default function SearchPage() {
  const [searchParams] = useSearchParams();
  const query = searchParams.get('q') || '';
  const source = searchParams.get('source') || null;
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (query) {
      setLoading(true);
      api.search(query, source)
        .then(setResults)
        .catch(console.error)
        .finally(() => setLoading(false));
    }
  }, [query, source]);

  // Listen for cover updates — merge ciblé (évite rechargements d’images inutiles)
  useEffect(() => {
    return onCoversUpdate((patches) => {
      setResults((prev) =>
        prev.map((a) => {
          const p = patches.find((x) => x.id === a.id && x.source === a.source);
          return p ? { ...a, cover: p.cover } : a;
        })
      );
    });
  }, []);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-center gap-2 mb-6">
        <Search className="w-5 h-5 text-accent-primary" />
        <h1 className="font-display font-bold text-xl text-white">
          Résultats pour <span className="text-accent-primary">"{query}"</span>
        </h1>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-white/10 border-t-accent-primary rounded-full animate-spin" />
        </div>
      ) : results.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 sm:gap-5">
          {results.map((anime, i) => (
            <AnimeCard key={`${anime.source}-${anime.id}`} anime={anime} index={i} />
          ))}
        </div>
      ) : (
        <div className="text-center py-20 text-white/30">
          <p className="font-display text-lg">Aucun résultat</p>
          <p className="text-sm mt-1">Essaie avec un autre terme de recherche</p>
        </div>
      )}
    </div>
  );
}