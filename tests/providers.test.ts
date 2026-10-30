import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { app } from "../server/app.js";
import { providers, catalog } from "../server/providers.js";
import { registerMedia, streamMedia } from "../server/media.js";
import {
  startOperation,
  sourceActivities,
  updateStatus,
} from "../server/provider-status.js";
import { validateLibrary, emptyLibrary } from "../src/library.js";
import { sourceIds } from "../shared/sources.js";

test("已移除待配置音源，保留十三项公开插件和两个歌词源", () => {
  assert.equal(catalog().length, 13);
  assert.equal(catalog().filter((p) => p.kind === "lyrics").length, 2);
  assert.equal(catalog().filter((p) => p.kind === "private").length, 0);
  assert.equal(providers.navidrome, undefined);
  assert.equal(providers.webdav, undefined);
  assert.ok(
    catalog()
      .find((p) => p.id === "bilibili")!
      .capabilities.includes("getMusicComments"),
  );
});
test("所有新增音源的收藏都能备份和恢复", () => {
  const input = emptyLibrary();
  input.playlists[0].tracks = sourceIds.map((source) => ({
    source,
    id: "1",
    title: "测试",
  }));
  assert.equal(validateLibrary(input).playlists[0].tracks.length, 13);
});
test("独立插件使用自身解析而非Huibq，歌词源不会伪装成可播放源", async () => {
  const original = providers.bilibili.plugin.getMediaSource;
  let calls = 0;
  providers.bilibili.plugin.getMediaSource = async (
    _item: any,
    quality: string,
  ) => {
    calls++;
    assert.equal(quality, "standard");
    return {
      url: "https://example.com/audio.mp3",
      headers: { Referer: "https://www.bilibili.com/" },
    };
  };
  try {
    const res = await app.request("http://localhost/api/play-url", {
      method: "POST",
      body: JSON.stringify({
        source: "bilibili",
        item: { id: "x" },
        quality: "320k",
      }),
    });
    assert.equal(res.status, 200);
    assert.match((await res.json()).url, /^\/api\/media\//);
    assert.equal(calls, 1);
    const lyrics = await app.request("http://localhost/api/play-url", {
      method: "POST",
      body: JSON.stringify({
        source: "geciwang",
        item: { id: "x" },
        quality: "320k",
      }),
    });
    assert.equal(lyrics.status, 502);
    assert.match((await lyrics.json()).error, /仅提供歌词/);
  } finally {
    providers.bilibili.plugin.getMediaSource = original;
  }
});
test("来源状态保留搜索和播放各自结果，旧请求不会覆盖新结果", () => {
  const old = startOperation("tx", "search");
  const latest = startOperation("tx", "search");
  latest({ state: "ok", message: "返回20条", count: 20 });
  old({ state: "error", message: "过期错误" });
  updateStatus("tx", "play", { state: "error", message: "服务503" });
  assert.equal(sourceActivities("tx").search?.state, "ok");
  assert.equal(sourceActivities("tx").play?.message, "服务503");
});
test("本地音频转发保留请求头与Range，支持拖动进度", async () => {
  const server = createServer((req, res) => {
    assert.equal(req.headers.referer, "https://example.com/");
    assert.equal(req.headers.range, "bytes=2-5");
    res.writeHead(206, {
      "Content-Type": "audio/mpeg",
      "Content-Length": "4",
      "Content-Range": "bytes 2-5/10",
      "Accept-Ranges": "bytes",
    });
    res.end("2345");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const port = (server.address() as any).port;
    const path = registerMedia("bilibili", {
      url: `http://127.0.0.1:${port}/audio`,
      headers: { Referer: "https://example.com/" },
    });
    const response = await streamMedia(path.split("/").pop()!, "bytes=2-5");
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("content-range"), "bytes 2-5/10");
    assert.equal(await response.text(), "2345");
    assert.equal((await streamMedia("missing")).status, 410);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("HLS播放列表的分片和密钥都通过本地转发，保持相对路径可用", async () => {
  const server = createServer((req, res) => {
    if (req.url === "/audio/main.m3u8") {
      res.writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl" });
      res.end(
        '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:1,\nsegment.ts\n#EXT-X-ENDLIST\n',
      );
    } else {
      res.end(req.url);
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const port = (server.address() as any).port;
    const path = registerMedia("maoerfm", {
      url: `http://127.0.0.1:${port}/audio/main.m3u8`,
    });
    const response = await streamMedia(path.split("/").pop()!);
    const text = await response.text();
    assert.match(text, /URI="\/api\/media\//);
    const segment = text
      .split("\n")
      .find((line) => line.startsWith("/api/media/"))!;
    assert.equal(
      await (await streamMedia(segment.split("/").pop()!)).text(),
      "/audio/segment.ts",
    );
    const key = text.match(/URI="([^"]+)"/)![1];
    assert.equal(
      await (await streamMedia(key.split("/").pop()!)).text(),
      "/audio/key.bin",
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("授权流媒体返回具体原因，不被误标为连接失败或可播放", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl" });
    res.end(
      '#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="uri:license",KEYFORMAT="com.apple.streamingkeydelivery"\nsegment.m4a\n',
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const path = registerMedia("maoerfm", {
      url: `http://127.0.0.1:${(server.address() as any).port}/main.m3u8`,
    });
    await assert.rejects(() => streamMedia(path.split("/").pop()!), /平台授权/);
    assert.match(sourceActivities("maoerfm").play!.message, /平台授权/);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("移除音源不会导致含历史收藏的整个歌单被丢弃", () => {
  const input = emptyLibrary();
  input.playlists[0].tracks = [
    { source: "tx", id: "1", title: "保留歌曲" },
    { source: "webdav", id: "/old.mp3", title: "历史条目" },
  ];
  assert.equal(validateLibrary(input).playlists[0].tracks.length, 2);
  assert.equal(sourceIds.includes("webdav"), false);
  assert.equal(sourceIds.includes("navidrome"), false);
});
