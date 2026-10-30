import { createRequire } from "node:module";
import axios from "axios";
import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";
import { sourceDefinitions } from "../shared/sources.js";
import { getProviderConfig } from "./provider-config.js";
import {
  sourceActivities,
  startOperation,
  type Operation,
} from "./provider-status.js";

const require = createRequire(import.meta.url);
export const requestContext = new AsyncLocalStorage<AbortSignal>();
axios.defaults.timeout = 12000;
axios.defaults.maxContentLength = 8 * 1024 * 1024;
axios.interceptors.request.use((config) => {
  const signal = requestContext.getStore();
  if (signal) config.signal = signal;
  return config;
});
// Plugins are fixed upstream snapshots, loaded with a per-plugin MusicFree env.
// The injected console deliberately omits upstream credential/debug logging.
export const providers: Record<
  string,
  {
    id: string;
    name: string;
    file: string;
    kind: string;
    plugin: any;
    loadError?: string;
  }
> = Object.fromEntries(
  sourceDefinitions.map((definition) => {
    try {
      const module = { exports: {} as any };
      const code = readFileSync(
        new URL(`../vendor/${definition.file}.cjs`, import.meta.url),
        "utf8",
      );
      const execute = new Function(
        "require",
        "module",
        "exports",
        "env",
        "console",
        code,
      );
      execute(
        require,
        module,
        module.exports,
        { getUserVariables: () => getProviderConfig(definition.id) },
        { log() {}, error() {}, warn() {}, debug() {} },
      );
      return [definition.id, { ...definition, plugin: module.exports }];
    } catch (error) {
      return [
        definition.id,
        {
          ...definition,
          plugin: {},
          loadError: error instanceof Error ? error.message : "插件加载失败",
        },
      ];
    }
  }),
);
export const allowedMethods = new Set([
  "search",
  "getMusicInfo",
  "getAlbumInfo",
  "getLyric",
  "getArtistWorks",
  "importMusicSheet",
  "getTopLists",
  "getTopListDetail",
  "getRecommendSheetTags",
  "getMusicSheetInfo",
  "getRecommendSheetsByTag",
  "getMusicComments",
]);
export function configFields(id: string) {
  return (providers[id]?.plugin.userVariables || []).map((field: any) => ({
    key: field.key,
    name: field.name,
    type:
      field.type === "password" || /password|token|secret/i.test(field.key)
        ? "password"
        : "text",
    required: ["url", "username", "password"].includes(field.key),
  }));
}
export function missingConfig(id: string): string[] {
  const config = getProviderConfig(id);
  return configFields(id)
    .filter((field: any) => field.required && !config[field.key])
    .map((field: any) => field.name);
}
export function catalog() {
  return Object.values(providers).map(
    ({ id, name, kind, plugin, loadError }) => ({
      id,
      name,
      kind,
      version: plugin.version || "未知",
      pluginName: plugin.platform || name,
      author: plugin.author || (kind === "huibq" ? "Huibq" : "猫头猫"),
      pluginUrl: plugin.srcUrl || "",
      searchTypes: plugin.supportedSearchType || [],
      capabilities: [...allowedMethods].filter(
        (method) => typeof plugin[method] === "function",
      ),
      playable: typeof plugin.getMediaSource === "function",
      configured: missingConfig(id).length === 0,
      missingConfig: missingConfig(id),
      loadError,
      configFields: configFields(id),
      activities: sourceActivities(id),
      playbackService:
        kind === "huibq"
          ? "Huibq 解析服务"
          : kind === "lyrics"
            ? "仅提供歌词"
            : kind === "private"
              ? "个人媒体库"
              : "插件独立解析",
      hints: plugin.hints?.importMusicSheet ?? [],
    }),
  );
}
export function ensureProvider(id: string) {
  const provider = providers[id];
  if (!provider) throw new Error("未知音源");
  if (provider.loadError) throw new Error("插件未能加载，请检查本地依赖");
  const missing = missingConfig(id);
  if (missing.length)
    throw new Error(`请先在音源管理配置：${missing.join("、")}`);
  return provider;
}
export async function runProvider(
  source: string,
  method: string,
  args: any[],
  operation?: Operation,
) {
  const lane =
    operation ||
    (method === "search"
      ? "search"
      : method === "getLyric"
        ? "lyric"
        : method === "getMediaSource"
          ? "play"
          : "browse");
  const finish = startOperation(source, lane);
  try {
    const { plugin } = ensureProvider(source);
    if (typeof plugin[method] !== "function")
      throw new Error("此插件不支持该功能");
    const value = await requestContext.run(AbortSignal.timeout(25000), () =>
      plugin[method](...args),
    );
    if (value == null) throw new Error("插件未返回数据");
    if (method === "search" && !Array.isArray(value.data))
      throw new Error("搜索接口未返回有效列表");
    const count = Array.isArray(value.data)
      ? value.data.length
      : Array.isArray(value.musicList)
        ? value.musicList.length
        : undefined;
    finish({
      state: "ok",
      message:
        method === "getMediaSource"
          ? "已取得地址，等待播放"
          : count !== undefined
            ? `返回 ${count} 条`
            : "请求成功",
      count,
    });
    return value;
  } catch (error) {
    finish({
      state: missingConfig(source).length ? "unconfigured" : "error",
      message: publicError(error),
    });
    throw error;
  }
}
export function validateCall(source: string, method: string, args: unknown[]) {
  const provider = providers[source];
  if (
    !provider ||
    !allowedMethods.has(method) ||
    typeof provider.plugin[method] !== "function"
  )
    throw new Error("此音源不支持该功能");
  if (!Array.isArray(args) || args.length > 3) throw new Error("请求参数错误");
  if (
    method === "search" &&
    (typeof args[0] !== "string" ||
      !args[0].trim() ||
      args[0].length > 200 ||
      !Number.isInteger(args[1]) ||
      Number(args[1]) < 1 ||
      !provider.plugin.supportedSearchType.includes(args[2]))
  )
    throw new Error("搜索参数错误");
  return provider.plugin;
}
export function audioId(source: string, item: Record<string, unknown>) {
  const id = source === "tx" ? item.songmid : item.id;
  if (typeof id !== "string" && typeof id !== "number")
    throw new Error("歌曲缺少音源标识，请重新搜索");
  return String(id);
}
export function publicError(error: unknown) {
  if (axios.isAxiosError(error)) {
    if (error.code === "ECONNABORTED" || error.code === "ERR_CANCELED")
      return "音源请求超时，请稍后手动重试";
    if (error.response?.status === 503) return "上游服务暂不可用（503）";
    if (error.response?.status === 429) return "请求过于频繁，请稍后再试";
    return error.response
      ? `上游接口返回 HTTP ${error.response.status}，请切换音源或稍后重试`
      : "无法连接音源，请检查网络后重试";
  }
  if (error instanceof TypeError || error instanceof SyntaxError)
    return "音源返回的数据不兼容，接口可能已变更，请切换音源";
  return error instanceof Error
    ? error.message.slice(0, 240)
    : "请求失败，请稍后重试";
}
