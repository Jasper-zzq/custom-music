export const sourceDefinitions = [
  { id: "tx", name: "QQ 音乐", file: "xiaoqiu", kind: "huibq" },
  { id: "wy", name: "网易云音乐", file: "xiaoyun", kind: "huibq" },
  { id: "kw", name: "酷我音乐", file: "xiaowo", kind: "huibq" },
  { id: "kg", name: "酷狗音乐", file: "xiaogou", kind: "huibq" },
  { id: "mg", name: "咪咕音乐", file: "xiaomi", kind: "huibq" },
  {
    id: "audiomack",
    name: "Audiomack",
    file: "audiomack",
    kind: "independent",
  },
  { id: "bilibili", name: "Bilibili", file: "bilibili", kind: "independent" },
  { id: "geciwang", name: "歌词网", file: "geciwang", kind: "lyrics" },
  { id: "geciqianxun", name: "歌词千寻", file: "geciqianxun", kind: "lyrics" },
  { id: "kuaishou", name: "快手", file: "kuaishou", kind: "independent" },
  { id: "maoerfm", name: "猫耳 FM", file: "maoerfm", kind: "independent" },
  { id: "yinyuetai", name: "音悦台", file: "yinyuetai", kind: "independent" },
  { id: "youtube", name: "YouTube", file: "youtube", kind: "independent" },
] as const;
export const sourceIds: string[] = sourceDefinitions.map((p) => p.id);

// Accept legacy records without re-enabling retired providers or discarding whole libraries.
export const librarySourceIds = [...sourceIds, "navidrome", "webdav"];
