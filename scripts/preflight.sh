#!/usr/bin/env bash
# preflight.sh — refuse to build a card that isn't actually ready to be built.
#
# WHY THIS EXISTS: the operator once ran an entire session against a STALE markdown
# table that hadn't been the real board for weeks, and separately fired lanes for
# cards whose gates were still waiting on the user. Both were prose rules ("scan
# before you act", "don't guess — ask in the card") and both got skipped. This makes
# them mechanical: preflight re-reads the card from the REAL board dir and fails
# closed. Nothing fans out until this exits 0.
#
#   preflight.sh <card>            check one card
#   preflight.sh --all             check every actionable card
#
# Exit 0 = safe to build. Non-zero = do NOT build; the reason is printed.
set -u
VAULT="${BISMUTH_VAULT:-/Users/michaelslain/Documents/library of alexandria}"
DIR="$VAULT/thoughts/Bismuth Changes"
cd "$(git rev-parse --show-toplevel)" || exit 2

fm() { awk -v k="$2" '{ if ($0 ~ "^"k":") { sub(/^[^:]*: */, ""); print; exit } }' "$1"; }

check() {
  local card="$1" name fails=0
  name=$(basename "$card" .md)

  [ -f "$card" ] || { echo "  REFUSE  $name — card does not exist in $DIR"; return 1; }
  head -1 "$card" | grep -qx -- '---' || { echo "  REFUSE  $name — no frontmatter"; return 1; }

  local st ty wt
  st=$(fm "$card" status); ty=$(fm "$card" type); wt=$(fm "$card" worktree)

  case "$st" in
    Todo|"In Progress") ;;
    "Done but Broken")  ;;
    *) echo "  REFUSE  $name — status '${st:-<none>}' is not buildable"; fails=1;;
  esac

  [ -n "$ty" ] || { echo "  REFUSE  $name — no type: (triage it first)"; fails=1; }
  [ -n "$wt" ] || { echo "  REFUSE  $name — no worktree: (triage it first)"; fails=1; }

  # a card still carrying an OPEN gate is waiting on the user, not on us.
  # answering a gate means REPLACING it with a 💬 Answer block — not appending one.
  if grep -q '❓ \*\*Needs input' "$card"; then
    echo "  REFUSE  $name — unanswered '❓ Needs input' gate (the user hasn't replied)"; fails=1
  fi
  if grep -q '📋 \*\*Plan gate' "$card"; then
    echo "  REFUSE  $name — open '📋 Plan gate' (post the plan and get a thumbs-up first)"; fails=1
  fi
  if grep -q '⏸️ \*\*Parked' "$card"; then
    echo "  REFUSE  $name — '⏸️ Parked' (superseded/deferred; the user decides if it revives)"; fails=1
  fi

  if [ "$ty" = "question" ]; then
    echo "  REFUSE  $name — type: question is answered in the card, never built"; fails=1
  fi

  [ $fails = 0 ] || return 1
  echo "  OK      $name — type=$ty worktree=$wt status=$st"
  return 0
}

echo "== preflight =="

# The tree must be sane before ANY lane forks off it. Lanes fork off COMMITTED main,
# so untracked files are harmless — but modified TRACKED files are the signature of a
# loose builder having written straight into main (which once corrupted it). Hard-fail
# on the second, warn on the first.
dirty=$(git status --porcelain --untracked-files=no | head -5)
if [ -n "$dirty" ]; then
  echo "  REFUSE  main has uncommitted changes to tracked files — a lane must never fork off this:"
  echo "$dirty" | sed 's/^/          /'
  echo "          (this is what a loose builder writing into main looks like — investigate before building)"
  exit 1
fi
untracked=$(git status --porcelain --untracked-files=normal | grep '^??' | head -3)
[ -n "$untracked" ] && echo "  WARN    untracked files present (harmless to lanes, but commit them when done)"
cur=$(git rev-parse --abbrev-ref HEAD)
[ "$cur" = "main" ] || echo "  WARN    on branch '$cur', not main"

rc=0
if [ "${1:-}" = "--all" ]; then
  while IFS= read -r -d '' f; do
    st=$(fm "$f" status)
    case "$st" in Todo|"Done but Broken") check "$f" || rc=1;; esac
  done < <(find "$DIR" -maxdepth 1 -name '*.md' -print0)
else
  [ $# -ge 1 ] || { echo "usage: preflight.sh <card> | --all" >&2; exit 2; }
  raw="$1"
  if [ -f "$raw" ]; then card="$raw"; else card="$DIR/$raw.md"; fi
  check "$card" || rc=1
fi

echo
[ $rc = 0 ] && echo "GREEN — safe to build." || echo "BLOCKED — fix the above; do not fan out."
exit $rc
