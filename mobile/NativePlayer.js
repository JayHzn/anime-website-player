// ── Native player (Android/iOS) ──────────────────────────────
// The reason this exists: inside the WebView, hls.js fetches the playlist and
// every segment from the site's own origin, and a page cannot set Referer or
// Origin. Hosts that check them 403 the segments — extraction succeeds and
// playback still fails.
//
// expo-video hands the URL to ExoPlayer/AVPlayer together with the headers
// attached to the source, which is exactly what Aniyomi does with `Video.headers`.
// So on mobile the WebView stops playing video altogether: it stays the UI, and
// this component takes over the frame whenever an episode starts.
//
// Controls are custom rather than `nativeControls` because the player has to
// carry the app's own affordances: OP/ED skip, next/previous episode, and the
// variant picker fed by the source's extractors.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, PanResponder, Pressable, ScrollView,
  StyleSheet, Text, View,
} from 'react-native';
import { useEvent, useEventListener } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';

const ACCENT = '#a855f7';
const PROGRESS_REPORT_MS = 5000;
const CONTROLS_HIDE_MS = 3000;
const DOUBLE_TAP_MS = 300;
const SEEK_STEP = 10;

function formatTime(t) {
  if (!Number.isFinite(t) || t < 0) return '0:00';
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

/** Turn one resolved Video into the source shape expo-video expects. */
function toSource(video) {
  if (!video?.url) return null;
  return {
    uri: video.url,
    headers: video.headers ?? {},
    // The whole point of this component. Without these the CDN 403s the segments.
    // iOS only detects HLS from the extension or this hint, and our URLs usually
    // end in a token query rather than `.m3u8`.
    contentType: /\.m3u8(\?|$)/i.test(video.url) ? 'hls' : 'auto',
    metadata: { title: video.quality ?? 'Video' },
  };
}

export default function NativePlayer({ data, onEvent }) {
  const videos = useMemo(() => data?.videos ?? [], [data]);

  const [index, setIndex] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [menu, setMenu] = useState(null);          // 'quality' | 'subtitles' | null
  const [seekHint, setSeekHint] = useState(null);  // 'left' | 'right' | null
  const [currentTime, setCurrentTime] = useState(data?.initialTime ?? 0);
  const [duration, setDuration] = useState(0);
  const [dragTime, setDragTime] = useState(null);  // non-null while scrubbing
  const [failed, setFailed] = useState(false);
  const [subtitleTracks, setSubtitleTracks] = useState([]);
  const [activeSubtitleId, setActiveSubtitleId] = useState(null);

  // ── Refs (declared before anything closes over them) ───────
  const hideTimer = useRef(null);
  const seekHintTimer = useRef(null);
  const lastReport = useRef(0);
  const lastTap = useRef(0);
  const surfaceWidth = useRef(1);
  const barWidth = useRef(0);
  const barPageX = useRef(0);
  const barRef = useRef(null);
  const dismissedSkips = useRef(new Set());
  // Playhead to restore once the (re)loaded source reports readyToPlay: the
  // episode's saved position at mount, then the live position across a variant
  // switch — picking 720p mid-episode should not restart it.
  const pendingSeek = useRef(data?.initialTime ?? 0);
  const seekApplied = useRef(false);
  // PanResponder is built once, so its handlers read live values through refs.
  const liveRef = useRef({});

  const active = videos[index];

  const player = useVideoPlayer(toSource(active), (p) => {
    p.timeUpdateEventInterval = 1;
    p.staysActiveInBackground = false;
    p.keepScreenOnWhilePlaying = true;
    p.play();
  });

  const { status, error } = useEvent(player, 'statusChange', { status: player.status });
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });

  // ── Controls auto-hide ─────────────────────────────────────
  const bumpControls = useCallback(() => {
    setShowControls(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setShowControls(false), CONTROLS_HIDE_MS);
  }, []);

  useEffect(() => {
    bumpControls();
    return () => {
      clearTimeout(hideTimer.current);
      clearTimeout(seekHintTimer.current);
    };
  }, [bumpControls]);

  // ── Variant switching ──────────────────────────────────────
  // Skipped on the first render: useVideoPlayer already loaded videos[0].
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    const source = toSource(videos[index]);
    if (!source) return;
    seekApplied.current = false;
    pendingSeek.current = currentTime;
    player.replace(source);
    // currentTime is read as the resume point, not tracked: re-running this on
    // every tick would reload the stream once a second.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, videos, player]);

  // ── Status → resume / failover ─────────────────────────────
  useEffect(() => {
    if (status === 'readyToPlay') {
      setFailed(false);
      setDuration(player.duration || 0);
      if (!seekApplied.current && pendingSeek.current > 1) {
        player.currentTime = pendingSeek.current;
        seekApplied.current = true;
        pendingSeek.current = 0;
      }
      return;
    }
    if (status !== 'error') return;

    // Same degradation order as the web player: next resolved variant first
    // (usually the next quality down, or another host); only once the list is
    // exhausted do we hand the episode back to the WebView, which still has the
    // hidden-iframe extractor as its own last resort.
    console.warn('[native-player] source failed:', videos[index]?.quality, error?.message);
    if (index + 1 < videos.length) {
      setIndex(index + 1);
    } else {
      setFailed(true);
      onEvent?.('failed', { reason: error?.message ?? 'playback error' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // ── Progress ───────────────────────────────────────────────
  useEventListener(player, 'timeUpdate', ({ currentTime: t }) => {
    if (dragTime === null) setCurrentTime(t);
    if (!duration && player.duration) setDuration(player.duration);

    const now = Date.now();
    if (now - lastReport.current > PROGRESS_REPORT_MS) {
      lastReport.current = now;
      onEvent?.('time', { time: t });
    }
  });

  useEventListener(player, 'playToEnd', () => {
    onEvent?.('time', { time: player.duration || currentTime });
    onEvent?.('ended', {});
  });

  useEventListener(player, 'availableSubtitleTracksChange', ({ availableSubtitleTracks }) => {
    setSubtitleTracks(availableSubtitleTracks ?? []);
  });

  // ── Skip segments ──────────────────────────────────────────
  const skip = data?.skipSegments ?? null;
  const activeSkip = ['opening', 'ending'].find((type) => {
    const seg = skip?.[type];
    return seg
      && currentTime >= seg.start
      && currentTime < seg.end - 3
      && !dismissedSkips.current.has(type);
  }) ?? null;

  // ── Gestures ───────────────────────────────────────────────
  const flashSeekHint = useCallback((side) => {
    setSeekHint(side);
    clearTimeout(seekHintTimer.current);
    seekHintTimer.current = setTimeout(() => setSeekHint(null), 600);
  }, []);

  const onSurfaceTap = useCallback((e) => {
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      lastTap.current = 0;
      const side = e.nativeEvent.locationX < surfaceWidth.current / 2 ? 'left' : 'right';
      player.seekBy(side === 'left' ? -SEEK_STEP : SEEK_STEP);
      flashSeekHint(side);
      bumpControls();
      return;
    }
    lastTap.current = now;
    if (showControls) setShowControls(false);
    else bumpControls();
  }, [bumpControls, flashSeekHint, player, showControls]);

  const timeAtTouch = useCallback((pageX) => {
    if (!duration || barWidth.current <= 0) return null;
    const ratio = Math.min(1, Math.max(0, (pageX - barPageX.current) / barWidth.current));
    return ratio * duration;
  }, [duration]);

  liveRef.current = { timeAtTouch, player, bumpControls };

  const barResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        const t = liveRef.current.timeAtTouch(e.nativeEvent.pageX);
        if (t !== null) setDragTime(t);
      },
      onPanResponderMove: (e) => {
        const t = liveRef.current.timeAtTouch(e.nativeEvent.pageX);
        if (t !== null) setDragTime(t);
      },
      onPanResponderRelease: (e) => {
        const t = liveRef.current.timeAtTouch(e.nativeEvent.pageX);
        if (t !== null) {
          liveRef.current.player.currentTime = t;
          setCurrentTime(t);
        }
        setDragTime(null);
        liveRef.current.bumpControls();
      },
    })
  ).current;

  const measureBar = useCallback(() => {
    barRef.current?.measureInWindow((x, _y, width) => {
      barPageX.current = x;
      barWidth.current = width;
    });
  }, []);

  const shownTime = dragTime ?? currentTime;
  const progress = duration > 0 ? Math.min(1, shownTime / duration) : 0;
  const isBuffering = status === 'loading' || status === 'idle';

  // ── Render ─────────────────────────────────────────────────

  if (failed) {
    return (
      <View style={styles.container}>
        <View style={styles.centered}>
          <Text style={styles.errorTitle}>Lecture impossible</Text>
          <Text style={styles.errorBody}>
            Aucune des {videos.length} source(s) résolue(s) n'a pu être lue.
          </Text>
          <Pressable style={styles.button} onPress={() => onEvent?.('back', {})}>
            <Text style={styles.buttonText}>Retour</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View
      style={styles.container}
      onLayout={(e) => { surfaceWidth.current = e.nativeEvent.layout.width; }}
    >
      <VideoView
        style={StyleSheet.absoluteFill}
        player={player}
        nativeControls={false}
        contentFit="contain"
        allowsPictureInPicture
        playsInline
      />

      <Pressable style={StyleSheet.absoluteFill} onPress={onSurfaceTap} />

      {isBuffering && (
        <View style={styles.centeredOverlay} pointerEvents="none">
          <ActivityIndicator size="large" color={ACCENT} />
        </View>
      )}

      {seekHint && (
        <View
          style={[styles.seekHint, seekHint === 'left' ? styles.seekHintLeft : styles.seekHintRight]}
          pointerEvents="none"
        >
          <Text style={styles.seekHintText}>{seekHint === 'left' ? '-10s' : '+10s'}</Text>
        </View>
      )}

      {activeSkip && (
        <Pressable
          style={styles.skipButton}
          onPress={() => {
            player.currentTime = skip[activeSkip].end;
            dismissedSkips.current.add(activeSkip);
            bumpControls();
          }}
        >
          <Text style={styles.skipButtonText}>
            {activeSkip === 'opening' ? "Passer l'intro" : "Passer l'ending"}
          </Text>
        </Pressable>
      )}

      {showControls && (
        <>
          <View style={styles.topBar}>
            <Pressable hitSlop={12} onPress={() => onEvent?.('back', {})}>
              <Text style={styles.backIcon}>‹</Text>
            </Pressable>
            <View style={styles.titleBlock}>
              <Text style={styles.title} numberOfLines={1}>{data?.title ?? ''}</Text>
              <Text style={styles.subtitle} numberOfLines={1}>{data?.episodeLabel ?? ''}</Text>
            </View>
          </View>

          <View style={styles.centeredOverlay} pointerEvents="box-none">
            <Pressable
              style={styles.playButton}
              onPress={() => { if (isPlaying) player.pause(); else player.play(); bumpControls(); }}
            >
              <Text style={styles.playButtonText}>{isPlaying ? '❙❙' : '▶'}</Text>
            </Pressable>
          </View>

          <View style={styles.bottomBar}>
            <View style={styles.barRow} {...barResponder.panHandlers}>
              <View ref={barRef} style={styles.barTrack} onLayout={measureBar}>
                {['opening', 'ending'].map((type) => {
                  const seg = skip?.[type];
                  if (!seg || !duration) return null;
                  return (
                    <View
                      key={type}
                      style={[styles.barMarker, {
                        left: `${(seg.start / duration) * 100}%`,
                        width: `${((seg.end - seg.start) / duration) * 100}%`,
                      }]}
                    />
                  );
                })}
                <View style={[styles.barFill, { width: `${progress * 100}%` }]} />
                <View style={[styles.barThumb, { left: `${progress * 100}%` }]} />
              </View>
            </View>

            <View style={styles.controlsRow}>
              <Text style={styles.time}>
                {formatTime(shownTime)} / {formatTime(duration)}
              </Text>

              <View style={styles.controlsRight}>
                {data?.hasPrev && (
                  <Pressable style={styles.pill} onPress={() => onEvent?.('prev', {})}>
                    <Text style={styles.pillText}>Précédent</Text>
                  </Pressable>
                )}
                {data?.hasNext && (
                  <Pressable style={styles.pill} onPress={() => onEvent?.('next', {})}>
                    <Text style={styles.pillText}>Suivant</Text>
                  </Pressable>
                )}
                {subtitleTracks.length > 0 && (
                  <Pressable
                    style={styles.pill}
                    onPress={() => { setMenu(menu === 'subtitles' ? null : 'subtitles'); bumpControls(); }}
                  >
                    <Text style={styles.pillText}>CC</Text>
                  </Pressable>
                )}
                {videos.length > 1 && (
                  <Pressable
                    style={styles.pill}
                    onPress={() => { setMenu(menu === 'quality' ? null : 'quality'); bumpControls(); }}
                  >
                    <Text style={styles.pillText}>
                      {/\d{3,4}p/.exec(active?.quality ?? '')?.[0] ?? 'Auto'}
                    </Text>
                  </Pressable>
                )}
              </View>
            </View>
          </View>

          {menu && (
            <View style={styles.menu}>
              <ScrollView>
                {menu === 'quality' && videos.map((v, i) => (
                  <Pressable
                    key={`${v.url}|${v.quality}`}
                    style={[styles.menuItem, i === index && styles.menuItemActive]}
                    onPress={() => { setIndex(i); setMenu(null); bumpControls(); }}
                  >
                    <Text style={[styles.menuText, i === index && styles.menuTextActive]}>
                      {v.quality}
                    </Text>
                  </Pressable>
                ))}

                {menu === 'subtitles' && (
                  <>
                    <Pressable
                      style={[styles.menuItem, activeSubtitleId === null && styles.menuItemActive]}
                      onPress={() => { player.subtitleTrack = null; setActiveSubtitleId(null); setMenu(null); }}
                    >
                      <Text style={[styles.menuText, activeSubtitleId === null && styles.menuTextActive]}>
                        Aucun
                      </Text>
                    </Pressable>
                    {subtitleTracks.map((t) => {
                      const id = t.id ?? t.language;
                      return (
                        <Pressable
                          key={id}
                          style={[styles.menuItem, activeSubtitleId === id && styles.menuItemActive]}
                          onPress={() => { player.subtitleTrack = t; setActiveSubtitleId(id); setMenu(null); }}
                        >
                          <Text style={[styles.menuText, activeSubtitleId === id && styles.menuTextActive]}>
                            {t.label || t.language}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </>
                )}
              </ScrollView>
            </View>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  centeredOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },

  errorTitle: { color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 8 },
  errorBody: { color: 'rgba(255,255,255,0.5)', fontSize: 13, textAlign: 'center', marginBottom: 16 },
  button: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.1)' },
  buttonText: { color: '#fff', fontSize: 13, fontWeight: '600' },

  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  titleBlock: { flex: 1 },
  title: { color: '#fff', fontSize: 14, fontWeight: '700' },
  subtitle: { color: 'rgba(255,255,255,0.5)', fontSize: 11 },
  backIcon: { color: '#fff', fontSize: 30, lineHeight: 32, paddingHorizontal: 4 },

  playButton: {
    width: 64, height: 64, borderRadius: 32,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(168,85,247,0.85)',
  },
  playButtonText: { color: '#fff', fontSize: 22 },

  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingHorizontal: 16, paddingBottom: 14, paddingTop: 28,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  barRow: { paddingVertical: 10 },
  barTrack: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.22)' },
  barFill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 2, backgroundColor: ACCENT },
  barMarker: { position: 'absolute', top: 0, bottom: 0, backgroundColor: 'rgba(96,165,250,0.45)' },
  barThumb: {
    position: 'absolute', top: -5, width: 14, height: 14, marginLeft: -7,
    borderRadius: 7, backgroundColor: ACCENT,
  },

  controlsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  controlsRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  time: { color: 'rgba(255,255,255,0.6)', fontSize: 12, fontVariant: ['tabular-nums'] },
  pill: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  pillText: { color: '#fff', fontSize: 12, fontWeight: '600' },

  skipButton: {
    position: 'absolute', right: 16, bottom: 110,
    paddingHorizontal: 18, paddingVertical: 11, borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  skipButtonText: { color: '#000', fontSize: 13, fontWeight: '700' },

  seekHint: {
    position: 'absolute', top: '45%',
    paddingHorizontal: 18, paddingVertical: 14, borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  seekHintLeft: { left: '15%' },
  seekHintRight: { right: '15%' },
  seekHintText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  menu: {
    position: 'absolute', right: 16, bottom: 86,
    width: 260, maxHeight: 220, borderRadius: 14, padding: 6,
    backgroundColor: 'rgba(0,0,0,0.92)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  menuItem: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10 },
  menuItemActive: { backgroundColor: 'rgba(168,85,247,0.22)' },
  menuText: { color: 'rgba(255,255,255,0.65)', fontSize: 12 },
  menuTextActive: { color: '#fff' },
});
