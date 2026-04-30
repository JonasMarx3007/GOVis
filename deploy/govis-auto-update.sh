#!/usr/bin/env bash
set -euo pipefail

REPO="/volume1/1 TB SSD RAID1 M.2/GOVis"
BRANCH="main"
LOG_TAG="[govis-auto-update]"
LOCK_DIR="${TMPDIR:-/tmp}/govis-auto-update.lock"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  if [[ -f "$LOCK_DIR/pid" ]] && kill -0 "$(cat "$LOCK_DIR/pid")" 2>/dev/null; then
    echo "$(date -Is) $LOG_TAG skip: another update is already running"
    exit 0
  fi
  rm -rf "$LOCK_DIR"
  mkdir "$LOCK_DIR"
fi
echo "$$" > "$LOCK_DIR/pid"
trap 'rm -f "$LOCK_DIR/pid"; rmdir "$LOCK_DIR"' EXIT

if [[ ! -d "$REPO/.git" ]]; then
  echo "$(date -Is) $LOG_TAG error: repository not found at $REPO"
  exit 1
fi

cd "$REPO"

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "$(date -Is) $LOG_TAG skip: working tree has local tracked changes"
  exit 0
fi

if ! git fetch --prune origin "$BRANCH" --quiet; then
  echo "$(date -Is) $LOG_TAG error: git fetch failed"
  exit 1
fi
LOCAL_HEAD="$(git rev-parse HEAD)"
REMOTE_REF="origin/$BRANCH"
REMOTE_HEAD="$(git rev-parse "$REMOTE_REF")"

if [[ "$LOCAL_HEAD" == "$REMOTE_HEAD" ]]; then
  echo "$(date -Is) $LOG_TAG no changes"
  exit 0
fi

echo "$(date -Is) $LOG_TAG update detected: $LOCAL_HEAD -> $REMOTE_HEAD"
git reset --hard "$REMOTE_REF"
docker compose up -d --build --remove-orphans

echo "$(date -Is) $LOG_TAG deployed $REMOTE_HEAD"
