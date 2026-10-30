export type Operation = "search" | "play" | "lyric" | "check" | "browse";
export interface Activity {
  state: "loading" | "ok" | "error" | "unconfigured";
  message: string;
  updatedAt: number;
  elapsedMs?: number;
  count?: number;
}
const activities: Record<string, Partial<Record<Operation, Activity>>> = {};
const revisions = new Map<string, number>();
const listeners = new Set<() => void>();
export const sourceActivities = (id: string) => activities[id] || {};
export function subscribeStatus(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function updateStatus(
  id: string,
  operation: Operation,
  status: Omit<Activity, "updatedAt">,
) {
  activities[id] ||= {};
  activities[id][operation] = { ...status, updatedAt: Date.now() };
  for (const listener of listeners) listener();
}
export function startOperation(id: string, operation: Operation) {
  const key = `${id}:${operation}`;
  const version = (revisions.get(key) || 0) + 1;
  revisions.set(key, version);
  const started = Date.now();
  updateStatus(id, operation, { state: "loading", message: "请求中" });
  return (status: Omit<Activity, "updatedAt" | "elapsedMs">) => {
    if (revisions.get(key) === version)
      updateStatus(id, operation, {
        ...status,
        elapsedMs: Date.now() - started,
      });
  };
}
