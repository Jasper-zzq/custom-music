import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import axios from "axios";
import { updateStatus } from "./provider-status.js";
const media = new Map<
  string,
  {
    url: string;
    headers: Record<string, string>;
    source: string;
    expires: number;
  }
>();
export function registerMedia(source: string, result: any) {
  const url = new URL(result?.url);
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("不支持的音频地址");
  const headers: Record<string, string> = { "Accept-Encoding": "identity" };
  for (const [key, value] of Object.entries(result.headers || {})) {
    if (
      [
        "referer",
        "origin",
        "user-agent",
        "authorization",
        "cookie",
        "accept",
      ].includes(key.toLowerCase()) &&
      typeof value === "string"
    )
      headers[key] = value;
  }
  if (url.username || url.password) {
    headers.Authorization = `Basic ${Buffer.from(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`).toString("base64")}`;
    url.username = "";
    url.password = "";
  }
  for (const [key, item] of media)
    if (item.expires < Date.now()) media.delete(key);
  if (media.size >= 4096) media.delete(media.keys().next().value!);
  const token = randomUUID();
  media.set(token, {
    url: url.href,
    headers,
    source,
    expires: Date.now() + 3600000,
  });
  return `/api/media/${token}`;
}
export async function streamMedia(
  token: string,
  range?: string,
  signal?: AbortSignal,
) {
  const item = media.get(token);
  if (!item || item.expires < Date.now())
    return new Response("播放地址已过期，请重新播放", { status: 410 });
  try {
    const upstream = await axios.get(item.url, {
      responseType: "stream",
      signal,
      timeout: 15000,
      decompress: false,
      maxContentLength: Infinity,
      headers: { ...item.headers, ...(range ? { Range: range } : {}) },
      validateStatus: () => true,
    });
    const contentType = String(upstream.headers["content-type"] || "");
    if (
      upstream.status === 200 &&
      (/mpegurl/i.test(contentType) || /\.m3u8(?:$|\?)/i.test(item.url))
    ) {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of upstream.data) {
        size += chunk.length;
        if (size > 1024 * 1024) {
          upstream.data.destroy();
          throw new Error("播放列表过大");
        }
        chunks.push(Buffer.from(chunk));
      }
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw.trimStart().startsWith("#EXTM3U"))
        throw new Error("无效的HLS播放列表");
      if (
        /#EXT-X-KEY:[^\n]*KEYFORMAT="(?:com\.apple\.streamingkeydelivery|urn:uuid:)/i.test(
          raw,
        )
      ) {
        throw new Error(
          "该资源需要平台授权，原插件未提供授权播放信息，请选择其他资源或音质",
        );
      }
      const baseUrl = upstream.request?.res?.responseUrl || item.url;
      const relay = (uri: string) =>
        uri.startsWith("data:")
          ? uri
          : registerMedia(item.source, {
              url: new URL(uri, baseUrl).href,
              headers: item.headers,
            });
      const manifest = raw
        .split(/\r?\n/)
        .map((line) => {
          if (!line.trim()) return line;
          if (line.startsWith("#"))
            return line.replace(
              /URI="([^"]+)"/g,
              (_match, uri) => `URI="${relay(uri)}"`,
            );
          return relay(line.trim());
        })
        .join("\n");
      return new Response(manifest, {
        headers: {
          "Content-Type": "application/vnd.apple.mpegurl",
          "Cache-Control": "no-store",
        },
      });
    }
    const headers = new Headers({ "Cache-Control": "no-store" });
    for (const key of [
      "content-type",
      "content-length",
      "content-range",
      "accept-ranges",
      "content-encoding",
    ])
      if (upstream.headers[key])
        headers.set(key, String(upstream.headers[key]));
    if (upstream.status >= 400)
      updateStatus(item.source, "play", {
        state: "error",
        message: `音频服务返回 HTTP ${upstream.status}`,
      });
    return new Response(Readable.toWeb(upstream.data) as ReadableStream, {
      status: upstream.status,
      headers,
    });
  } catch (error) {
    if (!signal?.aborted)
      updateStatus(item.source, "play", {
        state: "error",
        message:
          error instanceof Error && /平台授权|播放列表/.test(error.message)
            ? error.message
            : "音频连接失败，请重新播放或切换来源",
      });
    throw error;
  }
}
