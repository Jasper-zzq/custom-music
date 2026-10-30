import type { Track } from "./types";
export const lyricSourceNames: Record<string, string> = {
  geciwang: "歌词网",
  geciqianxun: "歌词千寻",
};
export interface LyricCandidate extends Track {
  score: number;
  exactMatch: boolean;
}
export interface LyricResolution {
  raw: string;
  source: string;
  title: string;
  candidates: LyricCandidate[];
  failures: string[];
}
export type LyricCall = (
  source: string,
  method: string,
  args: any[],
) => Promise<any>;
const genericArtists =
  /^(未知歌手|未知作者|未知艺术家|本地音频|unknown(?: artist)?|various artists)$/i;
export function lyricArtist(track: Track) {
  return genericArtists.test((track.artist || "").trim())
    ? ""
    : (track.artist || "").trim();
}
function cleanTitle(title: string) {
  return title
    .replace(/\.(mp3|flac|wav|m4a|aac|ogg|opus)$/i, "")
    .replace(
      /[【\[(](?:官方\s*)?(?:mv|official\s*(?:audio|video)|lyrics?|歌词|高清|无损|4k|1080p|320k)[】\])]/gi,
      "",
    )
    .trim()
    .slice(0, 150);
}
export function lyricQuery(track: Track) {
  const title = cleanTitle(track.title);
  return title.match(/《([^》]{1,80})》/)?.[1]?.trim() || title;
}
function identity(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, "");
}
function titleIdentity(track: Track) {
  let title = cleanTitle(track.title);
  const artist = lyricArtist(track);
  const parts = title.split(/\s+[-–—]\s+/);
  if (artist && parts.length === 2 && identity(parts[0]) === identity(artist))
    title = parts[1];
  return identity(title);
}
export function scoreCandidate(
  track: Track,
  candidate: Track,
): { score: number; exactMatch: boolean } {
  const target = titleIdentity(track),
    actual = titleIdentity(candidate);
  const exactTitle = Boolean(target && actual === target);
  const relatedTitle = Boolean(
    target.length >= 2 &&
      actual.length >= 2 &&
      (actual.includes(target) || target.includes(actual)),
  );
  const artists = lyricArtist(track)
    .split(/[,，/&、;；]+/)
    .map(identity)
    .filter(Boolean);
  const matchesArtist = lyricArtist(candidate)
    .split(/[,，/&、;；]+/)
    .map(identity)
    .some((artist) => artists.includes(artist));
  return {
    score: (exactTitle ? 70 : relatedTitle ? 35 : 0) + (matchesArtist ? 30 : 0),
    exactMatch: exactTitle && matchesArtist,
  };
}
export function normalizeLyric(raw: unknown): string {
  if (
    typeof raw !== "string" ||
    raw.length > 200000 ||
    /^https?:\/\//i.test(raw.trim()) ||
    /<(?:html|body|script|!doctype)\b/i.test(raw)
  )
    return "";
  const text = raw.replace(/\r/g, "").trim();
  const body = text.replace(/\[[^\]]*\]/g, "").replace(/[\s，,。.!！]/g, "");
  if (
    !body ||
    /^(暂无歌词|没有歌词|纯音乐请欣赏|此歌曲为没有填词的纯音乐)$/.test(body)
  )
    return "";
  // Preserve consecutive timestamps for a repeated line; split concatenated LRC lines.
  return text.replace(/([^\]\n])(?=\[\d{1,3}:\d{1,2}(?:\.\d+)?\])/g, "$1\n");
}
export async function resolveLyrics(
  track: Track,
  call: LyricCall,
  options: {
    native?: boolean;
    query?: string;
    autoChoose?: boolean;
    isCurrent?: () => boolean;
    onPhase?: (phase: string) => void;
    onCandidates?: (candidates: LyricCandidate[]) => void;
  } = {},
): Promise<LyricResolution> {
  const result: LyricResolution = {
    raw: "",
    source: "",
    title: "",
    candidates: [],
    failures: [],
  };
  const isCurrent = options.isCurrent || (() => true);
  if (options.native !== false && track.source !== "local") {
    options.onPhase?.("正在获取原音源歌词");
    try {
      const response = await call(track.source, "getLyric", [track]);
      if (!isCurrent()) return result;
      const raw = normalizeLyric(response.rawLrc);
      if (raw)
        return { ...result, raw, source: track.source, title: track.title };
    } catch {
      /* Missing or failed native lyrics fall through to independent sources. */
    }
  }
  if (!isCurrent()) return result;
  const query = (options.query ?? lyricQuery(track)).trim().slice(0, 200);
  if (!query) return result;
  options.onPhase?.("正在匹配歌词网、歌词千寻");
  const batches = await Promise.all(
    Object.keys(lyricSourceNames).map(async (source) => {
      try {
        const response = await call(source, "search", [query, 1, "lyric"]);
        if (!Array.isArray(response.data)) throw new Error("返回格式不兼容");
        return response.data
          .slice(0, 30)
          .filter(
            (item: any) =>
              item &&
              (typeof item.id === "string" || typeof item.id === "number") &&
              typeof item.title === "string",
          )
          .map((item: any) => {
            const candidate = { ...item, source } as Track;
            return { ...candidate, ...scoreCandidate(track, candidate) };
          });
      } catch (error) {
        result.failures.push(
          `${lyricSourceNames[source]}：${error instanceof Error ? error.message : "请求失败"}`,
        );
        return [];
      }
    }),
  );
  if (!isCurrent()) return result;
  result.candidates = [
    ...new Map<string, LyricCandidate>(
      batches
        .flat()
        .map((candidate) => [`${candidate.source}:${candidate.id}`, candidate]),
    ).values(),
  ]
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);
  options.onCandidates?.(result.candidates);
  if (options.autoChoose !== false) {
    for (const candidate of result.candidates
      .filter((item) => item.exactMatch)
      .slice(0, 2)) {
      if (!isCurrent()) return result;
      options.onPhase?.(`正在读取${lyricSourceNames[candidate.source]}`);
      try {
        const response = await call(candidate.source, "getLyric", [candidate]);
        if (!isCurrent()) return result;
        const raw = normalizeLyric(response.rawLrc);
        if (raw)
          return {
            ...result,
            raw,
            source: candidate.source,
            title: candidate.title,
          };
      } catch {
        /* Try at most one other exact title + artist match. */
      }
    }
  }
  return result;
}
export function parseLyric(raw: string) {
  const lines: { time: number; text: string }[] = [];
  for (const line of normalizeLyric(raw).split("\n")) {
    const stamps = [...line.matchAll(/\[(\d{1,3}):(\d{1,2}(?:\.\d+)?)\]/g)];
    const text = line.replace(/\[[^\]]*\]/g, "").trim();
    for (const stamp of stamps)
      lines.push({ time: Number(stamp[1]) * 60 + Number(stamp[2]), text });
    if (!stamps.length && text) lines.push({ time: -1, text });
  }
  return lines.sort((a, b) => a.time - b.time);
}
