#!/usr/bin/env bash
set -euo pipefail

REPO="/volume1/1 TB SSD RAID1 M.2/GOVis"
BRANCH="main"
LOG_TAG="[govis-auto-update]"

cd "$REPO"

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "$(date -Is) $LOG_TAG skip: working tree has local tracked changes"
  exit 0
fi

git fetch origin "$BRANCH" --quiet
LOCAL_HEAD="$(git rev-parse HEAD)"
REMOTE_HEAD="$(git rev-parse "origin/$BRANCH")"

if [[ "$LOCAL_HEAD" == "$REMOTE_HEAD" ]]; then
  echo "$(date -Is) $LOG_TAG no changes"
  exit 0
fi

echo "$(date -Is) $LOG_TAG update detected: $LOCAL_HEAD -> $REMOTE_HEAD"
git pull --ff-only origin "$BRANCH"
docker compose up -d --build

echo "$(date -Is) $LOG_TAG deployed $REMOTE_HEAD"
