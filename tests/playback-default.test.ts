import test from "node:test";
import assert from "node:assert/strict";
import { nextTick } from "vue";
import { emptyLibrary } from "../src/library.js";
const data = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
  },
});
const loadStore = (id: string) =>
  import(
    `${new URL("../src/store.ts", import.meta.url).href}?continuous=${id}`
  );

test("默认列表循环，并只迁移一次旧顺序模式，后续手动选择仍保存", async () => {
  assert.equal(emptyLibrary().mode, "list");
  data.set(
    "music-web:library:v1",
    JSON.stringify({ ...emptyLibrary(), mode: "sequence" }),
  );
  const first = await loadStore("first");
  assert.equal(first.library.mode, "list");
  assert.equal(JSON.parse(data.get("music-web:library:v1")!).mode, "list");
  first.library.mode = "sequence";
  await nextTick();
  const next = await loadStore("second");
  assert.equal(next.library.mode, "sequence");
});
test("无效的原始歌单数据不会被播放模式迁移覆盖", async () => {
  data.delete("music-web:continuous-playback-default:v1");
  data.set("music-web:library:v1", "{broken");
  await loadStore("invalid");
  assert.equal(data.get("music-web:library:v1"), "{broken");
  assert.equal(data.has("music-web:continuous-playback-default:v1"), false);
});
