import test from "node:test";
import assert from "node:assert/strict";

class FakeAudio extends EventTarget {
  src = "";
  preload = "";
  volume = 0.7;
  currentTime = 0;
  duration = 10;
  paused = true;
  error: { code: number } | null = null;
  rejectMode = "";
  rejected = 0;
  play() {
    if (this.rejectMode === "permission")
      return Promise.reject(new DOMException("Not allowed", "NotAllowedError"));
    if (this.rejectMode === "decode" && this.src.endsWith("/b.mp3")) {
      this.rejected++;
      this.fail();
      return Promise.reject(
        new DOMException("Cannot decode", "NotSupportedError"),
      );
    }
    this.paused = false;
    this.dispatchEvent(new Event("playing"));
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
    this.dispatchEvent(new Event("pause"));
  }
  load() {
    this.currentTime = 0;
    this.error = null;
  }
  getAttribute(name: string) {
    return name === "src" ? this.src : null;
  }
  removeAttribute(name: string) {
    if (name === "src") this.src = "";
  }
  finish() {
    this.paused = true;
    this.dispatchEvent(new Event("pause"));
    this.dispatchEvent(new Event("ended"));
  }
  fail() {
    this.error = { code: 3 };
    this.paused = true;
    this.dispatchEvent(new Event("error"));
  }
}
Object.defineProperty(globalThis, "Audio", { value: FakeAudio });
Object.defineProperty(globalThis, "navigator", { value: {} });
const data = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
  },
});
const player = await import("../src/player.js");
const { library } = await import("../src/store.js");
const a = { source: "tx", id: "a", title: "A" },
  b = { source: "tx", id: "b", title: "B" },
  c = { source: "tx", id: "c", title: "C" };
const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
async function until(condition: () => boolean) {
  const deadline = Date.now() + 2200;
  while (!condition()) {
    if (Date.now() > deadline) assert.fail("自动续播未完成");
    await tick();
  }
}

test("歌曲结束后自动跳过不可播放的下一首，并循环剩余可播放歌曲", async () => {
  const original = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async (_url, init) => {
    const id = JSON.parse(String(init?.body)).item.id;
    requests.push(id);
    return id === "b"
      ? Response.json({ error: "歌曲不可播放" }, { status: 502 })
      : Response.json({ url: `https://example.com/${id}.mp3` });
  };
  try {
    library.mode = "list";
    await player.playTrack(a, [a, b, c]);
    (player.audio as unknown as FakeAudio).finish();
    await until(() => player.current.value?.id === "c" && player.playing.value);
    assert.deepEqual(requests, ["a", "b", "c"]);
    (player.audio as unknown as FakeAudio).finish();
    await until(() => player.current.value?.id === "a" && player.playing.value);
    (player.audio as unknown as FakeAudio).finish();
    await until(() => player.current.value?.id === "c" && player.playing.value);
    assert.deepEqual(requests, ["a", "b", "c", "a", "c"]);
  } finally {
    player.stop();
    globalThis.fetch = original;
  }
});

test("只有一首可播放时仍然循环该歌曲", async () => {
  const original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    return Response.json({ url: "https://example.com/a.mp3" });
  };
  try {
    library.mode = "list";
    await player.playTrack(a, [a]);
    (player.audio as unknown as FakeAudio).finish();
    await until(
      () => requests === 2 && player.playing.value && !player.loading.value,
    );
    assert.equal(player.current.value?.id, "a");
  } finally {
    player.stop();
    globalThis.fetch = original;
  }
});
test("整轮均失败时停止，不无限重试；手动选择后允许重试", async () => {
  const original = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)).item.id);
    return Response.json({ error: "歌曲失效" }, { status: 502 });
  };
  try {
    library.mode = "list";
    await player.playTrack(a, [a, b, c]);
    await until(
      () => !player.loading.value && /一轮/.test(player.playbackError.value),
    );
    assert.deepEqual(requests, ["a", "b", "c"]);
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(requests.length, 3);
    await player.playTrack(a, [a]);
    assert.deepEqual(requests, ["a", "b", "c", "a"]);
    assert.equal(player.playing.value, false);
  } finally {
    player.stop();
    globalThis.fetch = original;
  }
});
test("播放中发生媒体错误也能自动切换，重复错误不会跳过两首", async () => {
  const original = globalThis.fetch;
  const requests: string[] = [];
  const audio = player.audio as unknown as FakeAudio;
  globalThis.fetch = async (_url, init) => {
    const id = JSON.parse(String(init?.body)).item.id;
    requests.push(id);
    return Response.json({ url: `https://example.com/${id}.mp3` });
  };
  try {
    library.mode = "list";
    audio.rejectMode = "decode";
    await player.playTrack(a, [a, b, c]);
    audio.finish();
    await until(() => player.current.value?.id === "c" && player.playing.value);
    assert.deepEqual(requests, ["a", "b", "c"]);
    assert.equal(audio.rejected, 1);
    audio.fail();
    await until(() => player.current.value?.id === "a" && player.playing.value);
    assert.deepEqual(requests, ["a", "b", "c", "a"]);
  } finally {
    audio.rejectMode = "";
    audio.rejected = 0;
    player.stop();
    globalThis.fetch = original;
  }
});
test("跳过失败曲目的等待期间按暂停，不会稍后自行恢复", async () => {
  const original = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async (_url, init) => {
    const id = JSON.parse(String(init?.body)).item.id;
    requests.push(id);
    return id === "a"
      ? Response.json({ error: "失败" }, { status: 502 })
      : Response.json({ url: "https://example.com/b.mp3" });
  };
  try {
    library.mode = "list";
    await player.playTrack(a, [a, b]);
    assert.equal(player.loading.value, true);
    await player.togglePlay();
    await new Promise((resolve) => setTimeout(resolve, 450));
    assert.deepEqual(requests, ["a"]);
    assert.equal(player.loading.value, false);
    assert.equal(player.playing.value, false);
  } finally {
    player.stop();
    globalThis.fetch = original;
  }
});
test("等待自动跳过时手动选歌，旧续播任务不会覆盖新选择", async () => {
  const original = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async (_url, init) => {
    const id = JSON.parse(String(init?.body)).item.id;
    requests.push(id);
    return id === "a"
      ? Response.json({ error: "失败" }, { status: 502 })
      : Response.json({ url: `https://example.com/${id}.mp3` });
  };
  try {
    library.mode = "list";
    await player.playTrack(a, [a, b, c]);
    await player.playTrack(c);
    await new Promise((resolve) => setTimeout(resolve, 450));
    assert.deepEqual(requests, ["a", "c"]);
    assert.equal(player.current.value?.id, "c");
    assert.equal(player.playing.value, true);
  } finally {
    player.stop();
    globalThis.fetch = original;
  }
});
test("浏览器拒绝自动播放时等待用户操作，不轮询整个歌单", async () => {
  const original = globalThis.fetch;
  let requests = 0;
  const audio = player.audio as unknown as FakeAudio;
  globalThis.fetch = async () => {
    requests++;
    return Response.json({ url: "https://example.com/a.mp3" });
  };
  try {
    audio.rejectMode = "permission";
    library.mode = "list";
    await player.playTrack(a, [a, b, c]);
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(requests, 1);
    assert.match(player.playbackError.value, /点击播放/);
  } finally {
    audio.rejectMode = "";
    player.stop();
    globalThis.fetch = original;
  }
});
test("来源明确限流时跳过同源歌曲，继续尝试其他来源", async () => {
  const original = globalThis.fetch;
  const requests: string[] = [];
  const alternate = { ...c, source: "bilibili" };
  globalThis.fetch = async (_url, init) => {
    const item = JSON.parse(String(init?.body)).item;
    requests.push(item.id);
    return item.source === "tx"
      ? Response.json({ error: "请求过于频繁" }, { status: 429 })
      : Response.json({ url: "https://example.com/c.mp3" });
  };
  try {
    library.mode = "list";
    await player.playTrack(a, [a, b, alternate]);
    await until(() => player.current.value?.id === "c" && player.playing.value);
    assert.deepEqual(requests, ["a", "c"]);
  } finally {
    player.stop();
    globalThis.fetch = original;
  }
});
