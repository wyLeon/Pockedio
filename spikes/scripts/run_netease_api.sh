#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cache_dir="${POCKEDIO_NPM_CACHE:-"$repo_root/.cache/npm"}"
mkdir -p "$cache_dir"

echo "Using npm cache: $cache_dir"
NPM_CONFIG_CACHE="$cache_dir" npx -y NeteaseCloudMusicApi@latest
