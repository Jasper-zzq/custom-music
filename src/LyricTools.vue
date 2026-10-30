<script setup lang="ts">
import { ref, watch } from "vue";
import { Search, Minus, Plus, LoaderCircle, RotateCcw } from "lucide-vue-next";
import {
  current,
  lyric,
  lyricLoading,
  lyricPhase,
  lyricSourceLabel,
  lyricMatchedTitle,
  lyricCandidates,
  lyricFailures,
  lyricOffset,
  lyricTimed,
  lyricError,
  fetchLyric,
  chooseLyricCandidate,
} from "./player";
import { lyricQuery, lyricSourceNames } from "./lyric-matching";
import { trackKey } from "./library";
defineProps<{ compact?: boolean }>();
const expanded = ref(false);
const query = ref("");
watch(
  () => current.value && trackKey(current.value),
  () => {
    query.value = current.value ? lyricQuery(current.value) : "";
    expanded.value = false;
  },
  { immediate: true },
);
watch(
  () => lyricCandidates.value.length,
  (count) => {
    if (count && !lyric.value) expanded.value = true;
  },
);
watch(lyric, (value) => {
  if (value) expanded.value = false;
});
function search() {
  if (query.value.trim())
    void fetchLyric({ forceFallback: true, query: query.value.trim() });
}
function adjust(value: number) {
  lyricOffset.value =
    Math.round(Math.max(-30, Math.min(30, lyricOffset.value + value)) * 10) /
    10;
}
</script>
<template>
  <div v-if="current" class="lyric-tools" :class="{ compact }">
    <div class="lyric-tools-summary">
      <span v-if="lyricLoading" role="status"
        ><LoaderCircle :size="13" class="spin" />{{
          lyricPhase || "正在获取歌词"
        }}</span
      >
      <span v-else-if="lyricSourceLabel" :title="lyricMatchedTitle"
        >歌词：{{ lyricSourceLabel
        }}<small>{{
          lyricTimed ? "同步歌词" : "纯文本，无时间轴"
        }}</small></span
      >
      <span v-else>歌词网 / 歌词千寻</span>
      <button
        class="text-button"
        :aria-expanded="expanded"
        @click="expanded = !expanded"
      >
        {{ expanded ? "收起" : lyric ? "更换歌词" : "匹配歌词" }}
      </button>
    </div>
    <div v-if="lyric && lyricTimed" class="lyric-offset-controls">
      <span
        >歌词偏移 {{ lyricOffset > 0 ? "+" : ""
        }}{{ lyricOffset.toFixed(1) }}s</span
      >
      <button
        class="icon-button"
        aria-label="歌词延后0.5秒"
        title="歌词延后0.5秒"
        @click="adjust(-0.5)"
      >
        <Minus :size="13" />
      </button>
      <button
        class="icon-button"
        aria-label="歌词提前0.5秒"
        title="歌词提前0.5秒"
        @click="adjust(0.5)"
      >
        <Plus :size="13" />
      </button>
      <button
        class="icon-button"
        aria-label="重置歌词偏移"
        title="重置歌词偏移"
        @click="lyricOffset = 0"
      >
        <RotateCcw :size="12" />
      </button>
    </div>
    <div v-if="expanded" class="lyric-match-panel">
      <form @submit.prevent="search">
        <input
          v-model="query"
          :aria-label="compact ? '侧栏歌词关键词' : '歌词关键词'"
          maxlength="200"
          placeholder="歌曲名，可补充歌手"
        /><button :disabled="lyricLoading || !query.trim()" type="submit">
          <Search :size="14" />搜索
        </button>
      </form>
      <p v-if="lyricError" class="lyric-match-note" role="status">
        {{ lyricError }}
      </p>
      <p v-else-if="lyricCandidates.length" class="lyric-match-note">
        选择歌词版本，音乐继续播放
      </p>
      <div class="lyric-candidates">
        <button
          v-for="candidate in lyricCandidates"
          :key="`${candidate.source}:${candidate.id}`"
          :disabled="lyricLoading"
          @click="chooseLyricCandidate(candidate)"
        >
          <span
            ><strong>{{ candidate.title }}</strong
            ><small
              >{{ candidate.artist || "歌手未知" }} ·
              {{ lyricSourceNames[candidate.source] }}</small
            ></span
          ><small>{{
            candidate.exactMatch ? "名称与歌手匹配" : "手动确认"
          }}</small>
        </button>
      </div>
      <p
        v-for="failure in lyricFailures"
        :key="failure"
        class="lyric-match-note"
      >
        {{ failure }}
      </p>
    </div>
  </div>
</template>
