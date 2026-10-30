<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import {
  Search,
  Heart,
  ListMusic,
  Disc3,
  Radio,
  Settings,
  Plus,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  Repeat,
  Repeat1,
  Shuffle,
  ListOrdered,
  X,
  Upload,
  Download,
  FolderPlus,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Music2,
  AlertCircle,
  ArrowDownToLine,
  Trash2,
  Pencil,
  Headphones,
  RefreshCw,
  Check,
  Menu,
  MoreHorizontal,
  ExternalLink,
  FileText,
  Server,
} from "lucide-vue-next";
import type { Provider, Track } from "./types";
import { sourceIds, sourceDefinitions } from "../shared/sources";
import LyricTools from "./LyricTools.vue";
import { api, call } from "./api";
import { searchBatch, type SearchTask } from "./parallel-search";
import {
  library,
  notify,
  notification,
  liked,
  toggleLike,
  addTracks,
} from "./store";
import { trackKey, validateLibrary, uniqueTracks } from "./library";
import { parsePlaylistJson, serializePlaylists, mergePlaylists } from "./playlist-json";
import { storeAudio } from "./local-audio";
import {
  current,
  playing,
  loading,
  time,
  duration,
  playbackError,
  playTrack,
  togglePlay,
  next,
  previous,
  seek,
  queueNext,
  stop,
  lyric,
  lyricLoading,
  lyricError,
  lyricLines,
  activeLyric,
  fetchLyric,
  applyMatchedLyric,
  seekLyric,
  formatTime,
} from "./player";

const providers = ref<Provider[]>([]);
const activeProviders = (items: Provider[]) =>
  items.filter((p) => sourceIds.includes(p.id));
const source = ref("tx");
const provider = computed(() =>
  providers.value.find((p) => p.id === source.value),
);
const page = ref("search");
const activePlaylistId = ref("favorites");
const activePlaylist = computed(() =>
  library.playlists.find((p) => p.id === activePlaylistId.value),
);
const keyword = ref("");
const searchType = ref("music");
const parallelSearch = ref(false);
const selectedSources = ref([...sourceIds]);
try {
  const preference = JSON.parse(
    localStorage.getItem("music-web:search-preferences") || "null",
  );
  if (preference) {
    parallelSearch.value = preference.parallel === true;
    if (Array.isArray(preference.sources)) {
      const ids = [
        ...new Set(
          preference.sources.filter(
            (id: unknown) => typeof id === "string" && sourceIds.includes(id),
          ),
        ),
      ] as string[];
      const known = Array.isArray(preference.knownSources)
        ? preference.knownSources
        : ["tx", "wy", "kw", "kg", "mg"];
      selectedSources.value = [
        ...new Set([...ids, ...sourceIds.filter((id) => !known.includes(id))]),
      ];
    }
  }
} catch {
  /* Invalid preferences use defaults. */
}
function selectSearchSources(mode: "all" | "clear" | "ready") {
  selectedSources.value =
    mode === "clear"
      ? []
      : providers.value
          .filter(
            (p) =>
              !p.loadError &&
              (mode !== "ready" ||
                (p.configured && p.searchTypes.includes(searchType.value))),
          )
          .map((p) => p.id);
  saveSearchPreferences();
  if (!selectedSources.value.length) {
    if (page.value === "search") navigate("search");
    return;
  }
  if (!availableSearchTypes.value.includes(searchType.value))
    searchType.value = availableSearchTypes.value[0] || "music";
  if (page.value === "search" && keyword.value.trim()) search();
}
const eventsConnected = ref(false);
let providerEvents: EventSource | null = null;
const providerConfigId = ref("");
const providerConfigValues = ref<Record<string, string>>({});
const savedSecrets = ref<string[]>([]);
const configSaving = ref(false);
const configError = ref("");
const checkingSources = ref<string[]>([]);
const operationNames: Record<string, string> = {
  search: "搜索",
  play: "播放",
  lyric: "歌词",
  check: "检测",
  browse: "浏览",
};
const currentProvider = computed(() =>
  providers.value.find((p) => p.id === current.value?.source),
);
function latestActivity(p: Provider) {
  return Object.values(p.activities || {}).sort(
    (a, b) => b!.updatedAt - a!.updatedAt,
  )[0];
}
function sourceStateText(p: Provider) {
  if (p.loadError) return "加载失败";
  if (!p.configured) return "待配置";
  const activity = latestActivity(p);
  if (activity?.message.includes("尚未检测")) return "未检测";
  return activity
    ? activity.state === "loading"
      ? "请求中"
      : activity.state === "error"
        ? "请求失败"
        : "已响应"
    : "未检测";
}
async function checkProvider(p: Provider) {
  if (checkingSources.value.includes(p.id)) return;
  checkingSources.value.push(p.id);
  try {
    await api(`providers/${p.id}/check`, {
      query: keyword.value.trim() || "music",
    });
  } catch (error) {
    notify((error as Error).message);
  } finally {
    checkingSources.value = checkingSources.value.filter((id) => id !== p.id);
    if (!eventsConnected.value)
      providers.value = activeProviders(await api("providers"));
  }
}
async function checkAllProviders() {
  await Promise.allSettled(providers.value.map((p) => checkProvider(p)));
}
async function openProviderConfig(p: Provider) {
  if (providerConfigId.value === p.id) {
    providerConfigId.value = "";
    return;
  }
  providerConfigId.value = p.id;
  configError.value = "";
  providerConfigValues.value = {};
  savedSecrets.value = [];
  try {
    const data = await api(`providers/${p.id}/config`);
    providerConfigValues.value = data.values;
    savedSecrets.value = data.savedSecrets;
  } catch (error) {
    configError.value = (error as Error).message;
  }
}
async function saveSourceConfig() {
  configSaving.value = true;
  configError.value = "";
  try {
    await api(
      `providers/${providerConfigId.value}/config`,
      providerConfigValues.value,
    );
    providers.value = activeProviders(await api("providers"));
    notify("音源配置已保存");
    providerConfigId.value = "";
  } catch (error) {
    configError.value = (error as Error).message;
  } finally {
    configSaving.value = false;
  }
}
const lyricPreview = ref<Track | null>(null);
const previewText = ref("");
const previewError = ref("");
const previewLoading = ref(false);
const previewGeneration = ref(0);
const playable = (track: Track) =>
  track.source === "local" ||
  Boolean(providers.value.find((p) => p.id === track.source)?.playable);
const playableVisibleTracks = computed(() =>
  visibleTracks.value.filter(playable),
);
async function activateTrack(track: Track, queue?: Track[]) {
  if (playable(track)) {
    await playTrack(track, queue?.filter(playable));
    return;
  }
  const ticket = ++previewGeneration.value;
  lyricPreview.value = track;
  previewText.value = "";
  previewError.value = "";
  previewLoading.value = true;
  navigate("lyric-preview");
  try {
    const result = await call(track.source, "getLyric", [track]);
    if (ticket === previewGeneration.value)
      previewText.value = (result.rawLrc || "暂无歌词").replace(
        /([^\n])(?=\[\d+:\d+)/g,
        "$1\n",
      );
  } catch (error) {
    if (ticket === previewGeneration.value)
      previewError.value = (error as Error).message;
  } finally {
    if (ticket === previewGeneration.value) previewLoading.value = false;
  }
}
function applyPreviewLyric() {
  if (!lyricPreview.value) return;
  applyMatchedLyric(
    previewText.value,
    lyricPreview.value.source,
    lyricPreview.value.title,
  );
  navigate("now-playing");
}
const parallelActive = ref(false);
const searchRun = ref({ query: "", type: "music" });
const searchStates = ref<
  {
    source: string;
    page: number;
    count: number;
    isEnd: boolean;
    loading: boolean;
    error: string;
  }[]
>([]);
const parallelErrors = computed(() =>
  searchStates.value.filter(
    (state) =>
      state.error &&
      (!resultSourceFilter.value || state.source === resultSourceFilter.value),
  ),
);
const availableSearchTypes = computed(() =>
  parallelSearch.value
    ? Object.keys(searchNames).filter((type) =>
        providers.value.some(
          (p) =>
            selectedSources.value.includes(p.id) &&
            p.searchTypes.includes(type),
        ),
      )
    : provider.value?.searchTypes || [],
);
const lyricViewport = ref<HTMLElement>();
const coverBackground = computed(() =>
  current.value && artwork(current.value)
    ? { backgroundImage: `url(${JSON.stringify(artwork(current.value))})` }
    : {},
);
function saveSearchPreferences() {
  try {
    localStorage.setItem(
      "music-web:search-preferences",
      JSON.stringify({
        parallel: parallelSearch.value,
        sources: selectedSources.value,
        knownSources: sourceIds,
      }),
    );
  } catch {
    notify("搜索偏好未能保存");
  }
}
function changeSearchMode() {
  parallelSearch.value = !parallelSearch.value;
  saveSearchPreferences();
  if (!availableSearchTypes.value.includes(searchType.value))
    searchType.value = availableSearchTypes.value[0] || "music";
  if (keyword.value.trim()) search();
  else navigate("search");
}
let sourceSelectionTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleSourceSearch() {
  clearTimeout(sourceSelectionTimer);
  if (page.value === "search" && keyword.value.trim())
    sourceSelectionTimer = setTimeout(search, 350);
}
function changeSearchSource(id: string) {
  if (selectedSources.value.includes(id)) {
    selectedSources.value = selectedSources.value.filter(
      (source) => source !== id,
    );
  } else selectedSources.value.push(id);
  saveSearchPreferences();
  if (!availableSearchTypes.value.includes(searchType.value))
    searchType.value = availableSearchTypes.value[0] || "music";
  scheduleSourceSearch();
}
async function parallelBatch(tasks: SearchTask[], ticket: number) {
  busy.value = true;
  for (const task of tasks) {
    const state = searchStates.value.find((s) => s.source === task.source)!;
    state.loading = true;
    state.error = "";
  }
  await searchBatch(
    tasks,
    searchRun.value.query,
    searchRun.value.type,
    call,
    (outcome) => {
      if (ticket !== browseGeneration) return;
      const state = searchStates.value.find(
        (s) => s.source === outcome.source,
      )!;
      state.loading = false;
      state.error = outcome.error;
      if (!outcome.error) {
        state.page = outcome.page;
        state.count += outcome.items.length;
        state.isEnd = outcome.isEnd;
        results.value = uniqueTracks([
          ...results.value,
          ...normalize(outcome.items, outcome.source),
        ]);
      }
      isEnd.value = searchStates.value.every(
        (s) => s.isEnd || Boolean(s.error),
      );
    },
  );
  if (ticket === browseGeneration)
    busy.value = searchStates.value.some((s) => s.loading);
}
function parallelStart() {
  const ticket = ++browseGeneration;
  resultSourceFilter.value = null;
  const sources = providers.value.filter(
    (p) =>
      selectedSources.value.includes(p.id) &&
      p.searchTypes.includes(searchType.value),
  );
  parallelActive.value = true;
  request.value = null;
  error.value = "";
  results.value = [];
  resultTitle.value = `“${keyword.value.trim()}”`;
  resultType.value = searchType.value;
  searchRun.value = { query: keyword.value.trim(), type: searchType.value };
  searchStates.value = sources.map((p) => ({
    source: p.id,
    page: 0,
    count: 0,
    isEnd: false,
    loading: true,
    error: "",
  }));
  if (!sources.length) {
    busy.value = false;
    error.value = selectedSources.value.length
      ? "所选音源不支持此搜索类型"
      : "请勾选至少一个音源";
    return;
  }
  void parallelBatch(
    sources.map((p) => ({ source: p.id, page: 1 })),
    ticket,
  );
}
function retrySource(id: string) {
  const state = searchStates.value.find((s) => s.source === id);
  if (state && !state.loading)
    void parallelBatch(
      [{ source: id, page: state.page + 1 }],
      browseGeneration,
    );
}

const searchNames: Record<string, string> = {
  music: "歌曲",
  album: "专辑",
  sheet: "歌单",
  artist: "歌手",
  lyric: "歌词",
};
const results = ref<any[]>([]);
const resultSourceFilter = ref<string | null>(null);
const displayedResults = computed(() =>
  parallelActive.value && resultSourceFilter.value
    ? results.value.filter((item) => item.source === resultSourceFilter.value)
    : results.value,
);
const sourceResultCounts = computed(() => {
  const counts: Record<string, number> = {};
  for (const item of results.value)
    counts[item.source] = (counts[item.source] || 0) + 1;
  return counts;
});
const displayedResultsLoading = computed(() =>
  parallelActive.value && resultSourceFilter.value
    ? Boolean(
        searchStates.value.find((state) => state.source === resultSourceFilter.value)?.loading,
      )
    : busy.value,
);
const hasMoreResults = computed(() => {
  if (parallelActive.value && resultSourceFilter.value) {
    const state = searchStates.value.find(
      (item) => item.source === resultSourceFilter.value,
    );
    return Boolean(state && !state.isEnd && !state.error);
  }
  return !isEnd.value;
});
const resultType = ref("music");
const resultTitle = ref("搜索音乐");
const busy = ref(false);
const error = ref("");
const pageNo = ref(1);
const isEnd = ref(true);
const request = ref<{
  source: string;
  method: string;
  args: any[];
  type: string;
  title: string;
} | null>(null);
let browseGeneration = 0;
const tags = ref<any[]>([]);
const selectedTag = ref("");
const artist = ref<any>(null);
const artistType = ref("music");
const mobileNav = ref(false);
const detailPanel = ref("queue");
const comments = ref<any[]>([]);
const commentsLoading = ref(false);
const commentsError = ref("");
async function loadComments() {
  const track = current.value;
  if (!track) return;
  commentsLoading.value = true;
  commentsError.value = "";
  comments.value = [];
  try {
    const data = await call(track.source, "getMusicComments", [track]);
    if (current.value && trackKey(current.value) === trackKey(track))
      comments.value = data.data || [];
  } catch (error) {
    if (current.value && trackKey(current.value) === trackKey(track))
      commentsError.value = (error as Error).message;
  } finally {
    commentsLoading.value = false;
  }
}
const panelOpen = ref(false);
const localInput = ref<HTMLInputElement>();
const backupInput = ref<HTMLInputElement>();
const playlistInput = ref<HTMLInputElement>();
const playlistImportBusy = ref(false);
const localBusy = ref(false);
const filter = ref("");
const localTracks = computed(() =>
  uniqueTracks(
    library.playlists
      .flatMap((p) => p.tracks)
      .filter((t) => t.source === "local"),
  ),
);
const visibleTracks = computed<Track[]>(() => {
  let tracks =
    page.value === "playlist"
      ? activePlaylist.value?.tracks || []
      : page.value === "local"
        ? localTracks.value
        : resultType.value === "music" || resultType.value === "lyric"
          ? displayedResults.value
          : [];
  if (filter.value && (page.value === "playlist" || page.value === "local"))
    tracks = tracks.filter((t) =>
      `${t.title} ${t.artist}`
        .toLowerCase()
        .includes(filter.value.toLowerCase()),
    );
  return tracks;
});
const isTrackView = computed(
  () =>
    ["playlist", "local"].includes(page.value) ||
    ["music", "lyric"].includes(resultType.value),
);
const heading = computed(() =>
  page.value === "playlist"
    ? activePlaylist.value?.name
    : page.value === "local"
      ? "本地音乐"
      : page.value === "settings"
        ? "设置"
        : resultTitle.value,
);
const modes = ["sequence", "list", "single", "random"];
const modeLabels: Record<string, string> = {
  sequence: "顺序播放",
  list: "列表循环",
  single: "单曲循环",
  random: "随机播放",
};
const modeIcon = computed(
  () =>
    ({ sequence: ListOrdered, list: Repeat, single: Repeat1, random: Shuffle })[
      library.mode
    ] || ListOrdered,
);
const has = (method: string) => provider.value?.capabilities.includes(method);
const providerName = (id: string) =>
  id === "local"
    ? "本地音频"
    : providers.value.find((p) => p.id === id)?.name ||
      sourceDefinitions.find((p) => p.id === id)?.name ||
      id ||
      "未知来源";
function sourcePluginName(id: string) {
  const name = providerName(id);
  const plugin = providers.value.find((p) => p.id === id)?.pluginName || "";
  const comparable = (value: string) =>
    value.toLocaleLowerCase().replace(/\s+/g, "");
  return comparable(plugin) !== comparable(name) ? plugin : "";
}
function sourceLabel(id: string) {
  const plugin = sourcePluginName(id);
  return plugin ? `${providerName(id)} · ${plugin}` : providerName(id);
}
const artwork = (item: any) => {
  const value = item.artwork || item.coverImg || item.avatar || "";
  return typeof value === "string" && /^https?:\/\//.test(value)
    ? value.replace("{size}", "400")
    : "";
};
const coverFailed = (event: Event) => {
  (event.target as HTMLImageElement).style.visibility = "hidden";
};

function navigate(target: string, playlistId?: string) {
  clearTimeout(sourceSelectionTimer);
  resultSourceFilter.value = null;
  browseGeneration++;
  parallelActive.value = false;
  busy.value = false;
  error.value = "";
  mobileNav.value = false;
  filter.value = "";
  artist.value = null;
  request.value = null;
  isEnd.value = true;
  page.value = target;
  if (playlistId) activePlaylistId.value = playlistId;
  if (target === "search") {
    resultTitle.value = "搜索音乐";
    results.value = [];
    resultType.value = searchType.value;
    request.value = null;
  }
  if (target === "rank") void browse("getTopLists", [], "rank", "排行榜");
  if (target === "recommend") void recommendations();
}
function normalize(items: any[], src: string) {
  return items.filter(Boolean).map((item) => ({
    ...item,
    source: src,
    title: item.title || item.name || "未命名",
    artist: item.artist || "",
  }));
}
async function browse(
  method: string,
  args: any[],
  type: string,
  title: string,
  append = false,
  explicitSource = source.value,
) {
  const ticket = ++browseGeneration;
  parallelActive.value = false;
  resultSourceFilter.value = null;
  busy.value = true;
  error.value = "";
  if (!append) {
    results.value = [];
    pageNo.value = 1;
  }
  resultType.value = type;
  resultTitle.value = title;
  request.value = { source: explicitSource, method, args, type, title };
  try {
    const result = await call(explicitSource, method, args);
    if (ticket !== browseGeneration) return;
    let items = Array.isArray(result)
      ? result
      : result.musicList || result.data || [];
    if (type === "rank")
      items = items.flatMap((group: any) =>
        Array.isArray(group.data)
          ? group.data.map((item: any) => ({ ...item, group: group.title }))
          : [group],
      );
    const normalized = normalize(items, explicitSource);
    results.value = append ? [...results.value, ...normalized] : normalized;
    isEnd.value =
      typeof result.isEnd === "boolean"
        ? result.isEnd
        : method === "search" ||
            method === "getRecommendSheetsByTag" ||
            method === "getArtistWorks"
          ? items.length < 20
          : true;
    if (method === "getMusicSheetInfo" && result._trackIds)
      request.value.args[0] = { ...args[0], _trackIds: result._trackIds };
  } catch (err) {
    if (ticket === browseGeneration) error.value = (err as Error).message;
  } finally {
    if (ticket === browseGeneration) busy.value = false;
  }
}
function search() {
  clearTimeout(sourceSelectionTimer);
  if (!keyword.value.trim()) return;
  page.value = "search";
  artist.value = null;
  mobileNav.value = false;
  if (parallelSearch.value) {
    parallelStart();
    return;
  }
  void browse(
    "search",
    [keyword.value.trim(), 1, searchType.value],
    searchType.value,
    `“${keyword.value.trim()}”`,
  );
}
function retry() {
  if (request.value) {
    const r = request.value;
    const args = [...r.args];
    if (
      [
        "search",
        "getAlbumInfo",
        "getArtistWorks",
        "getMusicSheetInfo",
        "getRecommendSheetsByTag",
      ].includes(r.method)
    )
      args[1] = 1;
    void browse(r.method, args, r.type, r.title, false, r.source);
  }
}
async function more() {
  if (busy.value) return;
  if (parallelActive.value) {
    const tasks = searchStates.value
      .filter(
        (s) => !s.isEnd && !s.error && !s.loading &&
          (!resultSourceFilter.value || s.source === resultSourceFilter.value),
      )
      .map((s) => ({ source: s.source, page: s.page + 1 }));
    if (tasks.length) await parallelBatch(tasks, browseGeneration);
    return;
  }
  if (!request.value) return;
  const r = request.value;
  const args = [...r.args];
  const nextPage = pageNo.value + 1;
  args[1] = nextPage;
  await browse(r.method, args, r.type, r.title, true, r.source);
  if (!error.value) pageNo.value = nextPage;
}
async function recommendations() {
  tags.value = [];
  selectedTag.value = "";
  resultTitle.value = "推荐歌单";
  results.value = [];
  resultType.value = "sheet";
  if (!has("getRecommendSheetsByTag")) {
    error.value = "该插件未提供推荐歌单功能";
    return;
  }
  const ticket = ++browseGeneration;
  busy.value = true;
  try {
    const data = await call(source.value, "getRecommendSheetTags");
    if (ticket !== browseGeneration) return;
    tags.value = (data.data || []).flatMap((g: any) => g.data || [g]);
    await browse("getRecommendSheetsByTag", [{}, 1], "sheet", "推荐歌单");
  } catch (err) {
    if (ticket === browseGeneration) {
      error.value = (err as Error).message;
      busy.value = false;
    }
  }
}
function chooseTag() {
  const tag = tags.value.find((t) => String(t.id) === selectedTag.value) || {};
  void browse("getRecommendSheetsByTag", [tag, 1], "sheet", "推荐歌单");
}
function openResult(item: any) {
  const type = resultType.value;
  if (type === "artist") {
    artist.value = item;
    artistType.value = "music";
    void artistWorks("music");
    return;
  }
  artist.value = null;
  if (type === "rank")
    void browse(
      "getTopListDetail",
      [item],
      "music",
      item.title,
      false,
      item.source,
    );
  else if (type === "album")
    void browse(
      "getAlbumInfo",
      [item, 1],
      "music",
      item.title,
      false,
      item.source,
    );
  else if (type === "sheet") {
    if (
      providers.value
        .find((p) => p.id === item.source)
        ?.capabilities.includes("getMusicSheetInfo")
    )
      void browse(
        "getMusicSheetInfo",
        [item, 1],
        "music",
        item.title,
        false,
        item.source,
      );
    else
      notify(
        "该插件只支持搜索此类歌单；请使用「导入在线歌单」和平台分享码导入",
      );
  }
}
function artistWorks(type: string) {
  artistType.value = type;
  void browse(
    "getArtistWorks",
    [artist.value, 1, type],
    type,
    artist.value.title,
    false,
    artist.value.source,
  );
}
watch(source, () => {
  if (
    !parallelSearch.value &&
    !provider.value?.searchTypes.includes(searchType.value)
  )
    searchType.value = provider.value?.searchTypes[0] || "music";
  if (page.value === "rank") navigate("rank");
  else if (page.value === "recommend") navigate("recommend");
  else if (page.value === "search" && !parallelSearch.value) {
    navigate("search");
    if (keyword.value.trim()) search();
  }
});

const dialog = ref<HTMLDialogElement>();
const dialogType = ref("");
const dialogTitle = ref("");
const formName = ref("");
const importValue = ref("");
const formTarget = ref("favorites");
const dialogBusy = ref(false);
const dialogError = ref("");
const pendingTracks = ref<Track[]>([]);
function openDialog(type: string, tracks: Track[] = []) {
  dialogType.value = type;
  dialogError.value = "";
  dialogBusy.value = false;
  dialogTitle.value =
    (
      {
        create: "新建歌单",
        rename: "重命名歌单",
        add: "加入歌单",
        import: "导入在线歌单",
        delete: "删除歌单",
        restore: "恢复备份",
      } as Record<string, string>
    )[type] || "";
  formName.value = type === "rename" ? activePlaylist.value?.name || "" : "";
  importValue.value = "";
  formTarget.value = "favorites";
  pendingTracks.value = tracks;
  dialog.value?.showModal();
}
async function submitDialog() {
  if (dialogBusy.value) return;
  dialogError.value = "";
  const name = formName.value.trim();
  if (["create", "rename", "import"].includes(dialogType.value) && !name) {
    dialogError.value = "请输入歌单名称";
    return;
  }
  if (dialogType.value === "create") {
    const id = crypto.randomUUID();
    library.playlists.push({ id, name, tracks: [] });
    navigate("playlist", id);
  } else if (
    dialogType.value === "rename" &&
    activePlaylist.value &&
    activePlaylist.value.id !== "favorites"
  )
    activePlaylist.value.name = name;
  else if (dialogType.value === "add")
    addTracks(formTarget.value, pendingTracks.value);
  else if (
    dialogType.value === "delete" &&
    activePlaylist.value?.id !== "favorites"
  ) {
    library.playlists = library.playlists.filter(
      (p) => p.id !== activePlaylistId.value,
    );
    navigate("playlist", "favorites");
  } else if (dialogType.value === "import") {
    if (!importValue.value.trim()) {
      dialogError.value = "请输入歌单链接或分享码";
      return;
    }
    dialogBusy.value = true;
    try {
      const data = await call(source.value, "importMusicSheet", [
        importValue.value.trim(),
      ]);
      const tracks = normalize(
        Array.isArray(data) ? data : data.musicList || [],
        source.value,
      );
      if (!tracks.length)
        throw new Error("未获取到歌曲，请确认链接与当前音源匹配");
      const id = crypto.randomUUID();
      library.playlists.push({ id, name, tracks: uniqueTracks(tracks) });
      navigate("playlist", id);
    } catch (err) {
      dialogError.value = (err as Error).message;
      return;
    } finally {
      dialogBusy.value = false;
    }
  } else if (dialogType.value === "restore" && backup.value) {
    stop();
    Object.assign(library, backup.value);
    backup.value = null;
    navigate("playlist", "favorites");
    notify("备份已恢复");
  }
  dialog.value?.close();
}
function removeTrack(track: Track) {
  if (activePlaylist.value)
    activePlaylist.value.tracks = activePlaylist.value.tracks.filter(
      (t) => trackKey(t) !== trackKey(track),
    );
}
function exportBackup() {
  downloadJson(JSON.stringify(library, null, 2), "music-web-backup");
}
function exportPlaylist() {
  if (!activePlaylist.value) return;
  downloadJson(serializePlaylists([activePlaylist.value]), activePlaylist.value.name);
}
function downloadJson(json: string, name: string) {
  const blob = new Blob([json], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")}-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function importPlaylistJson(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file || playlistImportBusy.value) return;
  playlistImportBusy.value = true;
  try {
    if (file.size > 10 * 1024 * 1024) throw new Error("歌单文件不能超过 10 MB");
    const playlists = parsePlaylistJson(await file.text());
    library.playlists = mergePlaylists(library.playlists, playlists);
    navigate("playlist", playlists[0].id);
    const hasLocal = playlists.some((list) => list.tracks.some((track) => track.source === "local"));
    notify(`已导入 ${playlists.length} 个歌单，保留已有歌曲${hasLocal ? "；JSON 不含本地音频文件" : ""}`);
  } catch (err) {
    notify((err as Error).message);
  } finally {
    playlistImportBusy.value = false;
    input.value = "";
  }
}
const backup = ref<ReturnType<typeof validateLibrary> | null>(null);
async function readBackup(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  try {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) throw new Error("备份文件不能超过 10 MB");
    backup.value = validateLibrary(JSON.parse(await file.text()));
    openDialog("restore");
  } catch (err) {
    notify((err as Error).message);
  } finally {
    input.value = "";
  }
}
async function importLocal(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = [...(input.files || [])];
  localBusy.value = true;
  const tracks: Track[] = [];
  try {
    for (const file of files) {
      if (
        !file.type.startsWith("audio/") &&
        !/\.(mp3|wav|flac|m4a|ogg|aac|opus)$/i.test(file.name)
      )
        continue;
      const id = `${file.name}:${file.size}:${file.lastModified}`;
      await storeAudio(id, file);
      tracks.push({
        id,
        source: "local",
        local: true,
        title: file.name.replace(/\.[^.]+$/, ""),
        artist: "本地音频",
        album: "",
      });
    }
  } catch (err) {
    notify((err as Error).message);
  } finally {
    if (tracks.length) {
      let p = library.playlists.find((p) => p.id === "local-files");
      if (!p) {
        p = { id: "local-files", name: "本地导入", tracks: [] };
        library.playlists.push(p);
      }
      p.tracks = uniqueTracks([...p.tracks, ...tracks]);
      navigate("local");
    }
    localBusy.value = false;
    input.value = "";
  }
}
const baseUrl = ref("");
const apiKey = ref("");
const status = ref<{ ok: boolean; message: string } | null>(null);
const checking = ref(false);
const saving = ref(false);
async function checkStatus() {
  checking.value = true;
  try {
    status.value = await api("status", {});
  } catch (err) {
    status.value = { ok: false, message: (err as Error).message };
  } finally {
    checking.value = false;
  }
}
async function saveSettings() {
  saving.value = true;
  try {
    await api("settings", { baseUrl: baseUrl.value, apiKey: apiKey.value });
    apiKey.value = "";
    notify("音源配置已保存");
    status.value = null;
  } catch (err) {
    notify((err as Error).message);
  } finally {
    saving.value = false;
  }
}
async function refreshInfo() {
  if (!current.value || current.value.source === "local") return;
  const track = current.value;
  try {
    const info = await call(track.source, "getMusicInfo", [track]);
    if (current.value && trackKey(current.value) === trackKey(track))
      current.value = { ...track, ...info };
  } catch (err) {
    notify((err as Error).message);
  }
}
function closeTrackMenus() {
  document
    .querySelectorAll<HTMLDetailsElement>(".track-menu[open]")
    .forEach((menu) => {
      menu.open = false;
    });
}
function toggleTrackMenu(event: MouseEvent) {
  const menu = (event.currentTarget as HTMLElement).closest("details");
  if (!menu) return;
  const open = !menu.open;
  closeTrackMenus();
  menu.open = open;
}
function dismissTrackMenus(event: MouseEvent) {
  if (
    !(event.target instanceof Element) ||
    !event.target.closest(".track-menu")
  ) {
    closeTrackMenus();
  }
}
function keyboard(event: KeyboardEvent) {
  if (event.key === "Escape") {
    const menu =
      document.querySelector<HTMLDetailsElement>(".track-menu[open]");
    if (menu) {
      event.preventDefault();
      closeTrackMenus();
      menu.querySelector("summary")?.focus();
      return;
    }
  }
  const target = event.target as HTMLElement;
  if (
    ["INPUT", "TEXTAREA", "SELECT", "BUTTON", "SUMMARY"].includes(
      target.tagName,
    ) ||
    target.isContentEditable ||
    dialog.value?.open
  )
    return;
  if (event.code === "Space") {
    event.preventDefault();
    void togglePlay();
  }
}
watch(
  () => current.value && trackKey(current.value),
  () => {
    if (!current.value) return;
    navigate("now-playing");
    comments.value = [];
    commentsError.value = "";
    if (
      !currentProvider.value?.capabilities.includes("getMusicComments") &&
      detailPanel.value === "comments"
    )
      detailPanel.value = "queue";
    reloadLyrics();
    if (detailPanel.value === "comments") void loadComments();
  },
);
watch([activeLyric, () => lyricLines.value.length, page], async () => {
  if (page.value !== "now-playing") return;
  await nextTick();
  const viewport = lyricViewport.value;
  const line = viewport?.querySelector<HTMLElement>("[data-active='true']");
  if (viewport && line)
    viewport.scrollTo({
      top: line.offsetTop - viewport.clientHeight / 2 + line.clientHeight / 2,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
});
function reloadLyrics() {
  void fetchLyric({
    native: Boolean(currentProvider.value?.capabilities.includes("getLyric")),
  });
}
function showPanel(panel: string) {
  detailPanel.value = panel;
  if (
    panel === "lyrics" &&
    current.value &&
    !lyric.value &&
    !lyricLoading.value
  )
    reloadLyrics();
  if (panel === "comments" && current.value) void loadComments();
}
onMounted(async () => {
  window.addEventListener("keydown", keyboard);
  document.addEventListener("click", dismissTrackMenus);
  try {
    providers.value = activeProviders(await api("providers"));
    saveSearchPreferences();
    providerEvents = new EventSource("/api/providers/events");
    providerEvents.addEventListener("providers", (event) => {
      try {
        providers.value = activeProviders(
          JSON.parse((event as MessageEvent).data),
        );
        eventsConnected.value = true;
      } catch {
        eventsConnected.value = false;
      }
    });
    providerEvents.onerror = () => {
      eventsConnected.value = false;
    };
    const config = await api("settings");
    baseUrl.value = config.baseUrl;
  } catch (err) {
    error.value = `本地服务连接失败：${(err as Error).message}`;
  }
});
onUnmounted(() => {
  window.removeEventListener("keydown", keyboard);
  document.removeEventListener("click", dismissTrackMenus);
  providerEvents?.close();
});
watch(playing, (value) => {
  if (value && current.value && current.value.source !== "local")
    void api("playback-report", {
      source: current.value.source,
      state: "playing",
    }).catch(() => {});
});
watch(playbackError, (value) => {
  if (
    current.value &&
    current.value.source !== "local" &&
    /^(音频加载失败|流媒体播放失败)/.test(value)
  )
    void api("playback-report", {
      source: current.value.source,
      state: "error",
    }).catch(() => {});
});
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar" :class="{ expanded: mobileNav }">
      <a class="brand" href="#" @click.prevent="navigate('search')"
        ><Disc3 :size="29" /><span
          >MUSIC<span class="brand-light">WEB</span><i></i></span
      ></a>
      <button
        class="mobile-menu icon-button"
        aria-label="展开导航"
        @click="mobileNav = !mobileNav"
      >
        <Menu />
      </button>
      <div class="nav-body">
        <nav aria-label="音乐导航">
          <button
            :class="{ active: page === 'now-playing' }"
            :disabled="!current"
            @click="navigate('now-playing')"
          >
            <Headphones />正在播放
          </button>
          <button
            :class="{ active: page === 'search' }"
            @click="navigate('search')"
          >
            <Search />搜索音乐
          </button>
          <button
            :class="{ active: page === 'rank' }"
            :disabled="!has('getTopLists')"
            @click="navigate('rank')"
          >
            <Radio />排行榜
          </button>
          <button
            :class="{ active: page === 'recommend' }"
            :disabled="!has('getRecommendSheetsByTag')"
            @click="navigate('recommend')"
          >
            <Disc3 />推荐歌单
          </button>
          <button
            :class="{ active: page === 'local' }"
            @click="navigate('local')"
          >
            <Headphones />本地音乐
          </button>
        </nav>
        <div class="nav-heading">
          <span>我的歌单</span
          ><button
            class="icon-button small"
            aria-label="新建歌单"
            @click="openDialog('create')"
          >
            <Plus :size="16" />
          </button>
        </div>
        <nav class="playlists" aria-label="我的歌单">
          <button
            v-for="list in library.playlists"
            :key="list.id"
            :class="{
              active: page === 'playlist' && activePlaylistId === list.id,
            }"
            @click="navigate('playlist', list.id)"
          >
            <Heart
              v-if="list.id === 'favorites'"
              :class="{
                filled: page === 'playlist' && activePlaylistId === 'favorites',
              }"
            /><ListMusic v-else /><span>{{ list.name }}</span
            ><small>{{ list.tracks.length }}</small>
          </button>
        </nav>
        <div class="sidebar-bottom">
          <button :disabled="playlistImportBusy" @click="playlistInput?.click()">
            <Upload />{{ playlistImportBusy ? "导入中…" : "导入 JSON 歌单" }}
          </button>
          <button
            :disabled="!has('importMusicSheet')"
            @click="openDialog('import')"
          >
            <ArrowDownToLine />导入在线歌单
          </button>
          <button
            :class="{ active: page === 'sources' }"
            @click="navigate('sources')"
          >
            <Server />音源管理
          </button>
          <button
            :class="{ active: page === 'settings' }"
            @click="navigate('settings')"
          >
            <Settings />设置
          </button>
        </div>
      </div>
    </aside>

    <div class="workspace">
      <header class="topbar">
        <form class="search-box" @submit.prevent="search">
          <Search :size="19" /><input
            v-model="keyword"
            aria-label="搜索关键词"
            placeholder="歌曲、专辑、歌手…"
            maxlength="200"
          /><button type="submit" aria-label="搜索">
            <ChevronRight :size="19" />
          </button>
        </form>
        <button
          class="icon-button import-shortcut"
          title="导入本地音频"
          aria-label="导入本地音频"
          @click="localInput?.click()"
        >
          <Upload :size="20" />
        </button>
      </header>
      <main :class="{ 'immersive-main': page === 'now-playing' }">
        <section v-if="page === 'now-playing'" class="now-playing-view">
          <div
            class="cover-backdrop"
            :style="coverBackground"
            aria-hidden="true"
          ></div>
          <div class="cover-shade" aria-hidden="true"></div>
          <div class="lyrics-header">
            <button
              class="icon-button"
              aria-label="返回搜索"
              @click="navigate('search')"
            >
              <ChevronLeft :size="22" />
            </button>
            <div>
              <h1>{{ current?.title || "正在播放" }}</h1>
              <p>
                {{ current?.artist
                }}<span v-if="current?.album"> · {{ current.album }}</span
                ><span v-if="currentProvider">
                  · {{ currentProvider.name }} /
                  {{ currentProvider.pluginName }}</span
                >
              </p>
            </div>
            <button
              v-if="current"
              class="icon-button"
              :class="{ loved: liked(current) }"
              :aria-label="liked(current) ? '取消喜欢当前歌曲' : '喜欢当前歌曲'"
              :aria-pressed="liked(current)"
              @click="toggleLike(current)"
            >
              <Heart
                :size="22"
                :fill="liked(current) ? 'currentColor' : 'none'"
              />
            </button>
          </div>
          <LyricTools />
          <div
            ref="lyricViewport"
            class="scrolling-lyrics"
            aria-label="滚动歌词"
          >
            <div v-if="lyricLoading && !lyricLines.length" class="lyric-empty">
              <LoaderCircle class="spin" :size="25" /><span>正在获取歌词</span>
            </div>
            <div v-else-if="!lyricLines.length" class="lyric-empty">
              <Music2 :size="32" /><span>{{ lyricError || "暂无歌词" }}</span
              ><button v-if="current" @click="reloadLyrics">重试</button>
            </div>
            <template v-else
              ><button
                v-for="(line, index) in lyricLines"
                :key="index"
                :data-active="index === activeLyric"
                :class="{ 'current-lyric': index === activeLyric }"
                :disabled="line.time < 0 || !duration"
                @click="seekLyric(line.time)"
              >
                {{ line.text || "♪" }}
              </button></template
            >
          </div>
        </section>
        <template v-else-if="page === 'sources'">
          <div class="page-heading">
            <div>
              <h1>音源管理<span class="title-dot">.</span></h1>
              <div class="heading-meta">
                <span>{{ providers.length }} 个插件</span
                ><span>{{
                  eventsConnected ? "状态实时更新" : "连接状态更新中…"
                }}</span>
              </div>
            </div>
            <button
              :disabled="checkingSources.length > 0"
              @click="checkAllProviders"
            >
              <RefreshCw
                :size="16"
                :class="{ spin: checkingSources.length > 0 }"
              />全部检测
            </button>
          </div>
          <div class="source-manager-toolbar">
            <span>参与并行搜索：{{ selectedSources.length }} 个</span
            ><button @click="selectSearchSources('all')">全选</button
            ><button @click="selectSearchSources('clear')">全不选</button
            ><button @click="selectSearchSources('ready')">
              选择已配置音源
            </button>
          </div>
          <div class="provider-list">
            <section v-for="p in providers" :key="p.id" class="provider-row">
              <div class="provider-main">
                <label class="provider-select"
                  ><input
                    type="checkbox"
                    :checked="selectedSources.includes(p.id)"
                    :aria-label="`参与搜索 ${p.name}`"
                    @change="changeSearchSource(p.id)"
                  /><strong>{{ p.name }}</strong></label
                ><span
                  class="provider-state"
                  :class="{
                    bad:
                      p.loadError ||
                      !p.configured ||
                      latestActivity(p)?.state === 'error',
                    pending: latestActivity(p)?.state === 'loading',
                  }"
                  >{{ sourceStateText(p) }}</span
                >
                <div class="provider-actions">
                  <button
                    :disabled="
                      checkingSources.includes(p.id) || Boolean(p.loadError)
                    "
                    @click="checkProvider(p)"
                  >
                    <LoaderCircle
                      v-if="checkingSources.includes(p.id)"
                      class="spin"
                      :size="13"
                    />检测</button
                  ><button
                    v-if="p.configFields.length"
                    @click="openProviderConfig(p)"
                  >
                    配置</button
                  ><a
                    :href="p.pluginUrl"
                    target="_blank"
                    rel="noopener noreferrer"
                    :aria-label="`${p.name} 插件源码`"
                    ><ExternalLink :size="15"
                  /></a>
                </div>
              </div>
              <div class="provider-meta">
                <span
                  >{{ p.pluginName }} · {{ p.author }} · v{{ p.version }}</span
                ><span>{{ p.playbackService }}</span
                ><span>{{
                  p.searchTypes.map((t) => searchNames[t]).join(" / ")
                }}</span>
              </div>
              <p v-if="p.loadError" class="form-error">{{ p.loadError }}</p>
              <p v-else-if="!p.configured" class="provider-config-needed">
                待填写：{{ p.missingConfig.join("、") }}
              </p>
              <div class="provider-activities">
                <div
                  v-for="op in ['search', 'play', 'lyric', 'check']"
                  :key="op"
                  :class="{
                    bad: p.activities[op as 'search']?.state === 'error',
                  }"
                >
                  <span>{{ operationNames[op] }}</span
                  ><LoaderCircle
                    v-if="p.activities[op as 'search']?.state === 'loading'"
                    class="spin"
                    :size="12"
                  /><strong>{{
                    !p.playable && op === "play"
                      ? "仅歌词"
                      : p.activities[op as "search"]?.message || "未检测"
                  }}</strong
                  ><small v-if="p.activities[op as 'search']"
                    >{{
                      p.activities[op as "search"]?.elapsedMs != null
                        ? `${p.activities[op as "search"]?.elapsedMs} ms · `
                        : ""
                    }}{{
                      new Date(
                        p.activities[op as "search"]!.updatedAt,
                      ).toLocaleTimeString("zh-CN", { hour12: false })
                    }}</small
                  >
                </div>
              </div>
              <form
                v-if="providerConfigId === p.id"
                class="provider-config"
                @submit.prevent="saveSourceConfig"
              >
                <label v-for="field in p.configFields" :key="field.key"
                  >{{ field.name
                  }}<input
                    v-model="providerConfigValues[field.key]"
                    :type="
                      field.type === 'password'
                        ? 'password'
                        : field.key === 'url'
                          ? 'url'
                          : 'text'
                    "
                    :required="
                      field.required && !savedSecrets.includes(field.key)
                    "
                    :placeholder="
                      savedSecrets.includes(field.key)
                        ? '已保存，留空保留'
                        : field.key === 'url'
                          ? 'https://你的服务器'
                          : ''
                    "
                    autocomplete="off"
                /></label>
                <p v-if="configError" class="form-error">{{ configError }}</p>
                <div class="button-row">
                  <button class="primary" :disabled="configSaving">
                    保存配置</button
                  ><button type="button" @click="providerConfigId = ''">
                    取消
                  </button>
                </div>
              </form>
            </section>
          </div>
        </template>
        <section
          v-else-if="page === 'lyric-preview'"
          class="lyric-preview-view"
        >
          <div class="page-heading">
            <div>
              <h1>{{ lyricPreview?.title }}</h1>
              <div class="heading-meta">
                <span>{{ lyricPreview?.artist }}</span
                ><span>{{ providerName(lyricPreview?.source || "") }}</span>
              </div>
            </div>
            <button @click="navigate('search')">返回搜索</button>
          </div>
          <LoaderCircle v-if="previewLoading" class="spin" />
          <div v-else-if="previewError" class="notice error">
            {{ previewError
            }}<button @click="lyricPreview && activateTrack(lyricPreview)">
              重试
            </button>
          </div>
          <template v-else
            ><button v-if="current && previewText" @click="applyPreviewLyric">
              用于当前歌曲
            </button>
            <pre class="lyric-preview-text">{{
              previewText.replace(/\[(\d+:\d+(?:\.\d+)?)\]/g, "\n[$1]")
            }}</pre>
          </template>
        </section>
        <template v-else-if="page === 'settings'">
          <div class="page-heading">
            <h1>设置<span class="title-dot">.</span></h1>
          </div>
          <section class="settings-section">
            <h2>播放</h2>
            <label class="setting-row"
              >默认音质<select v-model="library.quality">
                <option value="320k">320 kbps</option>
                <option value="128k">128 kbps</option>
              </select></label
            >
            <p class="muted">音质变更在下一次播放时生效。</p>
          </section>
          <section class="settings-section">
            <h2>解析服务</h2>
            <form class="settings-form" @submit.prevent="saveSettings">
              <label
                >服务地址<input
                  v-model="baseUrl"
                  type="url"
                  required
                  placeholder="https://lxmusicapi.onrender.com" /></label
              ><label
                >请求密钥<input
                  v-model="apiKey"
                  type="password"
                  autocomplete="off"
                  placeholder="留空保留当前密钥"
              /></label>
              <div class="button-row">
                <button class="primary" :disabled="saving">
                  {{ saving ? "保存中…" : "保存配置" }}</button
                ><button
                  type="button"
                  :disabled="checking"
                  @click="checkStatus"
                >
                  <LoaderCircle
                    v-if="checking"
                    class="spin"
                    :size="16"
                  />检查连接
                </button>
              </div>
            </form>
            <div
              v-if="status"
              class="notice"
              :class="{ success: status.ok }"
              role="status"
            >
              <Check v-if="status.ok" :size="18" /><AlertCircle
                v-else
                :size="18"
              />{{ status.message }}
            </div>
            <p class="muted">
              兼容 keep-alive 的 /url/平台/歌曲ID/音质 接口。最高
              320k，不支持数字专辑。解析失败后暂停，不自动重试。
            </p>
          </section>
          <section class="settings-section">
            <h2>备份</h2>
            <div class="button-row">
              <button @click="exportBackup">
                <Download :size="16" />导出全部备份（JSON）</button
              ><button @click="backupInput?.click()">
                <Upload :size="16" />恢复备份
              </button>
            </div>
            <p class="muted">
              备份包含歌单、收藏和队列，不包含本地音频文件。请固定使用当前浏览器与地址。
            </p>
          </section>
          <section class="settings-section">
            <h2>音源能力</h2>
            <div class="capability-table">
              <div v-for="p in providers" :key="p.id">
                <strong>{{ p.name }}</strong
                ><span>{{
                  p.searchTypes.map((t) => searchNames[t]).join(" / ")
                }}</span
                ><small>{{ p.pluginName }} · {{ p.version }}</small>
              </div>
            </div>
          </section>
        </template>
        <template v-else>
          <div class="page-heading">
            <div>
              <h1>{{ heading }}<span class="title-dot">.</span></h1>
              <div class="heading-meta">
                <span>{{
                  page === "playlist" || page === "local"
                    ? `${visibleTracks.length} 首歌曲`
                    : parallelActive
                      ? resultSourceFilter
                        ? `${providerName(resultSourceFilter)} · ${displayedResults.length} 个结果`
                        : `${searchStates.length} 个音源 · ${results.length} 个结果`
                      : provider?.name
                }}</span
                ><span
                  v-if="page === 'playlist' && activePlaylistId === 'favorites'"
                  >点击爱心收藏</span
                >
              </div>
            </div>
            <div class="heading-actions">
              <button v-if="page === 'playlist'" @click="exportPlaylist">
                <Download :size="16" />导出 JSON
              </button>
              <button
                v-if="page === 'local'"
                :disabled="localBusy"
                @click="localInput?.click()"
              >
                <Upload :size="16" />{{
                  localBusy ? "导入中…" : "导入音频"
                }}</button
              ><template
                v-if="page === 'playlist' && activePlaylistId !== 'favorites'"
                ><button
                  class="icon-button"
                  aria-label="重命名歌单"
                  @click="openDialog('rename')"
                >
                  <Pencil :size="18" /></button
                ><button
                  class="icon-button"
                  aria-label="删除歌单"
                  @click="openDialog('delete')"
                >
                  <Trash2 :size="18" /></button
              ></template>
            </div>
          </div>
          <div v-if="page === 'search' && !artist" class="search-controls">
            <button
              class="parallel-switch"
              role="switch"
              :aria-checked="parallelSearch"
              aria-label="并行搜索"
              @click="changeSearchMode"
            >
              <span class="switch-track" :class="{ on: parallelSearch }"
                ><i></i></span
              >并行搜索
            </button>
            <div v-if="parallelSearch" class="source-selection-tools">
              <span
                >已选 {{ selectedSources.length }} /
                {{ providers.length }}</span
              ><button @click="selectSearchSources('all')">全选</button
              ><button @click="selectSearchSources('clear')">全不选</button
              ><button @click="navigate('sources')">音源管理</button>
            </div>
            <div
              v-if="parallelSearch"
              class="source-chips"
              aria-label="参与搜索的音源"
            >
              <button
                v-for="p in providers"
                :key="p.id"
                :class="{ chosen: selectedSources.includes(p.id) }"
                :aria-pressed="selectedSources.includes(p.id)"
                :disabled="Boolean(p.loadError)"
                :title="
                  p.searchTypes.includes(searchType)
                    ? `${p.pluginName} · ${sourceStateText(p)}`
                    : '当前搜索类型不支持；切换类型后参与搜索'
                "
                @click="changeSearchSource(p.id)"
              >
                <Check v-if="selectedSources.includes(p.id)" :size="12" />{{
                  p.name
                }}<small class="chip-kind">{{
                  p.kind === "lyrics" ? "歌词" : !p.configured ? "待配置" : ""
                }}</small>
              </button>
            </div>
          </div>
          <div v-if="parallelActive" class="source-progress" aria-live="polite">
            <button
              type="button"
              :class="{ selected: resultSourceFilter === null }"
              :aria-pressed="resultSourceFilter === null"
              @click="resultSourceFilter = null"
            >全部结果 · {{ results.length }} 条</button
            >
            <button
              v-for="state in searchStates"
              :key="state.source"
              type="button"
              :class="{
                failed: state.error,
                selected: resultSourceFilter === state.source,
              }"
              :aria-pressed="resultSourceFilter === state.source"
              :title="`只看${providerName(state.source)}的搜索结果，再次点击恢复全部`"
              @click="
                resultSourceFilter = resultSourceFilter === state.source ? null : state.source
              "
              ><LoaderCircle
                v-if="state.loading"
                :size="12"
                class="spin"
              /><AlertCircle v-else-if="state.error" :size="12" /><Check
                v-else
                :size="12"
              />{{ providerName(state.source) }} ·
              {{
                state.loading
                  ? "搜索中"
                  : state.error
                    ? "失败"
                    : `${sourceResultCounts[state.source] || 0} 条`
              }}</button
            >
          </div>
          <div
            v-if="parallelActive && parallelErrors.length"
            class="parallel-errors"
          >
            <div v-for="state in parallelErrors" :key="state.source">
              <span>{{ providerName(state.source) }}：{{ state.error }}</span
              ><button
                :disabled="state.loading"
                @click="retrySource(state.source)"
              >
                重试此音源
              </button>
            </div>
          </div>
          <div v-if="page === 'search' && !artist" class="tabs">
            <button
              v-for="type in availableSearchTypes"
              :key="type"
              :class="{ selected: searchType === type }"
              @click="
                searchType = type;
                keyword.trim() ? search() : (resultType = type);
              "
            >
              {{ searchNames[type] }}
            </button>
          </div>
          <div v-if="artist" class="tabs">
            <button
              :class="{ selected: artistType === 'music' }"
              @click="artistWorks('music')"
            >
              热门歌曲</button
            ><button
              :class="{ selected: artistType === 'album' }"
              @click="artistWorks('album')"
            >
              歌手专辑
            </button>
          </div>
          <div v-if="page === 'recommend' && tags.length" class="tag-selector">
            <label
              >分类<select v-model="selectedTag" @change="chooseTag">
                <option value="">全部歌单</option>
                <option
                  v-for="tag in tags"
                  :key="tag.id"
                  :value="String(tag.id)"
                >
                  {{ tag.title }}
                </option>
              </select></label
            >
          </div>
          <div v-if="isTrackView && visibleTracks.length" class="list-toolbar">
            <button
              v-if="playableVisibleTracks.length"
              class="primary"
              @click="
                playTrack(playableVisibleTracks[0], playableVisibleTracks)
              "
            >
              <Play :size="15" fill="currentColor" />播放全部</button
            ><button @click="openDialog('add', visibleTracks)">
              <FolderPlus :size="17" />加入歌单</button
            ><input
              v-if="page === 'playlist' || page === 'local'"
              v-model="filter"
              aria-label="筛选歌单"
              placeholder="筛选歌曲"
            />
          </div>
          <div v-if="error" class="notice error" role="alert">
            <AlertCircle :size="21" />
            <div>
              {{ error
              }}<button v-if="request" class="text-button" @click="retry">
                重试
              </button>
            </div>
          </div>
          <div
            v-if="displayedResultsLoading && !displayedResults.length"
            class="empty-state"
          >
            <LoaderCircle class="spin" :size="32" />
            <p>正在加载</p>
          </div>
          <template v-else-if="isTrackView && visibleTracks.length">
            <div class="track-table-scroll">
              <div class="track-table" role="table" aria-label="歌曲列表">
                <div class="track-row table-head" role="row">
                  <span>歌曲 / 歌手</span><span class="album-col">专辑</span
                  ><span>来源</span><span>操作</span>
                </div>
                <div
                  v-for="(track, index) in visibleTracks"
                  :key="`${trackKey(track)}:${index}`"
                  class="track-row"
                  :class="{
                    'is-current':
                      current && trackKey(current) === trackKey(track),
                  }"
                  role="row"
                  @dblclick="activateTrack(track, visibleTracks)"
                >
                  <div class="track-title">
                    <button
                      class="row-play"
                      :aria-label="`${playable(track) ? '播放' : '查看歌词'} ${track.title}`"
                      @click="activateTrack(track, visibleTracks)"
                    >
                      <span class="track-number">{{
                        String(index + 1).padStart(2, "0")
                      }}</span
                      ><Play
                        v-if="playable(track)"
                        class="row-play-icon"
                        :size="15"
                        fill="currentColor"
                      /><FileText v-else class="row-play-icon" :size="15" />
                    </button>
                    <div class="mini-cover">
                      <Music2 :size="19" /><img
                        v-if="artwork(track)"
                        :src="artwork(track)"
                        alt=""
                        loading="lazy"
                        referrerpolicy="no-referrer"
                        @error="coverFailed"
                      />
                    </div>
                    <div>
                      <button
                        class="song-name"
                        @click="activateTrack(track, visibleTracks)"
                      >
                        {{ track.title }}</button
                      ><span>{{ track.artist || "未知歌手" }}</span>
                    </div>
                  </div>
                  <span class="album-col truncate">{{
                    track.album || "—"
                  }}</span>
                  <span class="source-cell" :title="sourceLabel(track.source)"
                    ><strong>{{ providerName(track.source) }}</strong
                    ><small v-if="sourcePluginName(track.source)">{{
                      sourcePluginName(track.source)
                    }}</small></span
                  >
                  <div class="row-actions">
                    <button
                      class="icon-button"
                      :class="{ loved: liked(track) }"
                      :aria-label="
                        liked(track)
                          ? `取消喜欢 ${track.title}`
                          : `喜欢 ${track.title}`
                      "
                      :aria-pressed="liked(track)"
                      @click="toggleLike(track)"
                    >
                      <Heart
                        :size="17"
                        :fill="liked(track) ? 'currentColor' : 'none'"
                      />
                    </button>
                    <details class="track-menu" @dblclick.stop>
                      <summary
                        :aria-label="`${track.title} 更多操作`"
                        @click.prevent="toggleTrackMenu"
                      >
                        <MoreHorizontal :size="18" />
                      </summary>
                      <div class="menu-popover" @click="closeTrackMenus()">
                        <button @click="queueNext(track)">下一首播放</button
                        ><button @click="openDialog('add', [track])">
                          加入歌单</button
                        ><button
                          v-if="page === 'playlist'"
                          @click="removeTrack(track)"
                        >
                          从歌单移除
                        </button>
                      </div>
                    </details>
                  </div>
                </div>
              </div>
            </div>
          </template>
          <div
            v-else-if="!isTrackView && displayedResults.length"
            class="result-grid"
          >
            <button
              v-for="(item, index) in displayedResults"
              :key="`${item.source}:${item.id}:${index}`"
              class="result-card"
              @click="openResult(item)"
            >
              <div
                class="result-art"
                :class="{ 'artist-art': resultType === 'artist' }"
              >
                <Disc3 :size="58" /><img
                  v-if="artwork(item)"
                  :src="artwork(item)"
                  alt=""
                  loading="lazy"
                  referrerpolicy="no-referrer"
                  @error="coverFailed"
                /><span class="card-play"><ChevronRight :size="23" /></span>
              </div>
              <strong>{{ item.title }}</strong
              ><span v-if="item.artist || item.group">{{
                item.artist || item.group
              }}</span>
              <small
                class="resource-origin"
                :title="`来源：${sourceLabel(item.source)}`"
                ><Radio :size="11" aria-hidden="true" /><span
                  class="origin-name"
                  >来源：{{ sourceLabel(item.source) }}</span
                ></small
              >
            </button>
          </div>
          <div v-else-if="!error" class="empty-state">
            <div class="empty-disc"><Disc3 :size="60" stroke-width="1" /></div>
            <h2>
              {{
                page === "playlist"
                  ? "歌单还是空的"
                  : page === "local"
                    ? "添加你的音乐"
                    : parallelActive && resultSourceFilter
                      ? "该音源暂无结果"
                      : request || parallelActive
                        ? "没有找到结果"
                        : "想听什么？"
              }}
            </h2>
            <p>
              {{
                page === "playlist"
                  ? "搜索音乐，点击爱心或加入歌单"
                  : page === "local"
                    ? "MP3 / FLAC / WAV / M4A / OGG"
                    : parallelActive && resultSourceFilter
                      ? "可切换音源或查看全部结果"
                      : request || parallelActive
                        ? "换个关键词或音源试试"
                        : "搜索歌曲、专辑或歌手"
              }}
            </p>
            <button v-if="page === 'playlist'" @click="navigate('search')">
              <Search :size="16" />搜索音乐</button
            ><button
              v-if="page === 'local'"
              class="primary"
              @click="localInput?.click()"
            >
              <Plus :size="16" />选择音频文件
            </button>
          </div>
          <div
            v-if="(request || parallelActive) && hasMoreResults && !error"
            class="load-more"
          >
            <button :disabled="busy" @click="more">
              <LoaderCircle v-if="busy" class="spin" :size="16" />{{
                busy ? "加载中…" : "加载更多"
              }}
            </button>
          </div>
        </template>
      </main>
    </div>

    <aside class="right-panel" :class="{ open: panelOpen }">
      <div class="panel-tabs">
        <button
          :class="{ selected: detailPanel === 'queue' }"
          @click="showPanel('queue')"
        >
          播放队列 <span>{{ library.queue.length }}</span></button
        ><button
          :class="{ selected: detailPanel === 'lyrics' }"
          @click="showPanel('lyrics')"
        >
          歌词</button
        ><button
          v-if="currentProvider?.capabilities.includes('getMusicComments')"
          :class="{ selected: detailPanel === 'comments' }"
          @click="showPanel('comments')"
        >
          评论
        </button>
        <button
          class="panel-close icon-button"
          aria-label="关闭播放面板"
          @click="panelOpen = false"
        >
          <X :size="17" />
        </button>
      </div>
      <div class="record-art" :class="{ rotating: playing }">
        <img
          v-if="current && artwork(current)"
          :src="artwork(current)"
          alt="当前歌曲封面"
          referrerpolicy="no-referrer"
          @error="coverFailed"
        />
        <div v-else class="record-label">
          <span>M</span><small>MUSIC WEB</small>
        </div>
        <i></i>
      </div>
      <div class="now-title">
        <strong>{{ current?.title || "未在播放" }}</strong
        ><span>{{ current?.artist || "选择一首音乐" }}</span
        ><small v-if="currentProvider" class="current-source"
          >{{ currentProvider.name }} · {{ currentProvider.pluginName }}<br />{{
            currentProvider.playbackService
          }}<br />{{
            currentProvider.activities.play?.message || "未播放"
          }}</small
        >
        <button
          v-if="
            current &&
            providers
              .find((p) => p.id === current?.source)
              ?.capabilities.includes('getMusicInfo')
          "
          class="text-button"
          @click="refreshInfo"
        >
          更新歌曲信息
        </button>
      </div>
      <template v-if="detailPanel === 'queue'"
        ><div v-if="library.queue.length" class="queue-heading">
          <span>接下来播放</span
          ><button
            class="text-button"
            @click="library.queue = current ? [current] : []"
          >
            清空队列
          </button>
        </div>
        <div class="queue-list">
          <div
            v-for="(track, index) in library.queue"
            :key="trackKey(track)"
            class="queue-item"
            :class="{
              'is-current': current && trackKey(current) === trackKey(track),
            }"
          >
            <span>{{ String(index + 1).padStart(2, "0") }}</span
            ><button @click="playTrack(track)">
              <strong>{{ track.title }}</strong
              ><small>{{ track.artist }}</small></button
            ><button
              class="icon-button"
              :aria-label="`移出队列 ${track.title}`"
              @click="library.queue.splice(index, 1)"
            >
              <X :size="14" />
            </button>
          </div>
          <div v-if="!library.queue.length" class="queue-empty">
            <ListMusic :size="24" />
            <p>播放队列为空</p>
          </div>
        </div></template
      >
      <div v-else-if="detailPanel === 'comments'" class="comments-panel">
        <LoaderCircle v-if="commentsLoading" class="spin" />
        <p v-if="commentsError">{{ commentsError }}</p>
        <article v-for="comment in comments" :key="comment.id">
          <strong>{{ comment.nickName }}</strong>
          <p>{{ comment.comment }}</p>
          <small>{{ comment.like }} 赞</small>
          <blockquote v-for="reply in comment.replies || []" :key="reply.id">
            {{ reply.nickName }}：{{ reply.comment }}
          </blockquote>
        </article>
        <button v-if="!commentsLoading" @click="loadComments">刷新评论</button>
      </div>
      <div v-else class="lyrics">
        <LyricTools compact />
        <LoaderCircle v-if="lyricLoading" class="spin" :size="22" />
        <p v-if="lyricError">{{ lyricError }}</p>
        <p v-if="!current">播放歌曲后查看歌词</p>
        <button
          v-for="(line, index) in lyricLines"
          :key="index"
          :class="{ 'active-line': index === activeLyric }"
          :disabled="line.time < 0 || !duration"
          @click="seekLyric(line.time)"
        >
          {{ line.text || "♪" }}</button
        ><button
          v-if="current && !lyricLoading"
          class="text-button"
          @click="reloadLyrics"
        >
          重新获取歌词
        </button>
      </div>
    </aside>

    <footer class="player">
      <div v-if="playbackError" class="playback-error" role="alert">
        <AlertCircle :size="17" /><span>{{ playbackError }}</span
        ><button v-if="current" @click="playTrack(current)">重试</button
        ><button
          class="icon-button"
          aria-label="关闭播放错误"
          @click="playbackError = ''"
        >
          <X :size="16" />
        </button>
      </div>
      <div class="player-track" @dblclick="current && navigate('now-playing')">
        <div class="mini-cover large">
          <Disc3 :size="27" /><img
            v-if="current && artwork(current)"
            :src="artwork(current)"
            alt=""
            referrerpolicy="no-referrer"
            @error="coverFailed"
          />
        </div>
        <div>
          <strong>{{ current?.title || "选择一首音乐" }}</strong
          ><span>{{ current?.artist || "—" }}</span>
        </div>
        <button
          class="icon-button"
          :disabled="!current"
          :class="{ loved: current && liked(current) }"
          aria-label="收藏当前歌曲"
          :aria-pressed="Boolean(current && liked(current))"
          @click="current && toggleLike(current)"
        >
          <Heart
            :size="19"
            :fill="current && liked(current) ? 'currentColor' : 'none'"
          />
        </button>
      </div>
      <div class="transport">
        <div class="transport-buttons">
          <button
            class="icon-button mode-button"
            :aria-label="modeLabels[library.mode]"
            :title="modeLabels[library.mode]"
            @click="
              library.mode =
                modes[(modes.indexOf(library.mode) + 1) % modes.length]
            "
          >
            <component :is="modeIcon" :size="17" /></button
          ><button
            class="icon-button"
            :disabled="!library.queue.length"
            aria-label="上一首"
            @click="previous"
          >
            <SkipBack :size="21" fill="currentColor" /></button
          ><button
            class="main-play"
            :aria-label="loading ? '取消加载' : playing ? '暂停' : '播放'"
            @click="togglePlay"
          >
            <LoaderCircle v-if="loading" class="spin" :size="21" /><Pause
              v-else-if="playing"
              :size="21"
              fill="currentColor"
            /><Play v-else :size="21" fill="currentColor" /></button
          ><button
            class="icon-button"
            :disabled="!library.queue.length"
            aria-label="下一首"
            @click="next(false)"
          >
            <SkipForward :size="21" fill="currentColor" /></button
          ><span class="quality-label">{{
            current?.source === "local"
              ? "本地"
              : currentProvider && currentProvider.kind !== "huibq"
                ? "标准"
                : library.quality
          }}</span>
        </div>
        <div class="progress-row">
          <span>{{ formatTime(time) }}</span
          ><input
            type="range"
            aria-label="播放进度"
            min="0"
            :max="duration || 1"
            step="0.1"
            :value="time"
            :disabled="!duration"
            :style="{
              '--progress': `${duration ? (time / duration) * 100 : 0}%`,
            }"
            @input="seek(Number(($event.target as HTMLInputElement).value))"
          /><span>{{ formatTime(duration) }}</span>
        </div>
      </div>
      <div class="volume">
        <Volume2 :size="19" /><input
          v-model.number="library.volume"
          type="range"
          aria-label="音量"
          min="0"
          max="1"
          step="0.01"
          :style="{ '--progress': `${library.volume * 100}%` }"
        /><button
          class="icon-button queue-toggle"
          aria-label="显示播放队列"
          @click="
            panelOpen = !panelOpen;
            mobileNav = false;
          "
        >
          <ListMusic :size="21" />
        </button>
      </div>
    </footer>
    <div v-if="notification" class="toast" role="status">
      <Check :size="17" />{{ notification
      }}<button
        class="icon-button"
        aria-label="关闭通知"
        @click="notification = ''"
      >
        <X :size="15" />
      </button>
    </div>
    <input
      ref="localInput"
      hidden
      type="file"
      accept="audio/*,.flac,.m4a,.opus"
      multiple
      @change="importLocal"
    />
    <input
      ref="backupInput"
      hidden
      type="file"
      accept="application/json,.json"
      @change="readBackup"
    />
    <input
      ref="playlistInput"
      hidden
      type="file"
      accept="application/json,.json"
      @change="importPlaylistJson"
    />
    <dialog ref="dialog" @cancel="dialogBusy && $event.preventDefault()">
      <form @submit.prevent="submitDialog">
        <div class="dialog-heading">
          <h2>{{ dialogTitle }}</h2>
          <button
            type="button"
            class="icon-button"
            :disabled="dialogBusy"
            aria-label="关闭对话框"
            @click="dialog?.close()"
          >
            <X :size="20" />
          </button>
        </div>
        <label v-if="['create', 'rename', 'import'].includes(dialogType)"
          >歌单名称<input
            v-model="formName"
            required
            maxlength="80"
            autofocus
            placeholder="输入名称"
            :disabled="dialogBusy"
        /></label>
        <template v-if="dialogType === 'import'"
          ><label
            >音源<select v-model="source" :disabled="dialogBusy">
              <option v-for="p in providers" :key="p.id" :value="p.id">
                {{ p.name }}
              </option>
            </select></label
          ><label
            >歌单链接 / 分享码<input
              v-model="importValue"
              required
              maxlength="1000"
              :disabled="dialogBusy"
              placeholder="粘贴歌单链接或分享码"
          /></label>
          <p class="muted" v-for="hint in provider?.hints" :key="hint">
            {{ hint }}
          </p></template
        >
        <label v-if="dialogType === 'add'"
          >选择歌单<select v-model="formTarget">
            <option
              v-for="list in library.playlists"
              :key="list.id"
              :value="list.id"
            >
              {{ list.name }}
            </option>
          </select></label
        >
        <p v-if="dialogType === 'delete'">
          删除「{{ activePlaylist?.name }}」？其他歌单中的歌曲会保留。
        </p>
        <p v-if="dialogType === 'restore'">
          用备份中的
          {{ backup?.playlists.length }}
          个歌单替换当前数据？建议先导出当前歌单。本地音频文件不会随备份恢复。
        </p>
        <p v-if="dialogError" class="form-error" role="alert">
          {{ dialogError }}
        </p>
        <div class="dialog-actions">
          <button type="button" :disabled="dialogBusy" @click="dialog?.close()">
            取消</button
          ><button class="primary" :disabled="dialogBusy">
            <LoaderCircle v-if="dialogBusy" class="spin" :size="16" />{{
              dialogBusy
                ? "导入中…"
                : dialogType === "delete"
                  ? "删除"
                  : dialogType === "restore"
                    ? "替换并恢复"
                    : "确定"
            }}
          </button>
        </div>
      </form>
    </dialog>
  </div>
</template>
