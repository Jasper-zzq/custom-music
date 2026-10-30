import test from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import {
  emptyLibrary,
  validateLibrary,
  uniqueTracks,
  trackKey,
  nextIndex,
} from "../src/library.js";
import { catalog, audioId } from "../server/providers.js";
import { app } from "../server/app.js";
const song = { id: "1", source: "tx", songmid: "mid-1", title: "Test" };
test("收藏按音源和稳定歌曲标识去重，不合并不同平台", () => {
  assert.equal(
    uniqueTracks([
      song,
      { ...song, title: "Updated" },
      { ...song, source: "wy" },
    ]).length,
    2,
  );
  assert.equal(trackKey(song), "tx:mid-1");
});
test("备份恢复保持默认歌单，拒绝损坏数据和重复歌单", () => {
  const library = emptyLibrary();
  library.playlists = [{ id: "x", name: "歌单", tracks: [song, song] }];
  const result = validateLibrary(library);
  assert.equal(result.playlists[0].id, "favorites");
  assert.equal(result.playlists[1].tracks.length, 1);
  assert.throws(() =>
    validateLibrary({
      version: 1,
      playlists: [{ id: "x", name: "x", tracks: [{}] }],
    }),
  );
  assert.throws(() =>
    validateLibrary({
      ...library,
      playlists: [library.playlists[0], library.playlists[0]],
    }),
  );
});
test("顺序结束、列表循环、单曲循环和随机播放的边界", () => {
  assert.equal(nextIndex(2, 3, "sequence", true), -1);
  assert.equal(nextIndex(2, 3, "list", true), 0);
  assert.equal(nextIndex(1, 3, "single", true), 1);
  assert.equal(nextIndex(1, 3, "single", false), 2);
  assert.equal(
    nextIndex(1, 3, "random", true, () => 0.9),
    2,
  );
  assert.equal(nextIndex(0, 0, "list", true), -1);
});
test("十三个插件能力和音频 ID 与仓库列表一致", () => {
  assert.equal(catalog().length, 13);
  assert.equal(catalog().filter((p) => p.loadError).length, 0);
  assert.equal(catalog().find((p) => p.id === "geciwang")?.playable, false);
  assert.equal(
    catalog().find((p) => p.id === "bilibili")?.playbackService,
    "插件独立解析",
  );
  assert.equal(
    catalog()
      .find((p) => p.id === "kg")!
      .capabilities.includes("getArtistWorks"),
    false,
  );
  assert.equal(audioId("tx", song), "mid-1");
  assert.equal(audioId("wy", song), "1");
  assert.throws(() => audioId("tx", { id: "1" }));
});
test("本地 API 拒绝跨站调用、无效音源及任意方法", async () => {
  let response = await app.request("http://localhost/api/providers", {
    headers: { origin: "https://example.com" },
  });
  assert.equal(response.status, 403);
  response = await app.request("http://localhost/api/call", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: "tx", method: "constructor", args: [] }),
  });
  assert.equal(response.status, 400);
  response = await app.request("http://localhost/api/play-url", {
    method: "POST",
    body: JSON.stringify({ source: "invalid", item: song, quality: "320k" }),
  });
  assert.equal(response.status, 400);
});
test("播放接口构造正确地址、转发密钥并拒绝非音频协议与上游限流", async () => {
  const original = axios.defaults.adapter;
  try {
    let answer: any = { code: 0, url: "https://example.com/audio.mp3" };
    axios.defaults.adapter = async (config) => {
      assert.ok(config.url?.endsWith("/url/tx/mid-1/320k"));
      assert.ok(config.headers["X-Request-Key"]);
      return {
        data: answer,
        status: 200,
        statusText: "OK",
        headers: {},
        config,
      };
    };
    const send = () =>
      app.request("http://localhost/api/play-url", {
        method: "POST",
        body: JSON.stringify({ source: "tx", item: song, quality: "320k" }),
      });
    assert.equal((await send()).status, 200);
    answer = { code: 5 };
    let response = await send();
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /频繁/);
    answer = { code: 0, url: "javascript:alert(1)" };
    assert.equal((await send()).status, 502);
  } finally {
    axios.defaults.adapter = original;
  }
});
