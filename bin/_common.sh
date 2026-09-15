#!/usr/bin/env bash
# Shared bootstrap for every bin/ script. Sourced, never run directly.
#
# Why this exists at all: every operational task in this repo goes through
# bin/, and every one of them needs the same three things — a repo root that is
# DERIVED rather than hardcoded, a node binary that resolves without an
# interactive shell, and whatever .env happens to be present. Duplicating that
# across eight scripts is how one of them drifts.
set -euo pipefail

# Derived, never hardcoded. A hardcoded root is a recorded incident in this
# tree: the repo gets moved or worktree'd and every script silently operates on
# the wrong directory.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export ROOT

SERVICE_NAME="velo"
export SERVICE_NAME

# Resolve node without depending on an interactive shell (systemd has no nvm).
if [[ -x "$ROOT/.node-path" ]]; then
  NODE="$ROOT/.node-path"
elif [[ -f "$ROOT/.node-path" ]]; then
  NODE="$(cat "$ROOT/.node-path")"
elif command -v node >/dev/null 2>&1; then
  NODE="$(command -v node)"
else
  NODE="$(ls -d /home/hexi/.nvm/versions/node/*/bin/node 2>/dev/null | sort -V | tail -1 || true)"
fi
if [[ -z "${NODE:-}" || ! -x "$NODE" ]]; then
  echo "velo: could not find a node binary. Put an absolute path in $ROOT/.node-path" >&2
  exit 1
fi
export NODE

NPM="$(dirname "$NODE")/npm"
[[ -x "$NPM" ]] || NPM="$(command -v npm)"
export NPM

# Velo needs no secrets. This block is here so that adding one later is a
# one-file change: cush-tools/bin/inject is only invoked when a real
# .cush-secrets manifest exists, so a secret-free project simply never creates
# the file and this is a no-op. If secrets ever arrive they are Infisical
# inf:// refs; op:// is legacy and must not be introduced.
if [[ -f "$ROOT/.cush-secrets" && -x /home/hexi/local/src/cush-tools/bin/inject ]]; then
  eval "$(/home/hexi/local/src/cush-tools/bin/inject --env 2>/dev/null || true)"
fi
if [[ -f "$ROOT/.env" ]]; then
  set -a; . "$ROOT/.env"; set +a
fi

# Install dependencies on first use rather than making every script fail with a
# module-not-found stack trace. Keyed on the directory existing, not on a
# lockfile diff — npm ci is the deploy path's job, not the dev path's.
ensure_deps() {
  if [[ ! -d "$ROOT/node_modules" ]]; then
    echo "==> node_modules missing, installing"
    # --include=dev explicitly: a shell (or a systemd unit) with NODE_ENV=production
    # makes npm silently omit devDependencies and then report "up to date" with
    # an empty node_modules, which costs twenty minutes the first time you see it.
    (cd "$ROOT" && "$NPM" install --include=dev --no-audit --no-fund)
  fi
}
