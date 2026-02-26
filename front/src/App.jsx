import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import HomePage from './pages/HomePage';

const SearchPage = lazy(() => import('./pages/SearchPage'));
const AnimePage = lazy(() => import('./pages/AnimePage'));
const WatchPage = lazy(() => import('./pages/WatchPage'));
const HistoryPage = lazy(() => import('./pages/HistoryPage'));

const PageLoader = () => (
  <div className="min-h-screen flex items-center justify-center">
    <div className="w-8 h-8 border-2 border-white/10 border-t-[#e63946] rounded-full animate-spin" />
  </div>
);

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/anime/:source/:animeId" element={<AnimePage />} />
          </Route>
          {/* Watch page is full-screen, no layout */}
          <Route path="/watch/:source/*" element={<WatchPage />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
