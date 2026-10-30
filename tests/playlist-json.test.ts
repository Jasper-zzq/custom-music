import test from "node:test";
import assert from "node:assert/strict";
import { emptyLibrary } from "../src/library";
import { mergePlaylists, parsePlaylistJson, serializePlaylists } from "../src/playlist-json";

const song = { id: "1", source: "tx", title: "歌曲", songmid: "mid-1" };
test("单歌单与收藏 JSON 可往返，保留来源与插件字段", () => {
  for (const id of ["favorites", "my-list"]) {
    const lists = [{ id, name: id === "favorites" ? "我爱听的" : "我的歌单", tracks: [song] }];
    assert.deepEqual(parsePlaylistJson(serializePlaylists(lists)), lists);
  }
});
test("旧版整库备份导入仅合并歌单，重复导入不增加歌曲或歌单", () => {
  const existing = emptyLibrary();
  existing.queue = [song];
  const incoming = emptyLibrary();
  incoming.playlists[0].tracks = [song];
  incoming.playlists.push({ id: "other", name: "新歌单", tracks: [song] });
  const snapshot = structuredClone(existing);
  const lists = parsePlaylistJson(JSON.stringify(incoming));
  const merged = mergePlaylists(existing.playlists, lists);
  assert.deepEqual(mergePlaylists(merged, lists), merged);
  assert.equal(merged[0].tracks.length, 1);
  assert.equal(merged.length, 2);
  assert.deepEqual(existing, snapshot);
});
test("无 ID 的普通歌单可导入，BOM 被忽略，同名不同 ID 不覆盖", () => {
  const [list] = parsePlaylistJson('\uFEFF' + JSON.stringify({ name: "歌单", tracks: [song, song] }));
  assert.ok(list.id);
  assert.equal(list.tracks.length, 1);
  assert.equal(mergePlaylists([{ id: "old", name: "歌单", tracks: [] }], [list]).length, 2);
});
test("损坏数据、未知版本、未知来源及重复歌单 ID 拒绝导入", () => {
  for (const value of [null, {}, { version: 2, playlists: [] },
    { name: "错误", tracks: [{ ...song, source: "unknown" }] },
    { playlists: [null] },
    { playlists: [{ id: "same", name: "a", tracks: [] }, { id: "same", name: "b", tracks: [] }] },
  ]) assert.throws(() => parsePlaylistJson(JSON.stringify(value)));
  assert.throws(() => parsePlaylistJson("{broken"), /JSON 文件无法解析/);
});
