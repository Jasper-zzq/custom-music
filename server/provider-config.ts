import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
const path = new URL("../.local/providers.json", import.meta.url);
let values: Record<string, Record<string, string>> = {};
try {
  values = JSON.parse(readFileSync(path, "utf8"));
} catch {
  /* New installation. */
}
export function getProviderConfig(id: string) {
  return values[id] || {};
}
export async function saveProviderConfig(
  id: string,
  value: Record<string, string>,
) {
  const next = { ...values, [id]: value };
  await mkdir(new URL("../.local/", import.meta.url), { recursive: true });
  await writeFile(path, JSON.stringify(next), { mode: 0o600 });
  values = next;
}
