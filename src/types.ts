export interface Track {
  id: string | number;
  source: string;
  title: string;
  artist?: string;
  album?: string;
  artwork?: string;
  duration?: number;
  songmid?: string;
  local?: boolean;
  [key: string]: any;
}
export interface Playlist {
  id: string;
  name: string;
  tracks: Track[];
}
export interface SourceActivity {
  state: "loading" | "ok" | "error" | "unconfigured";
  message: string;
  updatedAt: number;
  elapsedMs?: number;
  count?: number;
}
export interface Provider {
  id: string;
  name: string;
  pluginName: string;
  version: string;
  searchTypes: string[];
  capabilities: string[];
  hints: string[];
  kind: string;
  author: string;
  pluginUrl: string;
  playbackService: string;
  playable: boolean;
  configured: boolean;
  missingConfig: string[];
  loadError?: string;
  configFields: {
    key: string;
    name: string;
    type: string;
    required: boolean;
  }[];
  activities: Partial<
    Record<"search" | "play" | "lyric" | "check" | "browse", SourceActivity>
  >;
}
export interface Library {
  version: 1;
  playlists: Playlist[];
  queue: Track[];
  volume: number;
  mode: string;
  quality: string;
}
