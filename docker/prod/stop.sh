#!/usr/bin/env bash
# production 컨테이너를 내리되 Catalog 업로드 volume은 보존한다.
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

docker compose --env-file "$REPO_ROOT/.env" -f docker/prod/docker-compose.yml down
