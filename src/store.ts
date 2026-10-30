import { reactive, ref, watch } from "vue";
import {
  emptyLibrary,
  validateLibrary,
  trackKey,
  uniqueTracks,
} from "./library";
import type { Track } from "./types";
export const storageKey = "music-web:library:v1";
export const notification = ref("");
let timer: ReturnType<typeof setTimeout>;
export function notify(message: string) {
  notification.value = message;
  clearTimeout(timer);
  timer = setTimeout(() => (notification.value = ""), 6000);
}
let initial = emptyLibrary();
let validInitialData = true;
try {
  const saved = localStorage.getItem(storageKey);
  if (saved) initial = validateLibrary(JSON.parse(saved));
} catch {
  validInitialData = false;
  notification.value =
    "本地数据无法读取，已使用空歌单；原数据未覆盖，请先导出备份。";
}
// Migrate the previous default once; later explicit mode choices remain respected.
try {
  const key = "music-web:continuous-playback-default:v1";
  if (validInitialData && !localStorage.getItem(key)) {
    if (initial.mode === "sequence") {
      initial.mode = "list";
      localStorage.setItem(storageKey, JSON.stringify(initial));
    }
    localStorage.setItem(key, "1");
  }
} catch {
  /* Storage failures are handled by the existing save feedback. */
}
export const library = reactive(initial);
watch(
  library,
  () => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(library));
    } catch {
      notify("保存失败，浏览器空间不足，请导出备份");
    }
  },
  { deep: true },
);
export function liked(track: Track) {
  return library.playlists[0].tracks.some(
    (t) => trackKey(t) === trackKey(track),
  );
}
export function toggleLike(track: Track) {
  const playlist = library.playlists[0];
  if (liked(track))
    playlist.tracks = playlist.tracks.filter(
      (t) => trackKey(t) !== trackKey(track),
    );
  else playlist.tracks.push(track);
}
export function addTracks(id: string, tracks: Track[]) {
  const playlist = library.playlists.find((p) => p.id === id);
  if (!playlist) return;
  playlist.tracks = uniqueTracks([...playlist.tracks, ...tracks]);
  notify(`已加入「${playlist.name}」`);
}
