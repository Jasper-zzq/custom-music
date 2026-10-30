import test from "node:test";
import assert from "node:assert/strict";
import { createPlaybackFocus } from "../src/playback-focus.js";

function harness() {
  const channels: {
    onmessage: ((event: MessageEvent) => void) | null;
    postMessage: (value: any) => void;
    close: () => void;
  }[] = [];
  const deliveries: (() => void)[] = [];
  let held = false;
  const jobs: {
    options: LockOptions;
    callback: any;
    resolve: (value?: any) => void;
    reject: (error: Error) => void;
    abort: () => void;
  }[] = [];
  function pump() {
    if (held || !jobs.length) return;
    const job = jobs.shift()!;
    if (job.options.signal?.aborted) {
      job.reject(new DOMException("Aborted", "AbortError"));
      pump();
      return;
    }
    job.options.signal?.removeEventListener("abort", job.abort);
    held = true;
    Promise.resolve()
      .then(() => job.callback({ name: "music-web:audio", mode: "exclusive" }))
      .then(job.resolve, job.reject)
      .finally(() => {
        held = false;
        pump();
      });
  }
  const locks = {
    request: ((_name: string, options: LockOptions, callback: any) =>
      new Promise((resolve, reject) => {
        const job = {
          options,
          callback,
          resolve,
          reject,
          abort: () => {
            const index = jobs.indexOf(job);
            if (index >= 0) {
              jobs.splice(index, 1);
              reject(new DOMException("Aborted", "AbortError"));
            }
          },
        };
        jobs.push(job);
        options.signal?.addEventListener("abort", job.abort, { once: true });
        pump();
      })) as LockManager["request"],
  };
  function channel() {
    const value = {
      onmessage: null as ((event: MessageEvent) => void) | null,
      postMessage(message: any) {
        for (const other of channels)
          if (other !== value)
            deliveries.push(() =>
              other.onmessage?.({ data: message } as MessageEvent),
            );
      },
      close() {
        value.onmessage = null;
      },
    };
    channels.push(value);
    return value;
  }
  return {
    locks,
    channel,
    flush() {
      while (deliveries.length) deliveries.shift()!();
    },
  };
}

test("另一标签页必须等原播放器停止并释放锁后才能播放", async () => {
  const h = harness();
  const audible = new Set<string>();
  const a = createPlaybackFocus(() => audible.delete("a"), {
    id: "a",
    now: () => 10,
    channel: h.channel(),
    locks: h.locks,
  });
  const b = createPlaybackFocus(() => audible.delete("b"), {
    id: "b",
    now: () => 20,
    channel: h.channel(),
    locks: h.locks,
  });
  try {
    assert.equal(await a.acquire(a.claim()), true);
    audible.add("a");
    h.flush();
    let bStarted = false;
    const pending = b.acquire(b.claim()).then((allowed) => {
      assert.equal(allowed, true);
      assert.equal(audible.size, 0);
      audible.add("b");
      bStarted = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(bStarted, false);
    assert.deepEqual([...audible], ["a"]);
    h.flush();
    await pending;
    assert.deepEqual([...audible], ["b"]);
  } finally {
    a.dispose();
    b.dispose();
  }
});
test("两个标签页同时请求播放时只保留一个，过期广播不会反向抢占", async () => {
  const h = harness();
  const lost: string[] = [];
  const a = createPlaybackFocus(() => lost.push("a"), {
    id: "a",
    now: () => 100,
    channel: h.channel(),
    locks: h.locks,
  });
  const b = createPlaybackFocus(() => lost.push("b"), {
    id: "b",
    now: () => 100,
    channel: h.channel(),
    locks: h.locks,
  });
  try {
    const ca = a.claim(),
      cb = b.claim();
    h.flush();
    const allowed = await Promise.all([a.acquire(ca), b.acquire(cb)]);
    assert.deepEqual(allowed, [false, true]);
    assert.deepEqual(lost, ["a"]);
  } finally {
    a.dispose();
    b.dispose();
  }
});
test("取消等候中的播放请求，不能在锁释放后突然启动", async () => {
  const h = harness();
  const a = createPlaybackFocus(() => {}, {
    id: "a",
    channel: h.channel(),
    locks: h.locks,
  });
  const b = createPlaybackFocus(() => {}, {
    id: "b",
    channel: h.channel(),
    locks: h.locks,
  });
  try {
    await a.acquire(a.claim());
    const pending = b.acquire(b.claim());
    b.dispose();
    assert.equal(await pending, false);
    a.release();
  } finally {
    a.dispose();
    b.dispose();
  }
});
