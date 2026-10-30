import type { Library, Track, Playlist } from "./types";
import { librarySourceIds } from "../shared/sources";
export const trackKey = (track: Track) =>
  `${track.source}:${track.songmid ?? track.id}`;
export const emptyLibrary = (): Library => ({
  version: 1,
  playlists: [{ id: "favorites", name: "我爱听的", tracks: [] }],
  queue: [],
  volume: 0.7,
  mode: "list",
  quality: "320k",
});
export function uniqueTracks(tracks: Track[]) {
  return [...new Map(tracks.map((track) => [trackKey(track), track])).values()];
}
export function validateLibrary(input: unknown): Library {
  const value = input as Library;
  if (
    value?.version !== 1 ||
    !Array.isArray(value.playlists) ||
    value.playlists.length > 1000
  )
    throw new Error("备份格式不正确");
  const validTrack = (t: Track) =>
    t &&
    typeof t.title === "string" &&
    (typeof t.id === "string" || typeof t.id === "number") &&
    [...librarySourceIds, "local"].includes(t.source);
  const playlists: Playlist[] = value.playlists.map((p) => {
    if (
      typeof p.id !== "string" ||
      typeof p.name !== "string" ||
      !p.name.trim() ||
      !Array.isArray(p.tracks) ||
      !p.tracks.every(validTrack)
    )
      throw new Error("歌单数据不完整");
    return {
      id: p.id,
      name: p.id === "favorites" ? "我爱听的" : p.name.slice(0, 80),
      tracks: uniqueTracks(p.tracks),
    };
  });
  if (new Set(playlists.map((p) => p.id)).size !== playlists.length)
    throw new Error("备份包含重复歌单");
  if (!playlists.some((p) => p.id === "favorites"))
    playlists.unshift({ id: "favorites", name: "我爱听的", tracks: [] });
  playlists.sort((a, b) =>
    a.id === "favorites" ? -1 : b.id === "favorites" ? 1 : 0,
  );
  return {
    version: 1,
    playlists,
    queue:
      Array.isArray(value.queue) && value.queue.every(validTrack)
        ? uniqueTracks(value.queue)
        : [],
    volume:
      typeof value.volume === "number" && Number.isFinite(value.volume)
        ? Math.max(0, Math.min(1, value.volume))
        : 0.7,
    mode: ["sequence", "list", "single", "random"].includes(value.mode)
      ? value.mode
      : "list",
    quality: value.quality === "128k" ? "128k" : "320k",
  };
}
export function nextIndex(
  index: number,
  length: number,
  mode: string,
  ended: boolean,
  random = Math.random,
): number {
  if (!length) return -1;
  if (index < 0 || index >= length)
    return mode === "random" ? Math.floor(random() * length) : 0;
  if (mode === "single" && ended) return Math.max(0, index);
  if (mode === "random" && length > 1) {
    const candidate = Math.floor(random() * (length - 1));
    return candidate >= index ? candidate + 1 : candidate;
  }
  if (index + 1 < length) return index + 1;
  return mode === "sequence" ? -1 : 0;
}
