# Custom Music

本地自用音乐播放器：Vue 3 + TypeScript + Vite + Hono，macOS 可搭配 Swift 菜单栏歌词。音频由 Web 播放，Swift 只显示歌词，不重复播放。

## 环境要求

- Node.js **22.12+**（已在 Node.js 22.22.2 上验证）。
- pnpm **11.9.0**，版本由 `package.json` 固定。
- macOS 菜单栏歌词额外需要 Xcode 或 Xcode Command Line Tools；只使用 Web 时不需要 Swift。
- 以下命令适用于 macOS / Linux 终端；Swift 菜单栏功能仅在 macOS 启用。

## 首次运行

```sh
git clone git@github.com:Jasper-zzq/custom-music.git
cd custom-music

# 已有 pnpm 11.9.0 时可以跳过这两步
corepack enable
corepack prepare pnpm@11.9.0 --activate

pnpm install --frozen-lockfile
pnpm dev
```

如果系统未提供 Corepack，请先按 [Corepack 官方说明](https://github.com/nodejs/corepack#how-to-install)安装。项目只使用 pnpm，保留 `pnpm-lock.yaml`。

浏览器打开 **http://127.0.0.1:3210**。页面和 API 共用端口，仅监听本机，不需要单独启动后端。

停止：在启动终端按 **Ctrl+C**。

## 日常使用

```sh
pnpm build
pnpm start
```

macOS 也可以双击仓库中的 **`启动音乐.command`**：缺少依赖时自动安装，没有构建产物时自动构建，然后启动服务。若文件没有执行权限，先执行 `chmod +x 启动音乐.command`。

更新代码后先停止旧服务，再执行：

```sh
git pull
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

更新后刷新浏览器。启动脚本发现已有 `dist/` 时不会自动重新构建。

## Swift 菜单栏歌词

安装编译工具（已经安装 Xcode 或 Command Line Tools 可跳过）：

```sh
xcode-select --install
```

运行 `xcrun --find swiftc` 可以检查编译器是否可用。

- 启动 Web 服务后自动启动歌词小程序。首次编译，之后复用缓存；Swift 源码修改后，下次启动会重新编译。
- 当前歌词实时显示；没有同步歌词时显示歌名，暂停时显示暂停标记。
- 固定 **320pt** 宽度、文字左对齐，长句省略，悬停查看完整内容。位置由 macOS 管理，保存用户调整的位置。
- 点击菜单栏可打开播放器或单独退出歌词程序；不显示 Dock 图标。
- 停止 Web 服务时自动退出；服务异常结束时也会随管道关闭而退出。
- 关闭播放网页会清空歌词，Web 服务和菜单栏仍保留。异常连接未及时断开时，旧状态在约 90–105 秒后清空。
- 编译失败不影响 Web 播放。单独退出歌词程序后，下次启动 Web 服务会再次启动。

临时关闭菜单栏功能：

```sh
MUSIC_MENU_LYRICS=0 pnpm dev
# 或生产模式
MUSIC_MENU_LYRICS=0 pnpm start
```

## 基础使用

- 搜索歌曲、歌手、专辑或歌单；开启「并行搜索」后勾选参与搜索的音源。
- 点击歌曲播放；支持暂停、上下首、进度拖动、音量及列表循环等模式。
- 点击 ❤️ 加入「我爱听的」，支持自建歌单和 JSON 导入/导出。
- 播放页用封面作背景，显示滚动歌词。原源没有歌词时联动歌词网、歌词千寻；不确定的版本可以手动匹配，支持歌词时间微调。
- 支持导入本地音频、播放队列、排行榜、推荐歌单和来源标注。
- 「音源管理」显示搜索、播放和歌词等请求的实际状态。

当前启用 QQ、网易云、酷我、酷狗、咪咕、Audiomack、Bilibili、歌词网、歌词千寻、快手、猫耳 FM、音悦台、YouTube，共 13 个来源。其中两个歌词源只提供歌词；各来源支持的功能不同，以页面展示为准。

## 音源配置与数据

前五个 Huibq 音源默认使用 `https://lxmusicapi.onrender.com` 解析播放地址。**2026-10-30 实测该服务返回 503，搜索到歌曲不代表可以播放。** 可以在「设置 → 解析服务」填写兼容服务；其他独立音源使用各自的解析接口。本地音频不依赖在线解析服务。

初始解析服务也可以通过环境变量指定，已保存的设置优先：

```sh
MUSIC_API_URL=https://your-service.example MUSIC_API_KEY=your-key pnpm dev
```

环境变量由启动进程传入，不会自动读取 `.env` 文件。第三方接口可能失效、限流或要求平台授权，项目不保证每个资源均可播放。插件来源和修改记录见 [THIRD_PARTY.md](THIRD_PARTY.md)，运行时使用仓库内 `vendor/` 快照，无需另外下载 keep-alive。

| 数据 | 保存位置 |
| --- | --- |
| 歌单、收藏、队列、播放设置 | 浏览器 localStorage |
| 导入的本地音频 | 浏览器 IndexedDB |
| 解析服务设置及密钥 | `.local/settings.json` |
| Swift 编译缓存 | `.local/native/` |

`.local/`、依赖和构建产物不提交 Git。换浏览器、端口或主机名会使用不同的浏览器存储；建议固定使用 `127.0.0.1:3210`。清除网站数据前请导出备份；**JSON 备份不包含音频文件**。

## 常见问题

**`EADDRINUSE` / 3210 端口被占用**

通常是之前的服务仍在运行。先回到原启动终端按 Ctrl+C，或者继续使用已经运行的服务。需要另一个端口时使用 `PORT=3211 pnpm dev`，访问对应端口；浏览器中的歌单数据不会自动迁移。

**`ECONNRESET` / `Error: aborted`**

表示网络连接中途断开。切歌、拖动进度或关闭网页时可能是旧请求取消；若伴随播放中断，重试歌曲或切换来源。只有堆栈不能确定具体请求，结合页面状态判断。

**菜单栏没有歌词**

确认终端已显示 Swift 启动成功，浏览器已刷新，歌曲存在带时间轴的歌词。编译报错时检查 `xcrun --find swiftc`；源码更新后需要重启服务。菜单栏空间不足时，macOS 可能隐藏状态项。

## 开发检查

```sh
pnpm test
pnpm build
```

`src/` 为前端和播放器，`server/` 为本地 API 与音源适配，`shared/` 为来源定义，`native/MenuLyrics/` 为 Swift 菜单栏程序，`tests/` 为回归测试。
