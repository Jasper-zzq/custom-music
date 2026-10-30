import { watch } from "vue";
import type { MenuLyricsState } from "../server/menu-lyrics-state";

export function connectMenuLyrics(read: () => MenuLyricsState) {
  if (typeof window === "undefined") return () => {};
  const owner = crypto.randomUUID();
  let revision = 0;
  let closed = false;
  let sending = false;
  let pending: string | undefined;
  const encode = (state: MenuLyricsState) => JSON.stringify({
    ...state, owner, revision: ++revision, sentAt: Date.now(),
  });
  async function drain() {
    if (sending || closed) return;
    sending = true;
    try {
      while (pending && !closed) {
        const body = pending;
        pending = undefined;
        try {
          await fetch("/api/menu-lyrics", {
            method: "POST", headers: { "Content-Type": "application/json" }, body,
            signal: AbortSignal.timeout(4000),
          });
        } catch { /* The next state change or heartbeat retries after a service restart. */ }
      }
    } finally { sending = false; }
  }
  function send() {
    pending = encode(read());
    void drain();
  }
  function clear() {
    pending = undefined;
    const body = encode({ title: "", artist: "", line: "", playing: false });
    // A higher revision makes any in-flight request harmless after this beacon.
    navigator.sendBeacon("/api/menu-lyrics", new Blob([body], { type: "application/json" }));
  }
  const connection = new EventSource(`/api/menu-lyrics/connection?owner=${encodeURIComponent(owner)}`);
  connection.onopen = send;
  const unwatch = watch(read, send, { immediate: true });
  const heartbeat = window.setInterval(() => {
    if (read().title) send();
  }, 15000);
  window.addEventListener("pagehide", clear);
  window.addEventListener("pageshow", send);
  return () => {
    closed = true;
    unwatch();
    connection.close();
    window.clearInterval(heartbeat);
    window.removeEventListener("pagehide", clear);
    window.removeEventListener("pageshow", send);
    clear();
  };
}
