import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { getRequestListener } from "@hono/node-server";
import { createServer } from "node:http";
import { app } from "./app.js";
import { fileURLToPath } from "node:url";
import { startMenuLyrics } from "./menu-lyrics-native.js";
process.chdir(fileURLToPath(new URL("..", import.meta.url)));
const port = Number(process.env.PORT || 3210);
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
  process.once(signal, () => process.exit(0));
function onListening() {
  console.log(`Music Web: http://127.0.0.1:${port}`);
  startMenuLyrics(port);
}
if (process.env.NODE_ENV === "production") {
  app.use("/*", serveStatic({ root: "./dist" }));
  serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, onListening);
} else {
  const { createServer: createVite } = await import("vite");
  const server = createServer();
  const vite = await createVite({
    server: { middlewareMode: true, hmr: { server } },
    appType: "spa",
  });
  const api = getRequestListener(app.fetch);
  server.on("request", (req, res) => {
    if (req.url?.startsWith("/api/")) void api(req, res);
    else vite.middlewares(req, res);
  });
  server.listen(port, "127.0.0.1", onListening);
}
