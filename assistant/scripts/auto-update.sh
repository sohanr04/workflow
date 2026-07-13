#!/usr/bin/env bash
# Winston auto-updater — pulls new commits from the branch and restarts him.
# Runs as its own pm2 process; loops every 2 min. Never pushes anything.
#
#   pm2 start ~/workflow/assistant/scripts/auto-update.sh --name winston-updater --interpreter bash
#   pm2 save
#
# How it avoids the "local changes would be overwritten" wall: Winston edits
# his own memory files while running (tracked in git), which normally blocks a
# pull. Each cycle we first COMMIT his edits locally (so nothing he learned is
# lost), then MERGE the remote with -X theirs (a pushed change wins on the rare
# same-line clash; everything Winston added independently survives). On any
# conflict it can't resolve, it aborts cleanly and retries next cycle — it
# never leaves the repo half-merged, and it never touches .env / mcp.json /
# state (those are git-ignored).

set -u
BRANCH="claude/free-laptop-8rzh36"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
INTERVAL="${WINSTON_UPDATE_INTERVAL:-120}"

cd "$REPO" || { echo "auto-update: cannot cd to $REPO"; exit 1; }
# Ensure a committer identity exists for the local autosave commits.
git config user.email >/dev/null 2>&1 || git config user.email "winston@local"
git config user.name  >/dev/null 2>&1 || git config user.name  "Winston"

echo "$(date '+%F %T') auto-update watching $BRANCH in $REPO (every ${INTERVAL}s)"

while true; do
  git fetch -q origin "$BRANCH" 2>/dev/null
  local_head="$(git rev-parse HEAD 2>/dev/null)"
  remote_head="$(git rev-parse "origin/$BRANCH" 2>/dev/null)"

  if [ -n "$remote_head" ] && [ "$local_head" != "$remote_head" ]; then
    echo "$(date '+%F %T') new commits upstream — updating"
    # 1) capture Winston's live memory edits so the merge can't discard them
    git add -A 2>/dev/null
    git commit -q -m "winston: memory autosave" 2>/dev/null || true
    # 2) bring in the remote; pushed changes win any same-line conflict
    if git merge -q -X theirs -m "auto-merge origin/$BRANCH" "origin/$BRANCH" 2>/dev/null; then
      pm2 restart winston --update-env >/dev/null 2>&1
      echo "$(date '+%F %T') updated -> $(git rev-parse --short HEAD); restarted winston"
    else
      git merge --abort 2>/dev/null
      echo "$(date '+%F %T') merge could not auto-resolve — aborted, will retry"
    fi
  fi
  sleep "$INTERVAL"
done
