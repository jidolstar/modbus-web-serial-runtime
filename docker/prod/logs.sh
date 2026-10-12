#!/usr/bin/env bash
# Backend와 Frontend의 production 로그를 함께 따라간다.
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

docker compose --env-file "$REPO_ROOT/.env" -f docker/prod/docker-compose.yml logs --follow --tail=100 frontend backend
