#!/usr/bin/env bash
# merge-card.sh — the gated merge. Fails CLOSED and auto-reverts a red merge.
#
# WHY THIS EXISTS: "the review must say isReal before you merge" and "the merge stays
# only if the regression guard is GREEN" were prose rules, which means they were two
# judgement calls made by a tired operator at the end of a long lane. One refuted
# build nearly shipped because isReal:false is easy to skim past. Here the review
# verdict is PARSED, not read, and a red guard rolls the merge back automatically —
# main cannot be left broken by walking away.
#
#   merge-card.sh <branch> --review <review.json>   [--card <card>]
#
# review.json is the lane's adversarial review: { "isReal": bool, "blocking": [...] }
# Missing/malformed/refuted review => refuse. No review flag => refuse.
# Exit 0 = merged and GREEN (still unpushed — push + set landed yourself).
set -u
cd "$(git rev-parse --show-toplevel)" || exit 2
VAULT="${BISMUTH_VAULT:-/Users/michaelslain/Documents/library of alexandria}"
DIR="$VAULT/thoughts/Bismuth Changes"

branch=""; review=""; card=""
while [ $# -gt 0 ]; do
  case "$1" in
    --review) review="${2:-}"; shift 2;;
    --card)   card="${2:-}";   shift 2;;
    -*)       echo "unknown flag: $1" >&2; exit 2;;
    *)        branch="$1"; shift;;
  esac
done
[ -n "$branch" ] || { echo "usage: merge-card.sh <branch> --review <review.json> [--card <card>]" >&2; exit 2; }

# ---- gate 1: the review must exist and must say the change is real -------------
[ -n "$review" ] || { echo "REFUSED — no --review. A lane never merges unreviewed." >&2; exit 1; }
[ -f "$review" ] || { echo "REFUSED — review file not found: $review" >&2; exit 1; }
abs=$(cd "$(dirname "$review")" && pwd)/$(basename "$review")
verdict=$(bun -e '
  const fs = require("fs");
  try {
    const r = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const blocking = Array.isArray(r.blocking) ? r.blocking : (r.blocking ? [r.blocking] : []);
    if (r.isReal !== true) { process.stdout.write("REFUTED"); }
    else if (blocking.length) { process.stdout.write("BLOCKING:" + blocking.length); }
    else { process.stdout.write("OK"); }
  } catch (e) { process.stdout.write("MALFORMED"); }
' "$abs" 2>/dev/null || echo MALFORMED)

case "$verdict" in
  OK) echo "review: isReal, no blocking issues.";;
  REFUTED)    echo "REFUSED — review says isReal:false. Fix it in the worktree, re-review." >&2; exit 1;;
  BLOCKING:*) echo "REFUSED — review lists ${verdict#BLOCKING:} blocking issue(s). Fix them first." >&2; exit 1;;
  *)          echo "REFUSED — review unreadable/malformed ($verdict): $review" >&2; exit 1;;
esac

# ---- gate 2: the tree and the branch must be sane ------------------------------
git rev-parse --verify "$branch" >/dev/null 2>&1 || { echo "REFUSED — no such branch: $branch" >&2; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "REFUSED — working tree dirty; commit/stash first." >&2; exit 1; }
git switch main >/dev/null 2>&1 || { echo "REFUSED — cannot switch to main" >&2; exit 1; }
ahead=$(git rev-list --count "main..$branch")
[ "$ahead" -gt 0 ] || { echo "REFUSED — $branch has no commits main doesn't already have." >&2; exit 1; }
echo "merging $branch ($ahead commit(s)) -> main"

before=$(git rev-parse HEAD)

# ---- merge --------------------------------------------------------------------
if ! git merge --no-ff --no-edit "$branch"; then
  echo "MERGE CONFLICT — resolve by keeping BOTH features, then re-run." >&2
  git merge --abort 2>/dev/null
  exit 1
fi
after=$(git rev-parse HEAD)

# ---- gate 3: the guard decides whether the merge survives ----------------------
echo
if scripts/regression-guard.sh; then
  echo
  echo "MERGED + GREEN: $after"
  [ -n "$card" ] && echo "next: git push origin main && scripts/board-write.sh \"$card\" landed $after"
  [ -n "$card" ] || echo "next: git push origin main, then set the card's landed to $after"
  exit 0
fi

echo
echo "RED — rolling the merge back automatically (main must never be left broken)." >&2
git reset --hard "$before" >/dev/null 2>&1
echo "main restored to $before. The lane's work is still on '$branch' — fix it there." >&2
exit 1
