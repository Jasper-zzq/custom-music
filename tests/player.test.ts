import test from "node:test";
import assert from "node:assert/strict";

class FakeAudio extends EventTarget {
  src = "";
  volume = 0.7;
  preload = "";
  currentTime = 0;
  duration = 100;
  error = null;
  plays = 0;
  pause() {
    this.dispatchEvent(new Event("pause"));
  }
  play() {
    this.plays++;
    this.dispatchEvent(new Event("playing"));
    return Promise.resolve();
  }
  load() {
    this.currentTime = 0;
  }
  getAttribute(name: string) {
    return name === "src" ? this.src : null;
  }
  removeAttribute(name: string) {
    if (name === "src") this.src = "";
  }
}
Object.defineProperty(globalThis, "Audio", { value: FakeAudio });
Object.defineProperty(globalThis, "navigator", { value: {} });
const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => storage.get(key),
    setItem: (key: string, value: string) => storage.set(key, value),
  },
});
const player = await import("../src/player.js");
const { library } = await import("../src/store.js");
const first = { id: "1", source: "tx", title: "First" };
const second = { id: "2", source: "tx", title: "Second" };

test("快速切歌时，迟到的旧请求不会覆盖当前歌曲或错误状态", async () => {
  const original = globalThis.fetch;
  const replies: ((response: Response) => void)[] = [];
  globalThis.fetch = () => new Promise((resolve) => replies.push(resolve));
  try {
    const a = player.playTrack(first);
    const b = player.playTrack(second);
    replies[1](Response.json({ url: "https://example.com/second.mp3" }));
    await b;
    replies[0](Response.json({ error: "旧歌曲失败" }, { status: 502 }));
    await a;
    assert.equal(player.audio.src, "https://example.com/second.mp3");
    assert.equal(player.current.value?.id, "2");
    assert.equal(player.playbackError.value, "");
    assert.equal(player.playing.value, true);
    assert.equal(player.loading.value, false);
  } finally {
    globalThis.fetch = original;
    player.stop();
  }
});
test("取消加载后，尚未完成的解析不能重新启动播放", async () => {
  const original = globalThis.fetch;
  let reply!: (response: Response) => void;
  globalThis.fetch = () => new Promise((resolve) => (reply = resolve));
  try {
    const pending = player.playTrack(first);
    await player.togglePlay();
    reply(Response.json({ url: "https://example.com/first.mp3" }));
    await pending;
    assert.equal(player.audio.src, "");
    assert.equal(player.playing.value, false);
    assert.equal(player.loading.value, false);
  } finally {
    globalThis.fetch = original;
    player.stop();
  }
});
test("下一首插入不会重复当前曲目，顺序播放结束后不自动重启", async () => {
  library.queue = [first, second];
  player.current.value = first;
  player.queueNext(second);
  assert.deepEqual(
    library.queue.map((t) => t.id),
    ["1", "2"],
  );
  player.queueNext(first);
  assert.deepEqual(
    library.queue.map((t) => t.id),
    ["1", "2"],
  );
  player.current.value = second;
  library.mode = "sequence";
  await player.next(true);
  assert.equal(player.playing.value, false);
});

test("歌词支持多时间戳并随播放时间切换当前行", () => {
  player.lyric.value =
    "[00:00.00]开场\n[00:03.50][00:08.00]重复歌词\n[00:12.00]结束";
  assert.deepEqual(
    player.lyricLines.value.map((line) => line.time),
    [0, 3.5, 8, 12],
  );
  player.time.value = 4;
  assert.equal(player.activeLyric.value, 1);
  player.time.value = 9;
  assert.equal(player.activeLyric.value, 2);
  player.time.value = 1;
  assert.equal(player.activeLyric.value, 0);
});

test("手动应用歌词后，较晚完成的自动匹配不会覆盖选择", async () => {
  const original = globalThis.fetch;
  const replies: ((response: Response) => void)[] = [];
  globalThis.fetch = () => new Promise((resolve) => replies.push(resolve));
  player.current.value = {
    id: "lyrics-race",
    source: "bilibili",
    title: "示例歌曲",
    artist: "示例歌手",
  };
  try {
    const pending = player.fetchLyric({ native: false, forceFallback: true });
    player.applyMatchedLyric("[00:01]手动选择", "geciwang", "手动版");
    const result = {
      data: {
        data: [{ id: "candidate", title: "示例歌曲", artist: "示例歌手" }],
      },
    };
    replies[0](Response.json(result));
    replies[1](Response.json(result));
    await pending;
    assert.equal(player.lyric.value, "[00:01]手动选择");
    assert.equal(player.lyricSource.value, "geciwang");
    assert.equal(player.lyricLoading.value, false);
    assert.equal(replies.length, 2);
  } finally {
    globalThis.fetch = original;
    player.stop();
  }
});
test("歌词请求在切歌后返回，不会覆盖新歌曲", async () => {
  const original = globalThis.fetch;
  const replies: ((response: Response) => void)[] = [];
  globalThis.fetch = () => new Promise((resolve) => replies.push(resolve));
  player.current.value = { ...first, id: "lyric-old" };
  try {
    const pending = player.chooseLyricCandidate({
      id: "candidate-old",
      source: "geciwang",
      title: "旧歌词",
      score: 100,
      exactMatch: true,
    });
    const playback = player.playTrack(second);
    replies[1](Response.json({ url: "https://example.com/second.mp3" }));
    await playback;
    replies[0](Response.json({ data: { rawLrc: "[00:01]旧歌词" } }));
    await pending;
    assert.equal(player.current.value?.id, second.id);
    assert.equal(player.lyric.value, "");
    assert.equal(player.lyricLoading.value, false);
  } finally {
    globalThis.fetch = original;
    player.stop();
  }
});
test("歌词偏移改变高亮和跳转时间，不会切换或重新播放歌曲", () => {
  player.current.value = second;
  player.duration.value = 100;
  player.applyMatchedLyric("[00:00]一\n[00:05]二", "geciwang", "示例歌曲");
  player.time.value = 4.8;
  player.lyricOffset.value = 0.5;
  assert.equal(player.activeLyric.value, 1);
  player.seekLyric(5);
  assert.equal(player.audio.currentTime, 4.5);
  assert.equal(player.current.value?.id, second.id);
  player.stop();
});

test("选择下一首时立即停止正在播放的歌曲并撤销旧解析请求", async () => {
  const original = globalThis.fetch;
  const signals: AbortSignal[] = [];
  let resolveNext!: (response: Response) => void;
  let count = 0;
  globalThis.fetch = async (_url, init) => {
    signals.push(init?.signal as AbortSignal);
    count++;
    if (count === 1)
      return Response.json({ url: "https://example.com/first.mp3" });
    return new Promise((resolve) => (resolveNext = resolve));
  };
  try {
    await player.playTrack(first);
    assert.equal(player.playing.value, true);
    const pending = player.playTrack(second);
    assert.equal(player.playing.value, false);
    assert.equal(player.audio.src, "");
    assert.equal(signals[0].aborted, true);
    resolveNext(Response.json({ url: "https://example.com/second.mp3" }));
    await pending;
    assert.equal(player.current.value?.id, second.id);
    assert.equal(player.playing.value, true);
  } finally {
    globalThis.fetch = original;
    player.stop();
  }
});
