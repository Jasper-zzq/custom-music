@echo off
setlocal
pushd "%~dp0" || exit /b 1
where pnpm >nul 2>nul
if errorlevel 1 (
  echo pnpm not found. Enable pnpm with Corepack first.
  goto failed
)
if not exist node_modules (
  call pnpm install --frozen-lockfile
  if errorlevel 1 goto failed
)
if not exist dist\index.html (
  call pnpm build
  if errorlevel 1 goto failed
)
if not defined PORT set "PORT=3210"
echo Open http://127.0.0.1:%PORT%
echo Press Ctrl+C or close this window to stop the service and lyrics.
call pnpm start
if errorlevel 1 goto failed
popd
exit /b 0
:failed
echo Startup failed. Check the error above.
pause
popd
exit /b 1
