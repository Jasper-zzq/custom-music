/** Exclusive playback between same-origin tabs. The audio stops before releasing the lock. */
interface Claim {
  owner: string;
  at: number;
}
interface FocusPlatform {
  channel?: Pick<BroadcastChannel, "postMessage" | "close" | "onmessage">;
  locks?: Pick<LockManager, "request">;
  id?: string;
  now?: () => number;
}
function browserPlatform(): FocusPlatform {
  if (typeof window === "undefined") return {};
  return {
    channel:
      typeof BroadcastChannel === "undefined"
        ? undefined
        : new BroadcastChannel("music-web:playback"),
    locks: navigator.locks,
  };
}
const newer = (a: Claim, b: Claim) =>
  a.at > b.at || (a.at === b.at && a.owner > b.owner);
export function createPlaybackFocus(
  onLost: () => void,
  platform = browserPlatform(),
) {
  const { channel, locks } = platform;
  const id = platform.id || crypto.randomUUID();
  const now = platform.now || Date.now;
  let latest: Claim = { owner: "", at: 0 };
  let mine: Claim | null = null;
  let pending: AbortController | undefined;
  let unlock: (() => void) | undefined;
  let disposed = false;
  function release() {
    mine = null;
    pending?.abort();
    pending = undefined;
    const finish = unlock;
    unlock = undefined;
    finish?.();
  }
  if (channel)
    channel.onmessage = (event) => {
      const claim = event.data as Claim;
      if (
        !claim ||
        typeof claim.owner !== "string" ||
        !Number.isFinite(claim.at) ||
        claim.owner === id ||
        !newer(claim, latest)
      )
        return;
      latest = claim;
      if (mine && newer(claim, mine)) {
        try {
          onLost();
        } finally {
          release();
        }
      }
    };
  function claim() {
    release();
    if (disposed) return null;
    mine = { owner: id, at: Math.max(now(), latest.at + 1) };
    latest = mine;
    channel?.postMessage(mine);
    return mine;
  }
  function acquire(ticket: Claim | null): Promise<boolean> {
    if (disposed || !ticket || mine !== ticket) return Promise.resolve(false);
    if (!locks) return Promise.resolve(true);
    const controller = new AbortController();
    pending = controller;
    return new Promise<boolean>((ready) => {
      void locks
        .request(
          "music-web:audio",
          { mode: "exclusive", signal: controller.signal },
          async () => {
            if (disposed || mine !== ticket) {
              ready(false);
              return;
            }
            await new Promise<void>((resolve) => {
              unlock = resolve;
              ready(true);
            });
          },
        )
        .catch(() => ready(false))
        .finally(() => {
          if (pending === controller) pending = undefined;
        });
    });
  }
  function dispose() {
    disposed = true;
    release();
    if (channel) {
      channel.onmessage = null;
      channel.close();
    }
  }
  return { claim, acquire, release, dispose };
}
