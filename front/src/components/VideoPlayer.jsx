import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Play, Pause, Volume2, VolumeX, Maximize, Minimize,
  SkipForward, SkipBack, ChevronLeft, Settings,
} from 'lucide-react';
import Hls from 'hls.js';

export default function VideoPlayer({
  videoData,
  episodeNumber,
  animeTitle,
  onTimeUpdate,
  onEnded,
  onBack,
  initialTime = 0,
  autoplayNext = true,
  skipSegments = null,
  onSkipCorrection = null, // callback: (segmentType, start, end) => void
  onSkipDelete = null,     // callback: (segmentType) => void — 'opening', 'ending', or 'all'
}) {
  const isIframe = videoData?.type === 'iframe';

  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const hlsRef = useRef(null);
  const progressInterval = useRef(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const lastTimeUpdateRef = useRef(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [videoError, setVideoError] = useState(null);
  const [activeSkip, setActiveSkip] = useState(null); // 'opening' | 'ending' | null
  const [showSkipEditor, setShowSkipEditor] = useState(false);
  const [iframeFallback, setIframeFallback] = useState(null); // embed URL if HLS fails
  const skipDismissed = useRef(new Set());
  const hideTimeout = useRef(null);

  // Reset state when video changes
  useEffect(() => {
    setActiveSkip(null);
    setIframeFallback(null);
    skipDismissed.current.clear();
  }, [videoData?.url]);

  // Setup HLS or native video (only for direct video URLs)
  useEffect(() => {
    if (isIframe) {
      setIsLoading(false);
      return;
    }

    const video = videoRef.current;
    if (!video || !videoData?.url) return;

    setIsLoading(true);
    setVideoError(null);

    const handleError = () => {
      const embedUrl = videoData.sources?.[0]?.url;
      if (embedUrl) {
        console.log('[player] Video failed, falling back to iframe:', embedUrl);
        setIframeFallback(embedUrl);
        setIsLoading(false);
      } else {
        setIsLoading(false);
        setVideoError('Impossible de charger la vidéo');
      }
    };

    // Use proxy URL if available (production), otherwise direct URL
    const hlsUrl = videoData.proxy_url || videoData.url;

    const isHls = hlsUrl.includes('.m3u8') || hlsUrl.startsWith('/proxy/hls/');
    if (isHls && Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(hlsUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setIsLoading(false);
        if (initialTime > 0) video.currentTime = initialTime;
        video.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (e, data) => {
        console.error('HLS error:', data);
        if (data.fatal) {
          hls.destroy();
          hlsRef.current = null;
          // Auto-fallback to iframe embed if available
          const embedUrl = videoData.sources?.[0]?.url;
          if (embedUrl) {
            console.log('[player] HLS failed, falling back to iframe:', embedUrl);
            setIframeFallback(embedUrl);
            setIsLoading(false);
            setVideoError(null);
          } else {
            setIsLoading(false);
            setVideoError('Erreur de lecture HLS');
          }
        }
      });
      hlsRef.current = hls;
    } else {
      video.src = videoData.url;
      video.addEventListener('loadeddata', () => {
        setIsLoading(false);
        if (initialTime > 0) video.currentTime = initialTime;
        video.play().catch(() => {});
      });
      video.addEventListener('error', handleError);
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      video.removeEventListener('error', handleError);
    };
  }, [videoData?.url]);

  // Progress reporting
  useEffect(() => {
    if (isIframe) return;
    progressInterval.current = setInterval(() => {
      if (videoRef.current && !videoRef.current.paused) {
        onTimeUpdate?.(videoRef.current.currentTime);
      }
    }, 5000); // report every 5 seconds
    return () => clearInterval(progressInterval.current);
  }, [onTimeUpdate, isIframe]);

  // Auto-hide controls
  const resetHideTimer = useCallback(() => {
    setShowControls(true);
    if (hideTimeout.current) clearTimeout(hideTimeout.current);
    hideTimeout.current = setTimeout(() => {
      if (isPlaying) setShowControls(false);
    }, 3000);
  }, [isPlaying]);

  useEffect(() => {
    resetHideTimer();
    return () => clearTimeout(hideTimeout.current);
  }, [isPlaying]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e) => {
      if (isIframe) {
        if (e.key === 'f') toggleFullscreen();
        return;
      }
      const video = videoRef.current;
      if (!video) return;
      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault();
          video.paused ? video.play() : video.pause();
          break;
        case 'f':
          toggleFullscreen();
          break;
        case 'ArrowLeft':
          video.currentTime -= 10;
          break;
        case 'ArrowRight':
          video.currentTime += 10;
          break;
        case 'ArrowUp':
          e.preventDefault();
          video.volume = Math.min(1, video.volume + 0.1);
          setVolume(video.volume);
          break;
        case 'ArrowDown':
          e.preventDefault();
          video.volume = Math.max(0, video.volume - 0.1);
          setVolume(video.volume);
          break;
        case 'm':
          video.muted = !video.muted;
          setIsMuted(video.muted);
          break;
        case 's':
          // Skip current segment (if skip button is visible)
          if (activeSkip && skipSegments?.[activeSkip]) {
            video.currentTime = skipSegments[activeSkip].end;
            skipDismissed.current.add(activeSkip);
            setActiveSkip(null);
          }
          break;
      }
      resetHideTimer();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isIframe, activeSkip, skipSegments]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    video.paused ? video.play() : video.pause();
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  const formatTime = (t) => {
    if (!t || isNaN(t)) return '0:00';
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const handleProgressClick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    if (videoRef.current) {
      videoRef.current.currentTime = pct * duration;
    }
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  // ── Iframe fallback: HLS failed, use embed player ──
  if (iframeFallback) {
    return (
      <div ref={containerRef} className="relative w-full h-full bg-black">
        <iframe
          src={iframeFallback}
          className="w-full h-full border-0"
          allowFullScreen
          allow="autoplay; encrypted-media; fullscreen"
          referrerPolicy="no-referrer"
        />
        <div className="absolute top-0 left-0 right-0 bg-gradient-to-b from-black/80 to-transparent p-4 flex items-center justify-between z-10 pointer-events-auto">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-white/10 transition">
              <ChevronLeft className="w-5 h-5 text-white" />
            </button>
            <div>
              <p className="text-white font-display font-semibold text-sm">{animeTitle}</p>
              <p className="text-white/50 text-xs">Episode {episodeNumber}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {onEnded && (
              <button
                onClick={onEnded}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition text-xs text-white font-medium"
              >
                <SkipForward className="w-3.5 h-3.5" />
                Suivant
              </button>
            )}
            <button
              onClick={toggleFullscreen}
              className="p-2 rounded-lg hover:bg-white/10 transition"
            >
              {isFullscreen
                ? <Minimize className="w-4 h-4 text-white" />
                : <Maximize className="w-4 h-4 text-white" />
              }
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Iframe mode: embed the player in an iframe ──
  if (isIframe) {
    return (
      <div ref={containerRef} className="relative w-full h-full bg-black">
        <iframe
          src={videoData.url}
          className="w-full h-full border-0"
          allowFullScreen
          allow="autoplay; encrypted-media; fullscreen"
          referrerPolicy="no-referrer"
        />

        {/* Minimal overlay: back button + episode info + next */}
        <div className="absolute top-0 left-0 right-0 bg-gradient-to-b from-black/80 to-transparent p-4 flex items-center justify-between z-10 pointer-events-auto">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-white/10 transition">
              <ChevronLeft className="w-5 h-5 text-white" />
            </button>
            <div>
              <p className="text-white font-display font-semibold text-sm">{animeTitle}</p>
              <p className="text-white/50 text-xs">Episode {episodeNumber}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {onEnded && (
              <button
                onClick={onEnded}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition text-xs text-white font-medium"
              >
                <SkipForward className="w-3.5 h-3.5" />
                Suivant
              </button>
            )}
            <button
              onClick={toggleFullscreen}
              className="p-2 rounded-lg hover:bg-white/10 transition"
            >
              {isFullscreen
                ? <Minimize className="w-4 h-4 text-white" />
                : <Maximize className="w-4 h-4 text-white" />
              }
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Native video mode ──
  return (
    <div
      ref={containerRef}
      className="relative w-full h-full bg-black group video-container"
      onMouseMove={resetHideTimer}
      onClick={(e) => {
        if (e.target === videoRef.current || e.target.closest('.video-overlay')) {
          togglePlay();
          resetHideTimer();
        }
      }}
    >
      <video
        ref={videoRef}
        className="w-full h-full"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={() => {
          const time = videoRef.current?.currentTime || 0;
          // Throttle UI updates to ~5/sec instead of 60/sec
          const now = Date.now();
          if (now - lastTimeUpdateRef.current > 200) {
            setCurrentTime(time);
            lastTimeUpdateRef.current = now;
          }
          // Check skip segments (always, for responsiveness)
          if (skipSegments) {
            const { opening, ending } = skipSegments;
            if (opening && time >= opening.start && time < opening.end - 3
                && !skipDismissed.current.has('opening')) {
              setActiveSkip('opening');
            } else if (ending && time >= ending.start && time < ending.end - 3
                && !skipDismissed.current.has('ending')) {
              setActiveSkip('ending');
            } else {
              setActiveSkip(null);
            }
          }
        }}
        onDurationChange={() => setDuration(videoRef.current?.duration || 0)}
        onEnded={() => {
          onTimeUpdate?.(videoRef.current?.currentTime || 0);
          if (autoplayNext && onEnded) onEnded();
        }}
        playsInline
      />

      {/* Loading spinner */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60">
          <div className="w-12 h-12 border-3 border-white/20 border-t-accent-primary rounded-full animate-spin" />
        </div>
      )}

      {/* Video error */}
      {videoError && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80">
          <div className="text-center">
            <p className="text-red-400 font-display font-bold mb-2">{videoError}</p>
            <button
              onClick={onBack}
              className="px-4 py-2 bg-white/10 text-white rounded-lg text-sm hover:bg-white/20 transition"
            >
              Retour
            </button>
          </div>
        </div>
      )}

      {/* Controls overlay */}
      <div
        className={`video-overlay absolute inset-0 transition-opacity duration-300 ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Top bar */}
        <div className="absolute top-0 left-0 right-0 bg-gradient-to-b from-black/80 to-transparent p-4 flex items-center gap-3">
          <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-white/10 transition">
            <ChevronLeft className="w-5 h-5 text-white" />
          </button>
          <div>
            <p className="text-white font-display font-semibold text-sm">{animeTitle}</p>
            <p className="text-white/50 text-xs">Episode {episodeNumber}</p>
          </div>
        </div>

        {/* Center play button */}
        {!isPlaying && !isLoading && !videoError && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-16 h-16 rounded-full bg-accent-primary/90 flex items-center justify-center shadow-lg shadow-accent-primary/30">
              <Play className="w-7 h-7 text-white fill-white ml-1" />
            </div>
          </div>
        )}

        {/* Skip button */}
        {activeSkip && skipSegments?.[activeSkip] && !showSkipEditor && (
          <div className="absolute bottom-28 right-4 z-20 animate-slide-in-right">
            <button
              onClick={(e) => {
                e.stopPropagation();
                const segment = skipSegments[activeSkip];
                if (segment && videoRef.current) {
                  videoRef.current.currentTime = segment.end;
                }
                skipDismissed.current.add(activeSkip);
                setActiveSkip(null);
              }}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-white/90 text-black font-semibold text-sm shadow-lg hover:bg-white transition-all duration-200 border border-white/20"
            >
              <SkipForward className="w-4 h-4" />
              {activeSkip === 'opening' ? "Passer l'intro" : "Passer l'ending"}
            </button>
          </div>
        )}

        {/* Skip segment editor panel */}
        {showSkipEditor && skipSegments && (
          <div
            className="absolute bottom-28 right-4 z-30 bg-black/90 backdrop-blur-xl border border-white/10 rounded-xl p-4 w-72 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <p className="text-white font-semibold text-sm">Ajuster les segments</p>
              <button
                onClick={() => setShowSkipEditor(false)}
                className="text-white/40 hover:text-white text-xs"
              >
                Fermer
              </button>
            </div>

            {['opening', 'ending'].map((type) => {
              const seg = skipSegments[type];
              if (!seg) return null;
              return (
                <div key={type} className="mb-3 last:mb-0">
                  <p className="text-xs text-white/50 mb-1.5">
                    {type === 'opening' ? 'Intro' : 'Ending'} — {formatTime(seg.start)} → {formatTime(seg.end)}
                  </p>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-white/30 w-8">Debut</span>
                    <button
                      onClick={() => onSkipCorrection?.(type, Math.max(0, seg.start - 5), seg.end)}
                      className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-white text-xs transition"
                    >-5s</button>
                    <button
                      onClick={() => onSkipCorrection?.(type, seg.start + 5, seg.end)}
                      className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-white text-xs transition"
                    >+5s</button>
                    <span className="text-[10px] text-white/30 w-6 ml-2">Fin</span>
                    <button
                      onClick={() => onSkipCorrection?.(type, seg.start, Math.max(seg.start + 10, seg.end - 5))}
                      className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-white text-xs transition"
                    >-5s</button>
                    <button
                      onClick={() => onSkipCorrection?.(type, seg.start, seg.end + 5)}
                      className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-white text-xs transition"
                    >+5s</button>
                  </div>
                  <div className="flex gap-1 mt-1.5">
                    <button
                      onClick={() => {
                        if (videoRef.current) videoRef.current.currentTime = seg.start;
                      }}
                      className="px-2 py-1 rounded bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 text-[10px] transition"
                    >Aller au debut</button>
                    <button
                      onClick={() => {
                        if (videoRef.current) videoRef.current.currentTime = Math.max(0, seg.end - 5);
                      }}
                      className="px-2 py-1 rounded bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 text-[10px] transition"
                    >Aller a la fin</button>
                    {onSkipDelete && (
                      <button
                        onClick={() => onSkipDelete(type)}
                        className="px-2 py-1 rounded bg-red-500/20 hover:bg-red-500/30 text-red-300 text-[10px] transition ml-auto"
                      >Faux</button>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Delete all segments */}
            {onSkipDelete && skipSegments.opening && skipSegments.ending && (
              <button
                onClick={() => onSkipDelete('all')}
                className="w-full mt-2 px-3 py-1.5 rounded-lg bg-red-500/15 hover:bg-red-500/25 text-red-300 text-xs font-medium transition border border-red-500/20"
              >
                Tout est faux
              </button>
            )}
          </div>
        )}

        {/* Bottom controls */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-4 pb-4 pt-12">
          {/* Progress bar */}
          <div
            className="w-full h-1.5 bg-white/20 rounded-full cursor-pointer mb-4 group/progress relative"
            onClick={handleProgressClick}
          >
            {/* OP/ED segment markers */}
            {skipSegments?.opening && duration > 0 && (
              <div
                className="absolute top-0 h-full bg-blue-400/40 rounded-full pointer-events-none"
                style={{
                  left: `${(skipSegments.opening.start / duration) * 100}%`,
                  width: `${((skipSegments.opening.end - skipSegments.opening.start) / duration) * 100}%`,
                }}
              />
            )}
            {skipSegments?.ending && duration > 0 && (
              <div
                className="absolute top-0 h-full bg-purple-400/40 rounded-full pointer-events-none"
                style={{
                  left: `${(skipSegments.ending.start / duration) * 100}%`,
                  width: `${((skipSegments.ending.end - skipSegments.ending.start) / duration) * 100}%`,
                }}
              />
            )}
            <div
              className="h-full bg-accent-primary rounded-full relative transition-all"
              style={{ width: `${progress}%` }}
            >
              <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3.5 h-3.5 bg-accent-primary rounded-full opacity-0 group-hover/progress:opacity-100 transition shadow-md shadow-accent-primary/50" />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {/* Skip back */}
              <button
                onClick={(e) => { e.stopPropagation(); if (videoRef.current) videoRef.current.currentTime -= 10; }}
                className="p-2 rounded-lg hover:bg-white/10 transition"
              >
                <SkipBack className="w-4 h-4 text-white" />
              </button>

              {/* Play/Pause */}
              <button
                onClick={(e) => { e.stopPropagation(); togglePlay(); }}
                className="p-2 rounded-lg hover:bg-white/10 transition"
              >
                {isPlaying
                  ? <Pause className="w-5 h-5 text-white" />
                  : <Play className="w-5 h-5 text-white fill-white" />
                }
              </button>

              {/* Skip forward */}
              <button
                onClick={(e) => { e.stopPropagation(); if (videoRef.current) videoRef.current.currentTime += 10; }}
                className="p-2 rounded-lg hover:bg-white/10 transition"
              >
                <SkipForward className="w-4 h-4 text-white" />
              </button>

              {/* Volume */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const video = videoRef.current;
                  if (video) { video.muted = !video.muted; setIsMuted(video.muted); }
                }}
                className="p-2 rounded-lg hover:bg-white/10 transition"
              >
                {isMuted ? <VolumeX className="w-4 h-4 text-white" /> : <Volume2 className="w-4 h-4 text-white" />}
              </button>

              {/* Time */}
              <span className="text-xs text-white/60 font-body tabular-nums ml-1">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
            </div>

            <div className="flex items-center gap-2">
              {/* Next episode */}
              {onEnded && (
                <button
                  onClick={(e) => { e.stopPropagation(); onEnded(); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition text-xs text-white font-medium"
                >
                  <SkipForward className="w-3.5 h-3.5" />
                  Suivant
                </button>
              )}

              {/* Skip editor toggle (only when segments exist) */}
              {skipSegments && (skipSegments.opening || skipSegments.ending) && (
                <button
                  onClick={(e) => { e.stopPropagation(); setShowSkipEditor(!showSkipEditor); }}
                  className={`p-2 rounded-lg hover:bg-white/10 transition ${showSkipEditor ? 'bg-white/10' : ''}`}
                  title="Ajuster les segments OP/ED"
                >
                  <Settings className="w-4 h-4 text-white" />
                </button>
              )}

              {/* Fullscreen */}
              <button
                onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }}
                className="p-2 rounded-lg hover:bg-white/10 transition"
              >
                {isFullscreen
                  ? <Minimize className="w-4 h-4 text-white" />
                  : <Maximize className="w-4 h-4 text-white" />
                }
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}