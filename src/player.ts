import { computed, ref, watch } from "vue";
import { api, call } from "./api";
import { library, notify } from "./store";
import { trackKey, nextIndex, uniqueTracks } from "./library";
import { readAudio } from "./local-audio";
import type { Track } from "./types";
import { createPlaybackFocus } from "./playback-focus";
import { connectMenuLyrics } from "./menu-lyrics";
import {
  resolveLyrics,
  normalizeLyric,
  parseLyric,
  lyricSourceNames,
  type LyricCandidate,
} from "./lyric-matching";

// Vite can re-evaluate this module without reloading the document.
// Retire the previous owner before constructing another Audio instance.
const playerScope = globalThis as typeof globalThis & {
  __musicWebPlayer?: { dispose: () => void };
};
playerScope.__musicWebPlayer?.dispose();
export const audio = new Audio();
let disposed = false;
const mediaEvents = new AbortController();
let playbackRequest: AbortController | null = null;
const isPlaybackCurrent = (ticket: number) =>
  !disposed && ticket === generation;
audio.preload = "metadata";
if (typeof document !== "undefined" && document.body) {
  audio.dataset.musicWebPlayer = "true";
  audio.hidden = true;
  document.body.append(audio);
}
export const current = ref<Track | null>(null);
export const playing = ref(false);
export const loading = ref(false);
export const time = ref(0);
export const duration = ref(0);
export const playbackError = ref("");
export const lyric = ref("");
export const lyricError = ref("");
export const lyricLoading = ref(false);
export const lyricPhase = ref("");
export const lyricSource = ref("");
export const lyricMatchedTitle = ref("");
export const lyricCandidates = ref<LyricCandidate[]>([]);
export const lyricFailures = ref<string[]>([]);
export const lyricOffset = ref(0);
let lyricRevision = 0;
const lyricCache = new Map<
  string,
  { raw: string; source: string; title: string }
>();
function lyricCacheKey(track: Track) {
  return `${trackKey(track)}:${track.title}:${track.artist || ""}`;
}
function resetLyrics() {
  lyricRevision++;
  lyric.value = "";
  lyricError.value = "";
  lyricLoading.value = false;
  lyricSource.value = "";
  lyricMatchedTitle.value = "";
  lyricPhase.value = "";
  lyricCandidates.value = [];
  lyricFailures.value = [];
  lyricOffset.value = 0;
}
function commitLyrics(
  raw: string,
  source: string,
  title: string,
  track: Track,
) {
  lyric.value = raw;
  lyricSource.value = source;
  lyricMatchedTitle.value = title;
  lyricError.value = "";
  lyricOffset.value = 0;
  if (lyricCache.size >= 50) lyricCache.delete(lyricCache.keys().next().value!);
  lyricCache.set(lyricCacheKey(track), { raw, source, title });
}
export function applyMatchedLyric(raw: string, source: string, title: string) {
  if (!current.value) return;
  const normalized = normalizeLyric(raw);
  if (!normalized) {
    lyricError.value = "所选结果没有有效歌词";
    return;
  }
  lyricRevision++;
  lyricLoading.value = false;
  lyricPhase.value = "";
  commitLyrics(normalized, source, title, current.value);
}
let generation = 0;
// Failed entries are skipped for this playback session; an explicit selection retries them.
const failedTracks = new Set<string>();
let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
let handledFailure = -1;
function cancelRecovery() {
  clearTimeout(recoveryTimer);
  recoveryTimer = undefined;
}
function availableNextIndex(ended = false, recovering = false) {
  const queue = library.queue;
  if (!queue.length) return -1;
  const mode = recovering && library.mode !== "random" ? "list" : library.mode;
  if (mode === "random") {
    const eligible = queue
      .map((_track, index) => index)
      .filter((index) => !failedTracks.has(trackKey(queue[index])));
    const others = eligible.filter((index) => index !== currentIndex.value);
    const pool = others.length ? others : eligible;
    return pool.length ? pool[Math.floor(Math.random() * pool.length)] : -1;
  }
  let index = nextIndex(currentIndex.value, queue.length, mode, ended);
  for (let checked = 0; checked < queue.length && index >= 0; checked++) {
    if (!failedTracks.has(trackKey(queue[index]))) return index;
    index = nextIndex(
      index,
      queue.length,
      mode === "single" ? "list" : mode,
      false,
    );
  }
  return -1;
}
function failureMessage(error: unknown) {
  if (error instanceof DOMException && error.name === "NotAllowedError")
    return "浏览器阻止自动播放，请点击播放按钮";
  if (error instanceof DOMException && error.name === "NotSupportedError")
    return "浏览器无法解码此音频";
  return error instanceof Error ? error.message : "播放失败";
}
function handlePlaybackFailure(ticket: number, error: unknown) {
  if (!isPlaybackCurrent(ticket) || handledFailure === ticket) return;
  handledFailure = ticket;
  const message = failureMessage(error);
  // This is a browser permission issue, not a bad song. Wait for a user click.
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    releaseMedia();
    playbackError.value = message;
    return;
  }
  if (current.value) failedTracks.add(trackKey(current.value));
  if (current.value && /请求过于频繁|429|IP.*限制|block ip/i.test(message)) {
    for (const track of library.queue)
      if (track.source === current.value.source)
        failedTracks.add(trackKey(track));
  }
  const canContinue = availableNextIndex(false, true) >= 0;
  // Keep the claim until handoff, so another tab can cancel a delayed continuation.
  releaseMedia(canContinue);
  if (!canContinue) {
    playbackError.value = `当前队列已尝试一轮，暂无可播放歌曲。点击播放可重试。最后错误：${message}`;
    return;
  }
  playbackError.value = `「${current.value?.title || "当前歌曲"}」无法播放，正在跳过：${message}`;
  loading.value = true;
  recoveryTimer = setTimeout(() => {
    recoveryTimer = undefined;
    if (!isPlaybackCurrent(ticket)) return;
    const index = availableNextIndex(false, true);
    if (index < 0) {
      releaseMedia();
      playbackError.value = "当前队列没有可播放歌曲，点击播放可重试。";
      return;
    }
    void attemptTrack(library.queue[index]);
  }, 300);
}
async function startAudio() {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      audio.play(),
      new Promise<void>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("音频加载超时")), 20000);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}
let objectUrl = "";
let hlsEngine: import("hls.js").default | null = null;
let cancelHls: (() => void) | null = null;
function cleanupHls() {
  const cancel = cancelHls;
  cancelHls = null;
  cancel?.();
  const engine = hlsEngine;
  hlsEngine = null;
  if (engine) {
    try {
      engine.stopLoad();
    } finally {
      engine.destroy();
    }
  }
}
function releaseMedia(retainFocus = false) {
  cancelRecovery();
  // Pause first: teardown or a pending network response must never keep the old song audible.
  audio.pause();
  playbackRequest?.abort();
  playbackRequest = null;
  try {
    cleanupHls();
  } finally {
    audio.srcObject = null;
    audio.removeAttribute("src");
    audio.load();
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = "";
    }
    playing.value = false;
    loading.value = false;
    if (!retainFocus) focus.release();
  }
}
const focus = createPlaybackFocus(() => {
  generation++;
  releaseMedia();
});
function pausePlayback() {
  if (disposed) return;
  if (loading.value) {
    generation++;
    releaseMedia();
  } else {
    audio.pause();
    playing.value = false;
    focus.release();
  }
}
export const currentIndex = computed(() =>
  current.value
    ? library.queue.findIndex((t) => trackKey(t) === trackKey(current.value!))
    : -1,
);
audio.volume = library.volume;
const unwatchVolume = watch(
  () => library.volume,
  (value) => (audio.volume = value),
);
function onMedia(type: string, listener: EventListener) {
  audio.addEventListener(type, listener, { signal: mediaEvents.signal });
}
onMedia("timeupdate", () => (time.value = audio.currentTime));
onMedia(
  "durationchange",
  () => (duration.value = Number.isFinite(audio.duration) ? audio.duration : 0),
);
onMedia("playing", () => {
  if (audio.getAttribute("src") && audio.paused !== true) playing.value = true;
});
onMedia("pause", () => (playing.value = false));
onMedia("ended", () => {
  if (!loading.value && audio.getAttribute("src")) void next(true);
});
onMedia("error", () => {
  if (!audio.getAttribute("src") || !audio.error || audio.error.code === 1)
    return;
  handlePlaybackFailure(generation, new Error("音频地址失效或无法解码"));
});
export async function playTrack(track: Track, queue?: Track[]) {
  if (disposed) return;
  failedTracks.clear();
  await attemptTrack(track, queue);
}
async function attemptTrack(track: Track, queue?: Track[]) {
  if (disposed) return;
  const ticket = ++generation;
  releaseMedia();
  const claim = focus.claim();
  const request = new AbortController();
  playbackRequest = request;
  if (queue) library.queue = uniqueTracks(queue);
  if (!library.queue.some((t) => trackKey(t) === trackKey(track)))
    library.queue.push(track);
  if (!current.value || trackKey(current.value) !== trackKey(track))
    resetLyrics();
  current.value = track;
  time.value = 0;
  duration.value = 0;
  playbackError.value = "";
  loading.value = true;
  try {
    let url: string;
    let hls = false;
    if (track.source === "local") {
      const blob = await readAudio(String(track.id));
      if (!isPlaybackCurrent(ticket)) return;
      objectUrl = URL.createObjectURL(blob);
      url = objectUrl;
    } else {
      const result = await api(
        "play-url",
        {
          source: track.source,
          item: track,
          quality: library.quality,
        },
        request.signal,
      );
      url = result.url;
      hls = result.format === "hls";
    }
    if (!isPlaybackCurrent(ticket)) return;
    if (!(await focus.acquire(claim)) || !isPlaybackCurrent(ticket)) return;
    if (hls && !audio.canPlayType("application/vnd.apple.mpegurl")) {
      const { default: Hls } = await import("hls.js");
      if (!isPlaybackCurrent(ticket)) return;
      if (!Hls.isSupported()) throw new Error("当前浏览器不支持此流媒体格式");
      const engine = new Hls({
        manifestLoadingMaxRetry: 0,
        levelLoadingMaxRetry: 0,
        fragLoadingMaxRetry: 0,
      });
      hlsEngine = engine;
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(
          () => finish(new Error("流媒体加载超时，请手动重试")),
          20000,
        );
        function finish(error?: Error) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          cancelHls = null;
          error ? reject(error) : resolve();
        }
        cancelHls = () => finish(new Error("已取消加载"));
        engine.on(Hls.Events.MANIFEST_PARSED, () => finish());
        engine.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal) return;
          engine.stopLoad();
          const error = new Error("流媒体播放失败，请重新播放或切换来源");
          if (isPlaybackCurrent(ticket)) handlePlaybackFailure(ticket, error);
          finish(error);
        });
        engine.attachMedia(audio);
        engine.loadSource(url);
      });
    } else audio.src = url;
    if (!isPlaybackCurrent(ticket)) return;
    await startAudio();
    if (!isPlaybackCurrent(ticket)) return;
    if ("mediaSession" in navigator && isPlaybackCurrent(ticket)) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: track.artist || "",
        album: track.album || "",
      });
    }
  } catch (error) {
    handlePlaybackFailure(ticket, error);
  } finally {
    if (isPlaybackCurrent(ticket) && !recoveryTimer) loading.value = false;
  }
}
export async function togglePlay() {
  if (disposed) return;
  if (loading.value || playing.value) {
    pausePlayback();
    return;
  }
  if (
    current.value &&
    (!audio.getAttribute("src") || audio.error || playbackError.value)
  ) {
    await playTrack(current.value);
    return;
  }
  if (audio.getAttribute("src")) {
    const ticket = generation;
    const claim = focus.claim();
    loading.value = true;
    try {
      if (!(await focus.acquire(claim)) || !isPlaybackCurrent(ticket)) return;
      await startAudio();
      if (isPlaybackCurrent(ticket)) playbackError.value = "";
    } catch (error) {
      handlePlaybackFailure(ticket, error);
    } finally {
      if (isPlaybackCurrent(ticket) && !recoveryTimer) loading.value = false;
    }
    return;
  }
  const track = library.queue[0];
  if (track) await playTrack(track);
  else notify("先选择一首歌曲");
}
export async function next(ended = false) {
  if (disposed) return;
  const index = availableNextIndex(ended);
  if (index >= 0) await attemptTrack(library.queue[index]);
  else pausePlayback();
}
export function previous() {
  if (!library.queue.length) return;
  void playTrack(library.queue[Math.max(0, currentIndex.value - 1)]);
}
export function seek(value: number) {
  if (Number.isFinite(value) && duration.value)
    audio.currentTime = Math.max(0, Math.min(value, duration.value));
}
export function queueNext(track: Track) {
  library.queue = library.queue.filter(
    (t) =>
      trackKey(t) !== trackKey(track) ||
      trackKey(t) === (current.value && trackKey(current.value)),
  );
  if (current.value && trackKey(current.value) === trackKey(track)) return;
  library.queue.splice(currentIndex.value + 1, 0, track);
  notify("已加入下一首");
}
export async function fetchLyric(
  options: { native?: boolean; forceFallback?: boolean; query?: string } = {},
) {
  const track = current.value;
  if (!track) return;
  const ticket = ++lyricRevision;
  const isCurrent = () =>
    ticket === lyricRevision &&
    Boolean(current.value && trackKey(current.value) === trackKey(track));
  lyricError.value = "";
  lyricFailures.value = [];
  lyricCandidates.value = [];
  if (!options.forceFallback && options.query === undefined) {
    const cached = lyricCache.get(lyricCacheKey(track));
    if (cached) {
      commitLyrics(cached.raw, cached.source, cached.title, track);
      lyricLoading.value = false;
      return;
    }
  }
  lyricLoading.value = true;
  try {
    const result = await resolveLyrics(track, call, {
      native: options.forceFallback ? false : options.native,
      query: options.query,
      autoChoose: options.query === undefined,
      isCurrent,
      onPhase: (phase) => {
        if (isCurrent()) lyricPhase.value = phase;
      },
      onCandidates: (candidates) => {
        if (isCurrent()) lyricCandidates.value = candidates;
      },
    });
    if (!isCurrent()) return;
    lyricFailures.value = result.failures;
    if (result.raw)
      commitLyrics(result.raw, result.source, result.title, track);
    else
      lyricError.value = result.candidates.length
        ? "找到候选歌词，请选择正确版本"
        : "未找到歌词，可修改关键词再搜索";
  } catch (error) {
    if (isCurrent())
      lyricError.value =
        error instanceof Error ? error.message : "歌词匹配失败";
  } finally {
    if (isCurrent()) {
      lyricLoading.value = false;
      lyricPhase.value = "";
    }
  }
}
export async function chooseLyricCandidate(candidate: LyricCandidate) {
  const track = current.value;
  if (!track) return;
  const ticket = ++lyricRevision;
  const isCurrent = () =>
    ticket === lyricRevision &&
    Boolean(current.value && trackKey(current.value) === trackKey(track));
  lyricLoading.value = true;
  lyricError.value = "";
  lyricPhase.value = `正在读取${lyricSourceNames[candidate.source] || "歌词"}`;
  try {
    const response = await call(candidate.source, "getLyric", [candidate]);
    if (!isCurrent()) return;
    const raw = normalizeLyric(response.rawLrc);
    if (!raw) throw new Error("此结果没有有效歌词，请选择其他版本");
    commitLyrics(raw, candidate.source, candidate.title, track);
  } catch (error) {
    if (isCurrent()) lyricError.value = (error as Error).message;
  } finally {
    if (isCurrent()) {
      lyricLoading.value = false;
      lyricPhase.value = "";
    }
  }
}
export const lyricLines = computed(() => parseLyric(lyric.value));
export const lyricTimed = computed(() =>
  lyricLines.value.some((line) => line.time >= 0),
);
export const lyricSourceLabel = computed(
  () =>
    lyricSourceNames[lyricSource.value] || (lyricSource.value ? "原音源" : ""),
);
export function seekLyric(seconds: number) {
  seek(seconds - lyricOffset.value);
}
export const activeLyric = computed(() => {
  let active = -1;
  lyricLines.value.forEach((line, i) => {
    if (line.time >= 0 && line.time <= time.value + lyricOffset.value)
      active = i;
  });
  return active;
});
const disconnectMenuLyrics = connectMenuLyrics(() => ({
  title: current.value?.title || "",
  artist: current.value?.artist || "",
  line: lyricLines.value[activeLyric.value]?.text || "",
  playing: playing.value,
}));
export function stop() {
  generation++;
  failedTracks.clear();
  resetLyrics();
  releaseMedia();
  current.value = null;
  time.value = 0;
  duration.value = 0;
}
const owner = {
  dispose() {
    if (disposed) return;
    disposed = true;
    try {
      stop();
    } finally {
      mediaEvents.abort();
      if (typeof document !== "undefined") audio.remove();
      unwatchVolume();
      disconnectMenuLyrics();
      focus.dispose();
      if (typeof window !== "undefined")
        window.removeEventListener("pagehide", stop);
      if (playerScope.__musicWebPlayer === owner) {
        if ("mediaSession" in navigator)
          for (const action of [
            "play",
            "pause",
            "previoustrack",
            "nexttrack",
            "seekto",
          ] as const)
            navigator.mediaSession.setActionHandler(action, null);
        delete playerScope.__musicWebPlayer;
      }
    }
  },
};
playerScope.__musicWebPlayer = owner;
if (typeof window !== "undefined") window.addEventListener("pagehide", stop);
if (import.meta.hot) import.meta.hot.dispose(owner.dispose);
if ("mediaSession" in navigator) {
  navigator.mediaSession.setActionHandler("play", () => {
    if (!playing.value) void togglePlay();
  });
  navigator.mediaSession.setActionHandler("pause", pausePlayback);
  navigator.mediaSession.setActionHandler("previoustrack", previous);
  navigator.mediaSession.setActionHandler("nexttrack", () => void next());
  navigator.mediaSession.setActionHandler("seekto", (details) =>
    seek(details.seekTime || 0),
  );
}
export function formatTime(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}
