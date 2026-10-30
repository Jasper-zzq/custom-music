import { spawn, type ChildProcess } from "node:child_process";
import { copyFile, mkdir, readFile, rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { menuLyricsState } from "./menu-lyrics-state.js";

export function startMenuLyrics(port: number) {
  if (process.platform !== "darwin" || process.env.MUSIC_MENU_LYRICS === "0") return;
  let child: ChildProcess | undefined;
  let compiler: ChildProcess | undefined;
  let stopped = false;
  let unsubscribe = () => {};
  const expiry = setInterval(() => menuLyricsState.expire(), 15000);
  expiry.unref();
  const stop = () => {
    stopped = true;
    clearInterval(expiry);
    unsubscribe();
    compiler?.kill();
    child?.stdin?.end();
    child?.kill();
  };
  process.once("exit", stop);
  void (async () => {
    const source = fileURLToPath(new URL("../native/MenuLyrics/main.swift", import.meta.url));
    const plist = fileURLToPath(new URL("../native/MenuLyrics/Info.plist", import.meta.url));
    const hash = createHash("sha256").update(await readFile(source)).update(await readFile(plist))
      .update(process.arch).digest("hex").slice(0, 16);
    const contents = fileURLToPath(new URL(`../.local/native/${hash}/MusicLyrics.app/Contents/`, import.meta.url));
    const executable = `${contents}MacOS/MusicLyrics`;
    await mkdir(`${contents}MacOS`, { recursive: true });
    try { await readFile(executable); } catch {
      if (stopped) return;
      console.log("正在编译 Swift 菜单栏歌词（首次启动）…");
      const temporary = `${executable}.${process.pid}`;
      await new Promise<void>((resolve, reject) => {
        compiler = spawn("/usr/bin/xcrun", ["swiftc", "-O", "-framework", "AppKit", source, "-o", temporary], {
          stdio: ["ignore", "ignore", "pipe"],
        });
        let error = "";
        compiler.stderr?.on("data", (chunk) => { error = (error + chunk).slice(-4000); });
        compiler.once("error", reject);
        compiler.once("exit", (code) => code === 0 ? resolve() : reject(new Error(error || "Swift 编译失败")));
      });
      compiler = undefined;
      if (stopped) return;
      await rename(temporary, executable);
    }
    if (stopped) return;
    await copyFile(plist, `${contents}Info.plist`);
    if (stopped) return;
    child = spawn(executable, [`http://127.0.0.1:${port}`], { stdio: ["pipe", "ignore", "pipe"] });
    child.stdin!.on("error", () => {});
    child.stderr?.on("data", (chunk) => process.stderr.write(chunk));
    child.once("error", (error) => console.warn("菜单栏歌词启动失败：", error.message));
    child.once("exit", () => { unsubscribe(); clearInterval(expiry); });
    unsubscribe = menuLyricsState.subscribe((state) => {
      if (!child?.stdin?.destroyed) child?.stdin?.write(`${JSON.stringify(state)}\n`);
    });
    console.log("Swift 菜单栏歌词已启动；停止 Web 服务时自动退出。");
  })().catch((error) => {
    clearInterval(expiry);
    if (!stopped) console.warn("菜单栏歌词不可用，Web 仍可使用：", error.message);
  });
}
