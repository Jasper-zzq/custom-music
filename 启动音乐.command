#!/bin/zsh -l
set -e
cd "${0:A:h}"
if ! command -v pnpm >/dev/null 2>&1; then
  echo '未找到 pnpm，请先通过 Corepack 启用 pnpm。'
  read -r '?按回车退出'
  exit 1
fi
if [[ ! -d node_modules ]]; then
  pnpm install --frozen-lockfile
fi
if [[ ! -f dist/index.html ]]; then
  pnpm build
fi
printf '打开 http://127.0.0.1:3210\n关闭此窗口或按 Ctrl+C 停止服务。\n'
pnpm start
