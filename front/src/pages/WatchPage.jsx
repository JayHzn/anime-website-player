import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api';
import VideoPlayer from '../components/VideoPlayer';

/** Extract episode number from an episode ID like "anime-slug/anime-slug-10-vostfr" */
function extractEpisodeNumber(epId) {
  if (!epId) return '?';
  const m = epId.match(/-(\d{1,4})-(?:vostfr|vf)/i);
  if (m) return parseInt(m[1], 10);
  const nums = epId.match(/\d+/g);
  if (nums) return parseInt(nums[nums.length - 1], 10);
  return '?';
}

export default function WatchPage() {
  const { source, '*': episodeId } = useParams();
  const navigate = useNavigate();

  const [videoData, setVideoData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [skipSegments, setSkipSegments] = useState(null);
  const [savedTime, setSavedTime] = useState(0);

  // Get anime context from sessionStorage
  const [animeCtx] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem('currentAnime')) || {};
    } catch {
      return {};
    }
  });

  const currentEpisode = animeCtx.episodes?.find(
    (e) => e.id === episodeId
  );
  const currentIndex = animeCtx.episodes?.findIndex(
    (e) => e.id === episodeId
  );
  const prevEpisode =
    currentIndex > 0 ? animeCtx.episodes[currentIndex - 1] : null;
  const nextEpisode =
    currentIndex >= 0 && currentIndex < (animeCtx.episodes?.length || 0) - 1
      ? animeCtx.episodes[currentIndex + 1]
      : null;

  useEffect(() => {
    loadVideo();
    setSavedTime(0);
    // Fetch saved timestamp — only resume if it's the same episode
    if (animeCtx.animeId) {
      api.getAnimeProgress(animeCtx.animeId)
        .then((p) => {
          if (p?.timestamp > 0 && p.episode_number === epNumber) {
            setSavedTime(p.timestamp);
          }
        })
        .catch(() => {});
    }
  }, [source, episodeId]);

  // Skip segments polling with proper cleanup
  useEffect(() => {
    let intervalId = null;
    let cancelled = false;

    async function loadSkipSegments() {
      try {
        const epNum = currentEpisode?.number;
        const data = await api.getSkipSegments(source, episodeId, epNum);
        if (cancelled) return;
        if (data.status === 'ready') {
          setSkipSegments(data);
        } else if (data.status === 'analyzing' || data.status === 'unavailable') {
          intervalId = setInterval(async () => {
            try {
              const updated = await api.getSkipSegments(source, episodeId, epNum);
              if (cancelled) return;
              if (updated.status === 'ready') {
                setSkipSegments(updated);
                clearInterval(intervalId);
                intervalId = null;
              }
            } catch { /* ignore */ }
          }, 10000);
        }
      } catch { /* skip segments are optional */ }
    }

    loadSkipSegments();
    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, [source, episodeId, currentEpisode?.number]);

  async function loadVideo() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getVideoUrl(source, episodeId);
      setVideoData(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  // Save progress
  const epNumber = currentEpisode?.number || animeCtx.episodeNumber || extractEpisodeNumber(episodeId);
  const handleTimeUpdate = useCallback(
    (time) => {
      if (!animeCtx.animeId) return;
      api.updateProgress({
        anime_id: animeCtx.animeId,
        anime_title: animeCtx.title,
        anime_cover: animeCtx.cover,
        source: animeCtx.source,
        episode_number: epNumber,
        total_episodes: animeCtx.totalEpisodes,
        timestamp: time,
      });
    },
    [animeCtx, epNumber]
  );

  // Go to previous episode
  const handlePrevious = useCallback(() => {
    if (prevEpisode) {
      navigate(`/watch/${source}/${prevEpisode.id}`, { replace: true });
    }
  }, [prevEpisode, source, navigate]);

  // Autoplay next episode
  const handleEnded = useCallback(() => {
    if (nextEpisode) {
      navigate(`/watch/${source}/${nextEpisode.id}`, { replace: true });
    } else {
      // Last episode, go back to anime page
      navigate(`/anime/${source}/${encodeURIComponent(animeCtx.animeId)}`);
    }
  }, [nextEpisode, source, animeCtx.animeId, navigate]);

  // Handle manual skip segment correction
  const handleSkipCorrection = useCallback(
    (segmentType, start, end) => {
      if (!animeCtx.animeId || !currentEpisode) return;
      // Update local state immediately
      setSkipSegments((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          [segmentType]: { ...prev[segmentType], start, end },
        };
      });
      // Persist to backend
      api.correctSkipSegment(source, animeCtx.animeId, currentEpisode.number, {
        segment_type: segmentType,
        start,
        end,
      }).catch(() => {});
    },
    [animeCtx, currentEpisode, source]
  );

  // Handle deletion of wrong skip segments
  const handleSkipDelete = useCallback(
    (segmentType) => {
      if (!animeCtx.animeId || !currentEpisode) return;
      if (segmentType === 'all') {
        // Delete all segments for this episode
        setSkipSegments(null);
        api.deleteSkipSegments(source, animeCtx.animeId, currentEpisode.number).catch(() => {});
      } else {
        // Delete just one segment type
        setSkipSegments((prev) => {
          if (!prev) return prev;
          const updated = { ...prev, [segmentType]: null };
          if (!updated.opening && !updated.ending) return null;
          return updated;
        });
        // Re-save only the remaining segment (delete + re-create)
        api.deleteSkipSegments(source, animeCtx.animeId, currentEpisode.number).then(() => {
          setSkipSegments((prev) => {
            if (!prev) return prev;
            const remaining = segmentType === 'opening' ? 'ending' : 'opening';
            if (prev[remaining]) {
              api.correctSkipSegment(source, animeCtx.animeId, currentEpisode.number, {
                segment_type: remaining,
                start: prev[remaining].start,
                end: prev[remaining].end,
              }).catch(() => {});
            }
            return prev;
          });
        }).catch(() => {});
      }
    },
    [animeCtx, currentEpisode, source]
  );

  // Reference to the video element for saving on exit
  const videoElRef = useRef(null);

  // Save progress immediately (used on exit)
  const saveProgressNow = useCallback(() => {
    const video = videoElRef.current || document.querySelector('video');
    if (!video || !animeCtx.animeId) return;
    const time = video.currentTime;
    if (time > 0) {
      handleTimeUpdate(time);
    }
  }, [animeCtx.animeId, handleTimeUpdate]);

  // Capture video element ref once mounted
  useEffect(() => {
    const timer = setTimeout(() => {
      videoElRef.current = document.querySelector('video');
    }, 500);
    return () => clearTimeout(timer);
  }, [videoData]);

  // Save on page close / tab switch
  useEffect(() => {
    const onBeforeUnload = () => saveProgressNow();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') saveProgressNow();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [saveProgressNow]);

  const handleBack = () => {
    saveProgressNow();
    if (animeCtx.animeId) {
      navigate(`/anime/${source}/${encodeURIComponent(animeCtx.animeId)}`);
    } else {
      navigate('/');
    }
  };

  if (loading) {
    return (
      <div className="h-screen w-screen bg-black flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-white/10 border-t-[#e63946] rounded-full animate-spin mx-auto mb-4" />
          <p className="text-white/40 text-sm font-body">Chargement de l'épisode...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-screen w-screen bg-black flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 font-display font-bold text-lg mb-2">Erreur</p>
          <p className="text-white/40 text-sm mb-4">{error}</p>
          <button
            onClick={handleBack}
            className="px-4 py-2 bg-white/10 text-white rounded-lg text-sm hover:bg-white/20 transition"
          >
            Retour
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-black">
      <VideoPlayer
        videoData={videoData}
        episodeNumber={currentEpisode?.number || animeCtx.episodeNumber || extractEpisodeNumber(episodeId)}
        animeTitle={animeCtx.title || 'Anime'}
        initialTime={savedTime}
        onTimeUpdate={handleTimeUpdate}
        onEnded={nextEpisode ? handleEnded : null}
        onPrevious={prevEpisode ? handlePrevious : null}
        onBack={handleBack}
        autoplayNext={true}
        skipSegments={skipSegments}
        onSkipCorrection={handleSkipCorrection}
        onSkipDelete={handleSkipDelete}
      />

      {/* Next episode toast */}
      {nextEpisode && (
        <div className="fixed bottom-24 right-4 z-50 opacity-0 pointer-events-none" id="next-toast">
          <div className="bg-bg-card/90 backdrop-blur-xl border border-white/10 rounded-xl p-3 text-sm shadow-xl">
            <p className="text-white/40 text-xs">Prochain épisode</p>
            <p className="text-white font-display font-semibold mt-0.5">
              Ep. {nextEpisode.number} {nextEpisode.title ? `- ${nextEpisode.title}` : ''}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}