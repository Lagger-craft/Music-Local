import { useCallback, useEffect, useRef, useState } from 'react';
import type { Track } from '../types';

export type DeckStatus = 'play' | 'pause' | 'stop';

/** VU level per bar, 0-100 (% of bar width). */
export type VuLevels = [number, number, number];

const IDLE_LEVELS: VuLevels = [8, 8, 8];

/** Web Audio graph state; null until lazily created on first play gesture. */
interface AudioGraph {
  ctx: AudioContext;
  analyser: AnalyserNode;
  data: Uint8Array<ArrayBuffer>;
}

/**
 * Player core: a single HTMLAudioElement, a queue model, transport
 * (rewind/play-pause/stop/forward), click-to-seek progress against the real
 * audio duration, auto-advance on "ended", and real VU meters driven by an
 * AnalyserNode created lazily on the first user play gesture.
 */
export function usePlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  if (audioRef.current === null && typeof Audio !== 'undefined') {
    audioRef.current = new Audio();
    audioRef.current.preload = 'metadata';
  }
  const audio = audioRef.current;

  const [queue, setQueue] = useState<Track[]>([]);
  const [index, setIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [stopped, setStopped] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [levels, setLevels] = useState<VuLevels>(IDLE_LEVELS);

  // Refs mirroring state for use inside long-lived event handlers.
  const queueRef = useRef<Track[]>([]);
  const indexRef = useRef(-1);
  const playingRef = useRef(false);
  const graphRef = useRef<AudioGraph | null>(null);
  const rafRef = useRef(0);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);
  useEffect(() => {
    indexRef.current = index;
  }, [index]);
  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  const currentTrack = index >= 0 && index < queue.length ? queue[index] : null;

  // ---------------------------------------------------------------- Web Audio

  /**
   * Lazily create AudioContext -> MediaElementSource -> Analyser -> destination
   * on the first user play gesture. Must run synchronously inside a gesture
   * handler. Never throws: on any failure playback continues through the plain
   * audio element and the meters stay idle.
   */
  const ensureAudioGraph = useCallback((): boolean => {
    if (!audio) return false;
    if (graphRef.current) {
      if (graphRef.current.ctx.state === 'suspended') {
        void graphRef.current.ctx.resume().catch(() => undefined);
      }
      return true;
    }
    try {
      const Ctor: typeof AudioContext | undefined =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return false;
      const ctx = new Ctor();
      const source = ctx.createMediaElementSource(audio);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyser.connect(ctx.destination);
      graphRef.current = { ctx, analyser, data: new Uint8Array(analyser.frequencyBinCount) };
      return true;
    } catch {
      graphRef.current = null;
      return false;
    }
  }, [audio]);

  // VU meter loop: three bars from low/mid/high frequency bands.
  useEffect(() => {
    if (!playing || !graphRef.current) {
      setLevels(IDLE_LEVELS);
      return;
    }
    const tick = () => {
      const graph = graphRef.current;
      if (!graph) return;
      graph.analyser.getByteFrequencyData(graph.data);
      const bands: [number, number, number] = [0, 0, 0];
      const ranges: [number, number][] = [
        [1, 8],
        [9, 40],
        [41, 100],
      ];
      for (let b = 0; b < 3; b++) {
        const [from, to] = ranges[b];
        let sum = 0;
        let count = 0;
        for (let i = from; i <= to && i < graph.data.length; i++) {
          sum += graph.data[i];
          count++;
        }
        bands[b] = count > 0 ? (sum / count / 255) * 100 : 0;
      }
      setLevels([Math.max(8, bands[0]), Math.max(8, bands[1]), Math.max(8, bands[2])]);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing]);

  // ------------------------------------------------------------------ Loading

  /** Load a queue entry into the element; play only when autoplay is set. */
  const loadAt = useCallback(
    (i: number, autoplay: boolean) => {
      if (!audio) return;
      const track = queueRef.current[i];
      if (!track) return;
      setIndex(i);
      indexRef.current = i;
      setStopped(!autoplay);
      audio.src = `/api/tracks/${track.id}/stream`;
      audio.load();
      // Show the catalog duration until real metadata arrives.
      setDuration(track.duration ?? 0);
      setCurrentTime(0);
      if (autoplay) {
        ensureAudioGraph();
        void audio.play().catch(() => setPlaying(false));
      }
    },
    [audio, ensureAudioGraph],
  );

  // --------------------------------------------------------- Element events
  useEffect(() => {
    if (!audio) return;
    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onDurationChange = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
      }
    };
    const onPlay = () => {
      setPlaying(true);
      setStopped(false);
    };
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      // Auto-advance; wrap around at the end of the queue.
      const len = queueRef.current.length;
      if (len === 0) return;
      const next = (indexRef.current + 1) % len;
      loadAt(next, true);
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('durationchange', onDurationChange);
    audio.addEventListener('loadedmetadata', onDurationChange);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('durationchange', onDurationChange);
      audio.removeEventListener('loadedmetadata', onDurationChange);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
    };
  }, [audio, loadAt]);

  // Release resources on unmount.
  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      if (audio) {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      }
      const graph = graphRef.current;
      graphRef.current = null;
      if (graph) void graph.ctx.close().catch(() => undefined);
    };
  }, [audio]);

  // --------------------------------------------------------------- Transport

  /** Playing a track sets the queue to the visible list and starts at index. */
  const playQueue = useCallback(
    (tracks: Track[], startIndex = 0) => {
      if (tracks.length === 0) return;
      const i = Math.min(Math.max(startIndex, 0), tracks.length - 1);
      queueRef.current = tracks;
      setQueue(tracks);
      loadAt(i, true);
    },
    [loadAt],
  );

  const togglePlay = useCallback(() => {
    if (!audio || !currentTrack) return;
    if (playingRef.current) {
      audio.pause();
      setStopped(false);
    } else {
      ensureAudioGraph();
      setStopped(false);
      void audio.play().catch(() => setPlaying(false));
    }
  }, [audio, currentTrack, ensureAudioGraph]);

  const stop = useCallback(() => {
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    setCurrentTime(0);
    setPlaying(false);
    setStopped(true);
  }, [audio]);

  const step = useCallback(
    (dir: 1 | -1) => {
      const len = queueRef.current.length;
      if (len === 0) return;
      const wasPlaying = playingRef.current;
      const next = (indexRef.current + dir + len) % len;
      loadAt(next, wasPlaying);
    },
    [loadAt],
  );

  const next = useCallback(() => step(1), [step]);
  const prev = useCallback(() => step(-1), [step]);

  /** Seek by fraction (0-1) of the real audio duration. */
  const seekFraction = useCallback(
    (fraction: number) => {
      if (!audio || !currentTrack) return;
      const total = Number.isFinite(audio.duration) && audio.duration > 0
        ? audio.duration
        : (currentTrack.duration ?? 0);
      if (total <= 0) return;
      const clamped = Math.min(Math.max(fraction, 0), 1);
      audio.currentTime = clamped * total;
      setCurrentTime(audio.currentTime);
    },
    [audio, currentTrack],
  );

  /** Patch a track everywhere it appears (queue included), e.g. favorite flips. */
  const patchTrack = useCallback((id: string, patch: Partial<Track>) => {
    setQueue((q) => q.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    queueRef.current = queueRef.current.map((t) => (t.id === id ? { ...t, ...patch } : t));
  }, []);

  const status: DeckStatus = playing ? 'play' : stopped ? 'stop' : 'pause';

  return {
    queue,
    index,
    currentTrack,
    playing,
    status,
    currentTime,
    duration,
    levels,
    playQueue,
    togglePlay,
    stop,
    next,
    prev,
    seekFraction,
    patchTrack,
  };
}
