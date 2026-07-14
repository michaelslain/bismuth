#!/usr/bin/env bash
# done-cleanup.sh — hands-off cleanup when a card is confirmed Done (idea R).
# Given a card slug, kills its preview server (if any), removes its preview
# worktree, and regenerates the changelog. The operator still removes the card
# file itself (the one irreversible board write) after this runs.
#
# Usage: scripts/done-cleanup.sh <preview-slug> [core_port] [vite_port]
#        e.g. scripts/done-cleanup.sh kanban 4334 1434
set -u
cd "$(git rev-parse --show-toplevel)" || exit 2
slug="${1:-}"; pc="${2:-}"; pv="${3:-}"
[ -z "$slug" ] && { echo "usage: done-cleanup.sh <preview-slug> [core_port] [vite_port]" >&2; exit 1; }

# 1) kill preview servers on the given ports (if provided)
for p in "$pc" "$pv"; do
  [ -n "$p" ] && lsof -ti tcp:"$p" 2>/dev/null | xargs kill -9 2>/dev/null && echo "  killed port $p"
done

# 2) remove the preview worktree if present
wt=".claude/worktrees/preview-$slug"
if [ -d "$wt" ]; then
  git worktree remove --force "$wt" 2>/dev/null || rm -rf "$wt"
  git worktree prune
  echo "  removed worktree $wt"
fi

# 3) sweep any fully-merged worktrees + branches
scripts/gc-worktrees.sh --run >/dev/null 2>&1 && echo "  gc-worktrees swept"

# 4) refresh the shipped changelog
if [ -x scripts/shipped-log.sh ]; then
  scripts/shipped-log.sh --write >/dev/null 2>&1 && echo "  changelog refreshed (docs/bismuth-changes-shipped.md)"
fi

echo "done-cleanup complete for '$slug'. Operator: remove the card file to finish."
