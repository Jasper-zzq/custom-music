import { Hono } from "hono";
import { menuLyricsState } from "./menu-lyrics-state.js";
import { streamSSE } from "hono/streaming";
import { getProviderConfig, saveProviderConfig } from "./provider-config.js";
import {
  startOperation,
  subscribeStatus,
  updateStatus,
  sourceActivities,
} from "./provider-status.js";
import { registerMedia, streamMedia } from "./media.js";
import { bodyLimit } from "hono/body-limit";
import axios from "axios";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  catalog,
  providers,
  validateCall,
  audioId,
  publicError,
  runProvider,
  requestContext,
  ensureProvider,
  configFields,
  missingConfig,
} from "./providers.js";

const settingsPath = new URL("../.local/settings.json", import.meta.url);
let settings = {
  baseUrl: process.env.MUSIC_API_URL || "https://lxmusicapi.onrender.com",
  apiKey: process.env.MUSIC_API_KEY || "share-v3",
};
try {
  settings = {
    ...settings,
    ...JSON.parse(await readFile(settingsPath, "utf8")),
  };
} catch {
  /* Fresh installation. */
}
export const app = new Hono();
app.use("/api/*", bodyLimit({ maxSize: 1024 * 1024 }));
app.use("/api/*", async (c, next) => {
  const host = new URL(c.req.url).hostname;
  if (!["127.0.0.1", "localhost", "[::1]"].includes(host))
    return c.json({ error: "仅允许本机访问" }, 403);
  const origin = c.req.header("origin");
  if (origin && origin !== new URL(c.req.url).origin)
    return c.json({ error: "不允许跨站请求" }, 403);
  c.header("Cache-Control", "no-store");
  await next();
});
app.onError((error, c) => c.json({ error: publicError(error) }, 502));
app.get("/api/menu-lyrics", (c) => c.json(menuLyricsState.read()));
app.get("/api/menu-lyrics/connection", (c) => {
  const owner = c.req.query("owner");
  if (!owner || owner.length > 100) return c.json({ error: "连接参数错误" }, 400);
  return streamSSE(c, async (stream) => {
    const disconnect = menuLyricsState.connect(owner);
    stream.onAbort(disconnect);
    try {
      await stream.writeSSE({ data: "connected" });
      while (!stream.aborted) {
        await stream.sleep(15000);
        if (!stream.aborted) await stream.writeSSE({ data: "heartbeat" });
      }
    } finally { disconnect(); }
  });
});
app.post("/api/menu-lyrics", async (c) => {
  const input = await c.req.json().catch(() => null);
  if (!menuLyricsState.update(input)) return c.json({ error: "歌词状态参数错误" }, 400);
  return c.json({ ok: true });
});
app.get("/api/providers", (c) => c.json(catalog()));
app.get("/api/providers/events", (c) =>
  streamSSE(c, async (stream) => {
    const send = () =>
      stream
        .writeSSE({ event: "providers", data: JSON.stringify(catalog()) })
        .catch(() => {});
    const unsubscribe = subscribeStatus(() => {
      void send();
    });
    stream.onAbort(unsubscribe);
    try {
      await send();
      while (!stream.aborted) {
        await stream.sleep(15000);
        if (!stream.aborted)
          await stream.writeSSE({ event: "heartbeat", data: "{}" });
      }
    } finally {
      unsubscribe();
    }
  }),
);
app.get("/api/providers/:id/config", (c) => {
  const id = c.req.param("id");
  if (!providers[id]) return c.json({ error: "未知音源" }, 404);
  const config = getProviderConfig(id);
  return c.json({
    values: Object.fromEntries(
      configFields(id).map((field: any) => [
        field.key,
        field.type === "password" ? "" : config[field.key] || "",
      ]),
    ),
    savedSecrets: configFields(id)
      .filter((field: any) => field.type === "password" && config[field.key])
      .map((field: any) => field.key),
  });
});
app.post("/api/providers/:id/config", async (c) => {
  const id = c.req.param("id");
  if (!providers[id]) return c.json({ error: "未知音源" }, 404);
  const input = await c.req.json();
  const next = { ...getProviderConfig(id) };
  for (const field of configFields(id)) {
    const value = input[field.key];
    if (typeof value !== "string" || value.length > 2000) continue;
    if (field.type === "password" && !value) continue;
    if (field.key === "url" && value) {
      try {
        const parsed = new URL(value);
        if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
      } catch {
        return c.json(
          { error: "服务器地址需要完整的 http:// 或 https:// URL" },
          400,
        );
      }
    }
    next[field.key] = field.type === "password" ? value : value.trim();
  }
  await saveProviderConfig(id, next);
  cache.clear();
  updateStatus(id, "check", {
    state: missingConfig(id).length ? "unconfigured" : "ok",
    message: missingConfig(id).length
      ? "配置未填写完整"
      : "配置已保存，尚未检测连接",
  });
  return c.json({ ok: true });
});
app.post("/api/providers/:id/check", async (c) => {
  const id = c.req.param("id");
  if (!providers[id]) return c.json({ error: "未知音源" }, 404);
  const input = await c.req.json().catch(() => ({}));
  const type = providers[id].plugin.supportedSearchType?.[0] || "music";
  try {
    const value = await runProvider(
      id,
      "search",
      [String(input.query || "music").slice(0, 100), 1, type],
      "check",
    );
    return c.json({ ok: true, count: value.data.length });
  } catch (error) {
    return c.json({ ok: false, error: publicError(error) });
  }
});
app.post("/api/playback-report", async (c) => {
  const { source, state } = await c.req.json();
  if (!providers[source] || !["playing", "error"].includes(state))
    return c.json({ error: "状态参数错误" }, 400);
  if (state === "error" && sourceActivities(source).play?.state === "error")
    return c.json({ ok: true });
  updateStatus(source, "play", {
    state: state === "playing" ? "ok" : "error",
    message:
      state === "playing"
        ? "浏览器已开始播放"
        : "浏览器无法加载音频，请重新播放或切换来源",
  });
  return c.json({ ok: true });
});
app.get("/api/media/:token", (c) =>
  streamMedia(c.req.param("token"), c.req.header("range"), c.req.raw.signal),
);

app.get("/api/settings", (c) =>
  c.json({ baseUrl: settings.baseUrl, hasApiKey: Boolean(settings.apiKey) }),
);
app.post("/api/settings", async (c) => {
  const input = await c.req.json();
  let url: URL;
  try {
    url = new URL(input.baseUrl);
  } catch {
    return c.json({ error: "请输入有效的服务地址" }, 400);
  }
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    return c.json(
      { error: "服务地址仅支持 HTTP/HTTPS，不包含账号、查询参数或片段" },
      400,
    );
  const next = {
    baseUrl: url.href.replace(/\/$/, ""),
    apiKey:
      typeof input.apiKey === "string" && input.apiKey
        ? input.apiKey
        : settings.apiKey,
  };
  await mkdir(new URL("../.local/", import.meta.url), { recursive: true });
  await writeFile(settingsPath, JSON.stringify(next), { mode: 0o600 });
  settings = next;
  return c.json({ ok: true });
});
app.post("/api/status", async (c) => {
  try {
    const result = await axios.get(settings.baseUrl, {
      timeout: 12000,
      validateStatus: () => true,
    });
    return c.json({
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      message:
        result.status === 503
          ? "默认解析服务已暂停（503），在线歌曲无法取得播放地址。"
          : `服务返回 HTTP ${result.status}；歌曲可用性以实际播放为准。`,
    });
  } catch (error) {
    return c.json({ ok: false, message: publicError(error) });
  }
});
// Only explicit plugin exports are callable. Never execute user-supplied plugins.
const cache = new Map<string, { expires: number; value: unknown }>();
app.post("/api/call", async (c) => {
  const { source, method, args } = await c.req.json();
  let plugin;
  try {
    plugin = validateCall(source, method, args);
  } catch (error) {
    return c.json({ error: publicError(error) }, 400);
  }
  const key = JSON.stringify([source, method, args]);
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) {
    const result = hit.value as any;
    const count = Array.isArray(result?.data) ? result.data.length : undefined;
    updateStatus(
      source,
      method === "search"
        ? "search"
        : method === "getLyric"
          ? "lyric"
          : "browse",
      {
        state: "ok",
        message:
          count !== undefined ? `返回 ${count} 条（缓存）` : "请求成功（缓存）",
        count,
      },
    );
    return c.json({ data: hit.value });
  }
  const value = await runProvider(source, method, args);
  if (value == null)
    return c.json({ error: "音源未返回数据，请确认链接或切换音源" }, 502);
  if (cache.size >= 100) cache.delete(cache.keys().next().value!);
  cache.set(key, { value, expires: Date.now() + 60000 });
  return c.json({ data: value });
});
app.post("/api/play-url", async (c) => {
  const { source, item, quality } = await c.req.json();
  if (!providers[source] || !item || !["128k", "320k"].includes(quality))
    return c.json({ error: "播放参数错误" }, 400);
  const finish = startOperation(source, "play");
  try {
    const provider = ensureProvider(source);
    if (typeof provider.plugin.getMediaSource !== "function")
      throw new Error("此音源仅提供歌词，不提供音频");
    let result: any;
    if (provider.kind === "huibq") {
      const id = audioId(source, item);
      const response = await axios.get(
        `${settings.baseUrl}/url/${source}/${encodeURIComponent(id)}/${quality}`,
        { headers: { "X-Request-Key": settings.apiKey }, timeout: 15000 },
      );
      const body = response.data;
      const messages: Record<number, string> = {
        1: "当前 IP 被音源限制，请停止重试",
        2: "无法获取该歌曲地址，请切换歌曲或音源",
        4: "解析服务内部错误",
        5: "请求过于频繁，请稍后再试",
        6: "音源不接受该歌曲或音质参数",
      };
      if (body.code != null && Number(body.code) !== 0)
        throw new Error(messages[body.code] || "解析服务返回错误");
      result = body;
    } else {
      const pluginQuality =
        source === "audiomack" || source === "yinyuetai"
          ? "standard"
          : quality === "128k"
            ? "low"
            : "standard";
      result = await requestContext.run(AbortSignal.timeout(20000), () =>
        provider.plugin.getMediaSource(item, pluginQuality),
      );
    }
    if (!result?.url)
      throw new Error("插件未返回播放地址，接口可能已失效或该资源不可播放");
    const parsed = new URL(result.url);
    if (!["http:", "https:"].includes(parsed.protocol))
      throw new Error("不支持的音频地址");
    // Proxy independent media to honor plugin headers, credentials and byte ranges.
    const url =
      provider.kind === "huibq" ? parsed.href : registerMedia(source, result);
    finish({ state: "ok", message: "已取得地址，等待浏览器播放" });
    return c.json({
      url,
      source,
      service: provider.kind === "huibq" ? "Huibq 解析服务" : provider.name,
      format: /\.m3u8(?:$|\?)/i.test(parsed.href) ? "hls" : "audio",
    });
  } catch (error) {
    finish({
      state: missingConfig(source).length ? "unconfigured" : "error",
      message: publicError(error),
    });
    return c.json({ error: publicError(error) }, 502);
  }
});
app.all("/api/*", (c) => c.json({ error: "接口不存在" }, 404));
