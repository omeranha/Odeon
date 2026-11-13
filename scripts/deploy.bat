@echo off
rem Copies the local project to the server and rebuilds the Odeon container there.
rem The server keeps its own .env, docker-compose.yml and data/; they are never overwritten.
rem Create scripts\deploy.local.bat (not committed) with: set "SERVER=user@host"
rem It can also set REMOTE_DIR (default docker/odeon, relative to the server's home), CONTAINER (default odeon) and URL.
setlocal

set "REMOTE_DIR=docker/odeon"
set "CONTAINER=odeon"
set "URL="
if exist "%~dp0deploy.local.bat" call "%~dp0deploy.local.bat"
if not defined SERVER (
  echo Set SERVER in scripts\deploy.local.bat, for example: set "SERVER=user@host"
  exit /b 1
)

set "ROOT=%~dp0.."
set "ARCHIVE=%TEMP%\odeon-src.tar.gz"

echo Packing project...
if exist "%ARCHIVE%" del "%ARCHIVE%"
tar.exe -czf "%ARCHIVE%" --exclude=./node_modules --exclude=./server/node_modules --exclude=./dist --exclude=./dev-dist --exclude=./.git --exclude=./.notes --exclude=./.env --exclude=./.env.local --exclude=./server/.env --exclude=./.vscode --exclude=./data --exclude=./android -C "%ROOT%" .
if errorlevel 1 goto :failed

echo Uploading to %SERVER%...
scp -o BatchMode=yes "%ARCHIVE%" %SERVER%:/tmp/odeon-src.tar.gz
if errorlevel 1 goto :failed

echo Deploying...
ssh -o BatchMode=yes %SERVER% "tr -d '\r' | bash -s -- %REMOTE_DIR% %CONTAINER%" < "%~dp0deploy-remote.sh"
if errorlevel 1 goto :failed

del "%ARCHIVE%"
if defined URL (echo Done. Odeon is at %URL%) else (echo Done.)
exit /b 0

:failed
echo Deploy failed.
exit /b 1