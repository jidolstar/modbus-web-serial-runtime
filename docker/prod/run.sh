#!/usr/bin/env bash
# 저장소 루트의 운영 설정으로 이미지를 빌드하고 기동한 뒤 migration을 적용한다.
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

if [[ ! -f .env ]]; then
  echo "오류: .env 파일이 없습니다. .env.sample을 복사하고 운영값을 설정하세요." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "오류: Docker daemon에 연결할 수 없습니다." >&2
  exit 1
fi

# Compose에서 참조하는 외부 네트워크를 최초 실행 때 준비한다.
if ! docker network inspect shared-net >/dev/null 2>&1; then
  docker network create shared-net >/dev/null
fi

docker compose --env-file "$REPO_ROOT/.env" -f docker/prod/docker-compose.yml up --build -d
docker compose --env-file "$REPO_ROOT/.env" -f docker/prod/docker-compose.yml exec -T backend node dist/database/migrate-cli.js up
