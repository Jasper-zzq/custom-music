export interface MenuLyricsState {
  title: string;
  artist: string;
  line: string;
  playing: boolean;
}
const empty = (): MenuLyricsState => ({ title: "", artist: "", line: "", playing: false });

// A paused/closing background tab must never erase the active tab's lyrics.
export function createMenuLyricsState(now = Date.now) {
  let state = empty();
  let owner = "";
  let updated = 0;
  let lastPlayingAt = 0;
  const revisions = new Map<string, number>();
  const connections = new Map<string, symbol | null>();
  const listeners = new Set<(value: MenuLyricsState) => void>();
  const publish = () => listeners.forEach((listener) => listener({ ...state }));
  return {
    read: () => ({ ...state }),
    connect(client: string) {
      const connection = Symbol();
      connections.set(client, connection);
      // Keep recent disconnected owners to reject their late HTTP requests.
      if (connections.size > 100)
        for (const [key, value] of connections)
          if (value === null) { connections.delete(key); break; }
      return () => {
        if (connections.get(client) !== connection) return;
        connections.set(client, null);
        if (owner === client) {
          owner = "";
          state = empty();
          publish();
        }
      };
    },
    subscribe(listener: (value: MenuLyricsState) => void) {
      listeners.add(listener);
      listener({ ...state });
      return () => { listeners.delete(listener); };
    },
    update(input: unknown) {
      if (!input || typeof input !== "object") return false;
      const value = input as Record<string, unknown>;
      if (typeof value.owner !== "string" || !value.owner || value.owner.length > 100 ||
          !Number.isSafeInteger(value.revision) || Number(value.revision) < 1 ||
          typeof value.sentAt !== "number" || !Number.isFinite(value.sentAt) ||
          Math.abs(now() - value.sentAt) > 120000 ||
          typeof value.playing !== "boolean" ||
          ["title", "artist", "line"].some((key) => typeof value[key] !== "string" || String(value[key]).length > 2000)) return false;
      if (Number(value.revision) <= (revisions.get(value.owner) || 0)) return true;
      if (connections.get(value.owner) === null) return true;
      if (revisions.size >= 100 && !revisions.has(value.owner))
        revisions.delete(revisions.keys().next().value!);
      revisions.set(value.owner, Number(value.revision));
      if (value.playing) {
        if (value.sentAt < lastPlayingAt) return true;
        lastPlayingAt = value.sentAt;
      } else if (owner && owner !== value.owner) return true;
      owner = value.owner;
      updated = now();
      const clean = (key: string) => String(value[key]).replace(/[\r\n\t]/g, " ").trim();
      const next = { title: clean("title"), artist: clean("artist"), line: clean("line"), playing: value.playing };
      const changed = JSON.stringify(state) !== JSON.stringify(next);
      state = next;
      if (changed) publish();
      return true;
    },
    expire() {
      if (owner && now() - updated > 90000) {
        owner = "";
        state = empty();
        publish();
      }
    },
  };
}
export const menuLyricsState = createMenuLyricsState();
