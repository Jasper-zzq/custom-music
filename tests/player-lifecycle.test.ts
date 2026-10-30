import test from "node:test";
import assert from "node:assert/strict";

const active = new Set<FakeAudio>();
class FakeAudio extends EventTarget {
  src = "";
  preload = "";
  currentTime = 0;
  duration = 100;
  volume = 0.7;
  error = null;
  paused = true;
  play() {
    this.paused = false;
    active.add(this);
    this.dispatchEvent(new Event("playing"));
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
    active.delete(this);
    this.dispatchEvent(new Event("pause"));
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
Object.defineProperty(globalThis, "localStorage", {
  value: { getItem: () => null, setItem: () => {} },
});
const first = { id: "hmr-first", source: "tx", title: "First" };
const second = { id: "hmr-second", source: "tx", title: "Second" };
const loadPlayer = (suffix: string) =>
  import(
    `${new URL("../src/player.ts", import.meta.url).href}?lifecycle=${suffix}`
  );

test("播放器模块重新加载后，上一实例必须已停止，不能与新实例叠加", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({ url: "https://example.com/audio.mp3" });
  let a: any, b: any;
  try {
    a = await loadPlayer("first");
    await a.playTrack(first);
    assert.equal(active.size, 1);
    b = await loadPlayer("second");
    await b.playTrack(second);
    assert.equal(active.size, 1, "同一页面同时存在两个正在播放的 Audio 实例");
    assert.equal(a.audio.paused, true);
    assert.equal(a.audio.src, "");
    await a.togglePlay();
    assert.equal(active.size, 1, "旧模块残留的播放回调不能重新启动旧播放器");
  } finally {
    a?.stop();
    b?.stop();
    globalThis.fetch = original;
  }
});

test("热更新销毁旧实例时中止解析，旧请求晚到也不能重新播放", async () => {
  const original = globalThis.fetch;
  let resolveOld!: (response: Response) => void;
  let oldSignal: AbortSignal | undefined;
  let count = 0;
  globalThis.fetch = async (_url, init) => {
    count++;
    if (count === 1) {
      oldSignal = init?.signal as AbortSignal;
      return new Promise((resolve) => (resolveOld = resolve));
    }
    return Response.json({ url: "https://example.com/new.mp3" });
  };
  let a: any, b: any;
  try {
    a = await loadPlayer("pending-old");
    const pending = a.playTrack(first);
    b = await loadPlayer("pending-new");
    assert.equal(oldSignal?.aborted, true);
    await b.playTrack(second);
    resolveOld(Response.json({ url: "https://example.com/old.mp3" }));
    await pending;
    assert.equal(active.size, 1);
    assert.equal(a.audio.paused, true);
    assert.equal(a.audio.src, "");
    assert.equal(b.audio.src, "https://example.com/new.mp3");
  } finally {
    a?.stop();
    b?.stop();
    globalThis.fetch = original;
  }
});
