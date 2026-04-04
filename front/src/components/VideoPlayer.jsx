import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Play, Pause, Volume2, VolumeX, Maximize, Minimize,
  SkipForward, SkipBack, ChevronLeft, Settings, RefreshCw,
} from 'lucide-react';
import Hls from 'hls.js';

export default function VideoPlayer({
  videoData,
  episodeNumber,
  animeTitle,
  onTimeUpdate,
  onEnded,
  onPrevious,
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
  const isMobileApp = typeof window !== 'undefined' && !!window.__ANIMEHUB_MOBILE__;
  const [showControls, setShowControls] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [videoError, setVideoError] = useState(null);
  const [activeSkip, setActiveSkip] = useState(null); // 'opening' | 'ending' | null
  const [showSkipEditor, setShowSkipEditor] = useState(false);
  const [visibleIframeUrl, setVisibleIframeUrl] = useState(null); // iframe shown to user (fallback)
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [sourcesExhausted, setSourcesExhausted] = useState(false); // all embed sources failed
  // Iframe URL extraction: load embed in hidden iframe, content script extracts direct URL
  const [extractUrl, setExtractUrl] = useState(null);    // URL in hidden iframe
  const [extractedUrl, setExtractedUrl] = useState(null); // extracted direct video URL
  const extractTimerRef = useRef(null);
  // Source cycling: when a source fails, try the next one
  const embedQueueRef = useRef([]); // remaining embed URLs to try
  const skipDismissed = useRef(new Set());
  const hideTimeout = useRef(null);

  // ── Mobile double-tap & tap logic ──────────────────────────
  const lastTap = useRef({ time: 0, x: 0 });
  const tapTimeout = useRef(null);
  const [doubleTapSide, setDoubleTapSide] = useState(null); // 'left' | 'right' | null
  const doubleTapTimer = useRef(null);

  // Reset state when video changes
  useEffect(() => {
    setActiveSkip(null);
    setVisibleIframeUrl(null);
    setIframeLoaded(false);
    setSourcesExhausted(false);
    setExtractUrl(null);
    setExtractedUrl(null);
    clearTimeout(extractTimerRef.current);
    skipDismissed.current.clear();
    // Build the embed URL queue for source cycling.
    const allSources = videoData?.sources?.map(s => s.url) || [];
    if (videoData?.type === 'iframe') {
      // Iframe mode: try ALL sources — none has been resolved yet.
      // Exclude hosts that block iframes (X-Frame-Options: sameorigin) since
      // player-extractor can't run inside a chrome-error:// page.
      const NO_IFRAME_HOSTS = ['sendvid.com'];
      embedQueueRef.current = allSources.filter(
        u => !NO_IFRAME_HOSTS.some(h => u.includes(h))
      );
    } else {
      // Direct URL mode: exclude the embed source that already resolved (sourceUrl),
      // or fallback to referer if sourceUrl is not set explicitly.
      const usedSourceUrl = videoData?.sourceUrl || videoData?.referer;
      embedQueueRef.current = usedSourceUrl
        ? allSources.filter(u => u !== usedSourceUrl)
        : allSources;
    }
  }, [videoData?.url]);

  // Start iframe extraction for all iframe-mode sources
  useEffect(() => {
    if (!isIframe) return;
    startNextExtraction();
  }, [isIframe, videoData?.url]);

  // Try the next embed URL from the queue via extraction.
  // Called on: iframe mode start, or when a source fails to play.
  function startNextExtraction() {
    const queue = embedQueueRef.current;
    if (queue.length === 0) {
      // All sources exhausted — show error state
      setSourcesExhausted(true);
      setVisibleIframeUrl(null);
      setIsLoading(false);
      return;
    }
    const [next, ...rest] = queue;
    embedQueueRef.current = rest;
    setExtractedUrl(null);
    setExtractUrl(next);
    clearTimeout(extractTimerRef.current);
    extractTimerRef.current = setTimeout(() => {
      // Extraction timed out — show this embed as a visible iframe
      setVisibleIframeUrl(next);
      setExtractUrl(null);
    }, 8000);
  }

  // Called when a resolved URL (direct or extracted) fails to play.
  // Moves on to the next source in the queue.
  function tryNextSource() {
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    clearTimeout(extractTimerRef.current);
    setExtractedUrl(null);
    setExtractUrl(null);
    setVisibleIframeUrl(null);
    setIframeLoaded(false);
    setSourcesExhausted(false);
    setIsLoading(false);
    startNextExtraction();
  }

  // Listen for the extracted URL from the content script.
  // Active for both the hidden iframe (extractUrl) and visible iframe (visibleIframeUrl),
  // so that a URL received after a timeout (e.g. Vidmoly CF Turnstile passed by user)
  // still switches us back to the native player.
  useEffect(() => {
    if (!extractUrl && !visibleIframeUrl) return;
    function onMessage(e) {
      if (e.data?.type !== 'ANIME_EXT_VIDEO_URL') return;
      const url = e.data.url;
      if (!url) return;
      clearTimeout(extractTimerRef.current);
      setVisibleIframeUrl(null); // leave visible iframe → native player takes over
      setExtractedUrl(url);
      setExtractUrl(null);
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [extractUrl, visibleIframeUrl]);

  // Setup HLS or native video (only for direct video URLs)
  useEffect(() => {
    // In iframe mode without an extracted URL, skip HLS setup
    if (isIframe && !extractedUrl) {
      setIsLoading(false);
      return;
    }

    // Use extractedUrl (from iframe extractor) if available, else the direct URL
    const activeUrl = extractedUrl || videoData?.url;

    const video = videoRef.current;
    if (!video || !activeUrl) return;

    setIsLoading(true);
    setVideoError(null);

    const handleError = () => {
      console.log('[player] Video failed, trying next source');
      tryNextSource();
    };

    // Use proxy URL if available (production), otherwise direct URL
    const hlsUrl = extractedUrl || videoData.proxy_url || videoData.url;

    const isHls = hlsUrl.includes('.m3u8') || hlsUrl.startsWith('/proxy/hls/');
    if (isHls && Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(hlsUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setIsLoading(false);
        if (initialTime > 0) {
          video.currentTime = initialTime;
          appliedInitialTime.current = true;
        }
        video.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (e, data) => {
        console.error('HLS error:', data);
        if (data.fatal) {
          console.log('[player] HLS fatal error, trying next source');
          tryNextSource();
        }
      });
      hlsRef.current = hls;
    } else {
      video.src = videoData.url;
      video.addEventListener('loadeddata', () => {
        setIsLoading(false);
        if (initialTime > 0) {
          video.currentTime = initialTime;
          appliedInitialTime.current = true;
        }
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
  }, [videoData?.url, extractedUrl]);

  // Seek to initialTime when it arrives late (after video already loaded)
  const appliedInitialTime = useRef(false);
  useEffect(() => {
    if (initialTime > 0 && !isLoading && videoRef.current && !appliedInitialTime.current) {
      videoRef.current.currentTime = initialTime;
      appliedInitialTime.current = true;
    }
  }, [initialTime, isLoading]);

  // Reset applied flag when video changes
  useEffect(() => {
    appliedInitialTime.current = false;
  }, [videoData?.url]);

  // Progress reporting
  useEffect(() => {
    if (isIframe && !extractedUrl) return;
    progressInterval.current = setInterval(() => {
      if (videoRef.current && !videoRef.current.paused) {
        onTimeUpdate?.(videoRef.current.currentTime);
      }
    }, 5000); // report every 5 seconds
    return () => clearInterval(progressInterval.current);
  }, [onTimeUpdate, isIframe, extractedUrl]);

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
      if (isIframe && !extractedUrl) {
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
  }, [isIframe, activeSkip, skipSegments, resetHideTimer]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    video.paused ? video.play() : video.pause();
    document.activeElement?.blur();
    resetHideTimer();
  };

  // Mobile: handle tap (show controls or play/pause) and double-tap (seek)
  const handleMobileTap = useCallback((e) => {
    if (!isMobileApp) return;
    // Ignore taps on buttons/controls
    if (e.target.closest('button') || e.target.closest('.progress-bar')) return;

    const now = Date.now();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = (e.touches ? e.changedTouches[0].clientX : e.clientX);
    const timeDiff = now - lastTap.current.time;
    const isDoubleTap = timeDiff < 300;

    if (isDoubleTap) {
      // Cancel pending single-tap
      if (tapTimeout.current) clearTimeout(tapTimeout.current);

      // Double-tap: seek ±10s based on side
      const side = x < rect.left + rect.width / 2 ? 'left' : 'right';
      const video = videoRef.current;
      if (video) {
        if (side === 'right') {
          video.currentTime = Math.min(video.duration, video.currentTime + 10);
        } else {
          video.currentTime = Math.max(0, video.currentTime - 10);
        }
      }

      // Show visual feedback
      setDoubleTapSide(side);
      if (doubleTapTimer.current) clearTimeout(doubleTapTimer.current);
      doubleTapTimer.current = setTimeout(() => setDoubleTapSide(null), 600);

      lastTap.current = { time: 0, x: 0 };
      resetHideTimer();
      return;
    }

    // Single tap — delay to check for double-tap
    lastTap.current = { time: now, x };
    tapTimeout.current = setTimeout(() => {
      if (!showControls) {
        // Controls hidden → just show them
        resetHideTimer();
      } else {
        // Controls visible → toggle play/pause
        togglePlay();
      }
    }, 300);
  }, [isMobileApp, showControls, togglePlay, resetHideTimer]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
    // Remove focus from button so keyboard shortcuts work immediately
    document.activeElement?.blur();
    resetHideTimer();
  };

  const formatTime = (t) => {
    if (!t || isNaN(t)) return '0:00';
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const handleProgressClick = (e) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    if (videoRef.current) {
      videoRef.current.currentTime = pct * duration;
    }
    resetHideTimer();
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  // ── All embed sources exhausted and none worked ──
  if (sourcesExhausted && !extractedUrl) {
    return (
      <div ref={containerRef} className="relative w-full h-full bg-black flex flex-col items-center justify-center gap-4 text-center px-6">
        <div className="w-14 h-14 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-2">
          <Settings className="w-7 h-7 text-red-400" />
        </div>
        <p className="text-white/70 font-display font-semibold text-base">Lecteur indisponible</p>
        <p className="text-white/30 text-sm max-w-xs">
          Aucune source n'a pu charger cet épisode. Le lecteur est peut-être bloqué ou l'épisode temporairement indisponible.
        </p>
        <button
          onClick={onBack}
          className="mt-2 flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-white/60 text-sm hover:bg-white/10 hover:text-white transition"
        >
          <ChevronLeft className="w-4 h-4" />
          Retour
        </button>
      </div>
    );
  }

  // ── Visible iframe: extraction timed out ──
  // Skip if extractedUrl just arrived (listener cleared visibleIframeUrl, but render may lag)
  if (visibleIframeUrl && !extractedUrl) {
    return (
      <div ref={containerRef} className="relative w-full h-full bg-black">
        {!iframeLoaded && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black z-10 pointer-events-none">
            <div className="w-10 h-10 border-2 border-white/10 border-t-accent-primary rounded-full animate-spin" />
            <p className="text-white/40 text-sm">Chargement du lecteur...</p>
          </div>
        )}
        <iframe
          src={visibleIframeUrl}
          className="w-full h-full border-0"
          allowFullScreen
          allow="autoplay; encrypted-media; fullscreen"
          referrerPolicy="no-referrer"
          onLoad={() => setIframeLoaded(true)}
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
            <button
              onClick={tryNextSource}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition text-xs text-white font-medium"
              title="Essayer la source suivante"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Source suivante
            </button>
            {onPrevious && (
              <button
                onClick={onPrevious}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition text-xs text-white font-medium"
              >
                <SkipBack className="w-3.5 h-3.5" />
                Précédent
              </button>
            )}
            {onEnded && (
              <button
                onClick={onEnded}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition text-xs text-white font-medium"
              >
                <SkipForward className="w-3.5 h-3.5" />
                Suivant
              </button>
            )}
            {!isMobileApp && (
              <button
                onClick={toggleFullscreen}
                className="p-2 rounded-lg hover:bg-white/10 transition"
              >
                {isFullscreen
                  ? <Minimize className="w-4 h-4 text-white" />
                  : <Maximize className="w-4 h-4 text-white" />
                }
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Extraction in progress: hidden iframe for any source cycling, not just initial iframe mode ──
  if (!extractedUrl && extractUrl) {
    return (
      <div ref={containerRef} className="relative w-full h-full bg-black">
        {/* Hidden iframe — content script will extract the video URL */}
        <iframe
          key={extractUrl}
          src={extractUrl}
          className="absolute w-0 h-0 opacity-0 pointer-events-none"
          allow="autoplay; encrypted-media"
        />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black z-10 pointer-events-none">
          <div className="w-10 h-10 border-2 border-white/10 border-t-accent-primary rounded-full animate-spin" />
          <p className="text-white/40 text-sm">Chargement du lecteur...</p>
        </div>

        {/* Minimal overlay: back button + episode info + nav */}
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
            {onPrevious && (
              <button
                onClick={onPrevious}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition text-xs text-white font-medium"
              >
                <SkipBack className="w-3.5 h-3.5" />
                Précédent
              </button>
            )}
            {onEnded && (
              <button
                onClick={onEnded}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition text-xs text-white font-medium"
              >
                <SkipForward className="w-3.5 h-3.5" />
                Suivant
              </button>
            )}
            {!isMobileApp && (
              <button
                onClick={toggleFullscreen}
                className="p-2 rounded-lg hover:bg-white/10 transition"
              >
                {isFullscreen
                  ? <Minimize className="w-4 h-4 text-white" />
                  : <Maximize className="w-4 h-4 text-white" />
                }
              </button>
            )}
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
      style={{ cursor: showControls ? 'default' : 'none' }}
      onMouseMove={resetHideTimer}
      onClick={(e) => {
        if (isMobileApp) {
          handleMobileTap(e);
          return;
        }
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

      {/* Double-tap seek feedback */}
      {doubleTapSide && (
        <div
          className={`absolute top-0 bottom-0 flex items-center justify-center pointer-events-none z-20 ${
            doubleTapSide === 'right' ? 'right-0 w-1/3' : 'left-0 w-1/3'
          }`}
        >
          <div className="bg-white/20 rounded-full w-20 h-20 flex flex-col items-center justify-center animate-ping-once">
            <SkipForward className={`w-6 h-6 text-white ${doubleTapSide === 'left' ? 'rotate-180' : ''}`} />
            <span className="text-white text-xs font-bold mt-0.5">
              {doubleTapSide === 'right' ? '+10s' : '-10s'}
            </span>
          </div>
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
              {/* Previous episode */}
              {onPrevious && (
                <button
                  onClick={(e) => { e.stopPropagation(); onPrevious(); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition text-xs text-white font-medium"
                >
                  <SkipBack className="w-3.5 h-3.5" />
                  Précédent
                </button>
              )}
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

              {/* Fullscreen — hidden on mobile app (already fullscreen) */}
              {!isMobileApp && (
                <button
                  onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }}
                  className="p-2 rounded-lg hover:bg-white/10 transition"
                >
                  {isFullscreen
                    ? <Minimize className="w-4 h-4 text-white" />
                    : <Maximize className="w-4 h-4 text-white" />
                  }
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}