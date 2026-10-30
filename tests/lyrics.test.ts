import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveLyrics,
  lyricQuery,
  scoreCandidate,
  normalizeLyric,
  parseLyric,
} from "../src/lyric-matching.js";
const track = {
  source: "bilibili",
  id: "test",
  title: "示例歌曲",
  artist: "示例歌手",
};
const candidate = {
  id: "https://example.com/lyric/1",
  title: "示例歌曲",
  artist: "示例歌手",
};
const raw = "[00:01.00]测试第一行\n[00:05.00]测试第二行";

test("原音源有歌词时不请求外部歌词源", async () => {
  const calls: string[] = [];
  const result = await resolveLyrics(track, async (source, method) => {
    calls.push(`${source}:${method}`);
    return { rawLrc: raw };
  });
  assert.deepEqual(calls, ["bilibili:getLyric"]);
  assert.equal(result.raw, raw);
  assert.equal(result.source, "bilibili");
});
test("原音源失败后并行搜索两个歌词源，单源失败不阻塞自动匹配", async () => {
  const started: string[] = [];
  const releases = new Map<string, () => void>();
  const pending = resolveLyrics(track, async (source, method) => {
    if (source === "bilibili") throw new Error("没有原生歌词");
    if (method === "search") {
      started.push(source);
      await new Promise<void>((resolve) => releases.set(source, resolve));
      if (source === "geciwang") throw new Error("上游失败");
      return { data: [candidate] };
    }
    return { rawLrc: raw };
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started.sort(), ["geciqianxun", "geciwang"]);
  releases.forEach((release) => release());
  const result = await pending;
  assert.equal(result.source, "geciqianxun");
  assert.equal(result.raw, raw);
  assert.equal(result.failures.length, 1);
});
test("空歌词进入补全，但同名不同歌手、翻唱和现场版不自动套用", async () => {
  assert.equal(
    scoreCandidate(track, { ...candidate, source: "geciwang" }).exactMatch,
    true,
  );
  assert.equal(
    scoreCandidate(track, {
      ...candidate,
      artist: "其他歌手",
      source: "geciwang",
    }).exactMatch,
    false,
  );
  assert.equal(
    scoreCandidate(
      { ...track, title: "示例歌曲 (Live)" },
      { ...candidate, source: "geciwang" },
    ).exactMatch,
    false,
  );
  assert.equal(
    scoreCandidate(
      { ...track, title: "示例歌曲 (Cover)" },
      { ...candidate, source: "geciwang" },
    ).exactMatch,
    false,
  );
  assert.equal(
    scoreCandidate(
      { ...track, artist: "本地音频" },
      { ...candidate, source: "geciwang" },
    ).exactMatch,
    false,
  );
  let gets = 0;
  const result = await resolveLyrics(track, async (source, method) => {
    if (source === "bilibili") return { rawLrc: "暂无歌词" };
    if (method === "search")
      return { data: [{ ...candidate, artist: "其他歌手" }] };
    gets++;
    return { rawLrc: raw };
  });
  assert.equal(gets, 0);
  assert.equal(result.raw, "");
  assert.equal(result.candidates.length, 2);
});
test("手动搜索只列出候选，不自动替换现有歌词", async () => {
  let gets = 0;
  const result = await resolveLyrics(
    track,
    async (_source, method) => {
      if (method === "search") return { data: [candidate] };
      gets++;
      return { rawLrc: raw };
    },
    { native: false, autoChoose: false, query: "示例歌曲" },
  );
  assert.equal(gets, 0);
  assert.equal(result.candidates.length, 2);
  assert.equal(result.raw, "");
});
test("处理无换行LRC、多时间戳和纯文本，不制造不存在的时间轴", () => {
  const joined = "[00:01.00][00:04.00]同一行[00:08.00]下一行";
  assert.deepEqual(
    parseLyric(joined).map((line) => [line.time, line.text]),
    [
      [1, "同一行"],
      [4, "同一行"],
      [8, "下一行"],
    ],
  );
  assert.deepEqual(
    parseLyric("第一行\n第二行").map((line) => line.time),
    [-1, -1],
  );
  assert.equal(normalizeLyric("[ti:只有元数据][ar:歌手]"), "");
  assert.equal(normalizeLyric("https://example.com/lyrics.lrc"), "");
});

test("视频标题中的书名号可用于检索，现场版仍不自动误配原版", () => {
  const video = { ...track, title: "【4K】示例歌手《示例歌曲》神级现场" };
  assert.equal(lyricQuery(video), "示例歌曲");
  assert.equal(
    scoreCandidate(video, { ...candidate, source: "geciwang" }).exactMatch,
    false,
  );
});
