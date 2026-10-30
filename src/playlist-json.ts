import { uniqueTracks, validateLibrary } from "./library";
import type { Playlist } from "./types";

// Accept our playlist exports, previous full backups, and a single plain playlist.
export function parsePlaylistJson(text: string): Playlist[] {
  let value;
  try {
    value = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error("JSON 文件无法解析，请检查文件内容");
  }
  if (!value || typeof value !== "object")
    throw new Error("请选择 Music Web 歌单 JSON 或备份文件");
  if (value.version !== undefined && value.version !== 1)
    throw new Error("不支持此歌单文件版本");
  const lists = value.playlists ?? (Array.isArray(value.tracks) ? [value] : null);
  if (!Array.isArray(lists) || !lists.length || lists.length > 1000)
    throw new Error("文件需包含 1–1000 个歌单");
  const playlists = lists.map((list) => {
    if (!list || typeof list !== "object")
      throw new Error("歌单数据不完整");
    return { ...list, id: list.id ?? crypto.randomUUID() };
  });
  const ids = new Set(playlists.map((list) => list.id));
  return validateLibrary({ version: 1, playlists }).playlists.filter((list) =>
    ids.has(list.id),
  );
}

export function serializePlaylists(playlists: Playlist[]): string {
  return JSON.stringify({ version: 1, playlists }, null, 2);
}

// Same IDs merge without deleting songs or changing the existing playlist name.
export function mergePlaylists(existing: Playlist[], incoming: Playlist[]): Playlist[] {
  const merged = existing.map((list) => ({ ...list, tracks: [...list.tracks] }));
  for (const list of incoming) {
    const target = merged.find((item) => item.id === list.id);
    if (target) target.tracks = uniqueTracks([...target.tracks, ...list.tracks]);
    else merged.push({ ...list, tracks: [...list.tracks] });
  }
  if (merged.length > 1000) throw new Error("导入后超过 1000 个歌单，请先整理现有歌单");
  return merged;
}
