@echo off
setlocal

rem 이 스크립트는 저장소 루트의 .env와 docker/dev Compose 파일을 사용한다.
for %%I in ("%~dp0..\..") do set "REPO_ROOT=%%~fI"
cd /d "%REPO_ROOT%"

if not exist ".env" (
  echo Error: .env is missing. Copy .env.sample to .env and set local values.
  exit /b 1
)

docker info >nul 2>&1
if errorlevel 1 (
  echo Error: Docker daemon is not available.
  exit /b 1
)

docker network inspect shared-net >nul 2>&1
if errorlevel 1 docker network create shared-net >nul
if errorlevel 1 exit /b 1

docker compose --env-file "%REPO_ROOT%\.env" -f docker/dev/docker-compose.yml up --build -d
exit /b %errorlevel%
