import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import HomePage from './pages/HomePage';
import SearchPage from './pages/SearchPage';
import AnimePage from './pages/AnimePage';
import WatchPage from './pages/WatchPage';
import HistoryPage from './pages/HistoryPage';

export default function App() {
  return (
    <BrowserRouter>
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
    </BrowserRouter>
  );
}