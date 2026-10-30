import test from "node:test";
import assert from "node:assert/strict";
import { createMenuLyricsState } from "../server/menu-lyrics-state.js";
import { app } from "../server/app.js";

test("歌词归属随播放交接，旧标签页关闭和乱序请求不覆盖新歌词", () => {
  let now = 1000;
  const relay = createMenuLyricsState(() => now);
  const packet = (owner: string, revision: number, playing: boolean, line: string) => ({
    owner, revision, sentAt: now, playing, title: "歌曲", artist: "歌手", line,
  });
  relay.update(packet("a", 1, true, "A"));
  now++;
  relay.update(packet("b", 1, true, "B"));
  relay.update(packet("a", 2, false, ""));
  assert.equal(relay.read().line, "B");
  relay.update(packet("b", 3, false, "暂停"));
  relay.update(packet("b", 2, true, "迟到"));
  assert.equal(relay.read().line, "暂停");
  assert.equal(relay.read().playing, false);
  relay.update({ ...packet("a", 3, true, "旧播放"), sentAt: 1000 });
  assert.equal(relay.read().line, "暂停");
});

test("原生端订阅得到快照，心跳不重复绘制，崩溃页面过期清空", () => {
  let now = 1000;
  const relay = createMenuLyricsState(() => now);
  const values: string[] = [];
  const unsubscribe = relay.subscribe((state) => values.push(state.line));
  const packet = { owner: "a", revision: 1, sentAt: now, playing: true, title: "歌曲", artist: "", line: "歌词" };
  assert.equal(relay.update(packet), true);
  relay.update({ ...packet, revision: 2 });
  assert.deepEqual(values, ["", "歌词"]);
  now += 90001;
  relay.expire();
  assert.equal(relay.read().title, "");
  assert.deepEqual(values, ["", "歌词", ""]);
  unsubscribe();
  assert.equal(relay.update({ ...packet, sentAt: now, revision: 3 }), true);
  assert.equal(values.length, 3);
});

test("浏览器断连立即清空，迟到请求和旧连接关闭不能干扰重连", () => {
  const relay = createMenuLyricsState(() => 1000);
  const packet = { owner: "a", revision: 1, sentAt: 1000, playing: true, title: "歌曲", artist: "", line: "歌词" };
  const disconnectOld = relay.connect("a");
  relay.update(packet);
  const disconnectNew = relay.connect("a");
  disconnectOld();
  assert.equal(relay.read().line, "歌词");
  disconnectNew();
  assert.equal(relay.read().title, "");
  relay.update({ ...packet, revision: 2 });
  assert.equal(relay.read().title, "");
  relay.connect("a");
  relay.update({ ...packet, revision: 3 });
  assert.equal(relay.read().line, "歌词");
  relay.connect("b");
  relay.update({ ...packet, owner: "b", sentAt: 1001 });
  disconnectNew();
  assert.equal(relay.read().title, "歌曲");
});

test("菜单栏接口拒绝跨站及畸形状态，接受本机歌词", async () => {
  const url = "http://localhost/api/menu-lyrics";
  const packet = { owner: "test", revision: 1, sentAt: Date.now(), title: "歌名", artist: "歌手", line: "当前行", playing: true };
  const post = (body: unknown, origin = "http://localhost") => app.request(url, {
    method: "POST", headers: { "Content-Type": "application/json", origin }, body: JSON.stringify(body),
  });
  assert.equal((await post(packet, "https://example.com")).status, 403);
  assert.equal((await post({ ...packet, line: 42 })).status, 400);
  assert.equal((await post({ ...packet, revision: -1 })).status, 400);
  assert.equal((await post(packet)).status, 200);
  assert.equal((await (await app.request(url)).json()).line, "当前行");
});
