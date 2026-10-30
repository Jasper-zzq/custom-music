import { spawn, type ChildProcess } from "node:child_process";
import { access, copyFile, mkdir, readFile, rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { menuLyricsState } from "./menu-lyrics-state.js";

export function nativeLyricsPlatform(platform: NodeJS.Platform, disabled?: string) {
  if (disabled === "0") return null;
  return platform === "darwin" ? "macos" : platform === "win32" ? "windows" : null;
}

async function windowsCompiler() {
  const windows = process.env.SystemRoot || process.env.WINDIR || "C:\\Windows";
  for (const framework of ["Framework64", "Framework"]) {
    const compiler = win32.join(windows, "Microsoft.NET", framework, "v4.0.30319", "csc.exe");
    try { await access(compiler); return compiler; } catch { /* Try the other architecture. */ }
  }
  throw new Error("未找到 Windows .NET Framework C# 编译器，请启用或修复 .NET Framework 4.8；Web 可继续使用");
}

export function startMenuLyrics(port: number) {
  const platform = nativeLyricsPlatform(process.platform, process.env.MUSIC_MENU_LYRICS);
  if (!platform) return;
  const label = platform === "macos" ? "Swift 菜单栏歌词" : "Windows 悬浮歌词";
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
  async function compile(command: string, args: string[]) {
    console.log(`正在编译 ${label}（首次启动或源码更新）…`);
    await new Promise<void>((resolve, reject) => {
      compiler = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      let error = "";
      const capture = (chunk: Buffer) => { error = (error + chunk.toString()).slice(-4000); };
      compiler.stdout?.on("data", capture);
      compiler.stderr?.on("data", capture);
      compiler.once("error", reject);
      compiler.once("exit", (code) => code === 0 ? resolve() : reject(new Error(error || `${label}编译失败`)));
    });
    compiler = undefined;
  }
  void (async () => {
    const files = platform === "macos"
      ? ["MenuLyrics/main.swift", "MenuLyrics/Info.plist"]
      : ["WindowsLyrics/Program.cs", "WindowsLyrics/app.manifest"];
    const [source, metadata] = files.map((name) => fileURLToPath(new URL(`../native/${name}`, import.meta.url)));
    const hash = createHash("sha256").update(await readFile(source)).update(await readFile(metadata))
      .update(process.arch).digest("hex").slice(0, 16);
    const directory = platform === "macos"
      ? fileURLToPath(new URL(`../.local/native/${hash}/MusicLyrics.app/Contents/`, import.meta.url))
      : fileURLToPath(new URL(`../.local/native/windows-${process.arch}/${hash}/`, import.meta.url));
    const executable = join(directory, platform === "macos" ? "MacOS/MusicLyrics" : "MusicLyrics.exe");
    await mkdir(dirname(executable), { recursive: true });
    try { await access(executable); } catch {
      if (stopped) return;
      const temporary = `${executable}.${process.pid}.tmp`;
      if (platform === "macos") {
        await compile("/usr/bin/xcrun", ["swiftc", "-O", "-framework", "AppKit", source, "-o", temporary]);
      } else {
        const csc = await windowsCompiler();
        if (stopped) return;
        const framework = dirname(csc);
        const references = ["System.dll", "System.Core.dll", "System.Xaml.dll", "System.Web.Extensions.dll",
          "System.Windows.Forms.dll", "System.Drawing.dll", "WPF/WindowsBase.dll",
          "WPF/PresentationCore.dll", "WPF/PresentationFramework.dll"];
        await compile(csc, ["/nologo", "/target:winexe", "/platform:anycpu", "/optimize+", "/utf8output",
          `/out:${temporary}`, `/win32manifest:${metadata}`,
          ...references.map((name) => `/reference:${join(framework, name)}`), source]);
      }
      if (stopped) return;
      await rename(temporary, executable);
    }
    if (stopped) return;
    if (platform === "macos") await copyFile(metadata, join(directory, "Info.plist"));
    if (stopped) return;
    child = spawn(executable, [`http://127.0.0.1:${port}`], {
      stdio: ["pipe", "ignore", "pipe"], windowsHide: true,
    });
    child.stdin!.on("error", () => {});
    child.stderr?.on("data", (chunk) => process.stderr.write(chunk));
    child.once("error", (error) => {
      unsubscribe(); clearInterval(expiry);
      console.warn(`${label}启动失败：`, error.message);
    });
    child.once("spawn", () => console.log(`${label}已启动；停止 Web 服务时自动退出。`));
    child.once("exit", (code) => {
      unsubscribe(); clearInterval(expiry);
      if (!stopped && code) console.warn(`${label}异常退出（${code}），Web 可继续使用。`);
    });
    unsubscribe = menuLyricsState.subscribe((state) => {
      if (!child?.stdin?.destroyed) child?.stdin?.write(`${JSON.stringify(state)}\n`);
    });
  })().catch((error) => {
    clearInterval(expiry);
    if (!stopped) console.warn(`${label}不可用，Web 仍可使用：`, error.message);
  });
}
