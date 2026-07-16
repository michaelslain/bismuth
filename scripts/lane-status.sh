#!/usr/bin/env bash
# lane-status.sh — reconcile every In Progress card against GIT TRUTH.
#
# WHY THIS EXISTS: "In Progress" is a claim the board makes, not a fact it checks.
# board-scan.sh prints "building (workflow owns it)" for any card in that column —
# but a workflow that is cancelled, crashed, or finished-without-merging leaves the
# card sitting there forever, and the board keeps insisting a lane owns it. Five
# cards once sat "building" for a day; ALL FIVE had already been merged into main.
# The operator nearly REBUILT them. Git knows the truth; ask git.
#
#   lane-status.sh            classify every In Progress card
#   lane-status.sh --actions  only cards whose state disagrees with the board
#
# Classifications:
#   MERGED    branch is an ancestor of main → the card is done; move to Awaiting Confirmation
#   LIVE      a locked worktree owns it → a workflow is genuinely building it right now
#   UNMERGED  branch exists with commits main lacks → lane finished or died; work survives
#   ORPHANED  no branch, no worktree → lane died before committing, OR the work landed under
#             a different branch name (grep main's log before rebuilding ANYTHING)
set -u
VAULT="${BISMUTH_VAULT:-/Users/michaelslain/Documents/library of alexandria}"
DIR="$VAULT/thoughts/Bismuth Changes"
cd "$(git rev-parse --show-toplevel)" || exit 2
ACTIONS_ONLY=0; [ "${1:-}" = "--actions" ] && ACTIONS_ONLY=1

fm() { awk -v k="$2" '{ if ($0 ~ "^"k":") { sub(/^[^:]*: */, ""); print; exit } }' "$1"; }

# a locked worktree = a workflow currently owns it (the harness locks them for the run)
live_locked=$(git worktree list --porcelain | grep -c '^locked' || true)

echo "== lane status (In Progress vs git) =="
echo "   $live_locked locked worktree(s) = lane(s) genuinely running right now"
echo

drift=0
while IFS= read -r -d '' f; do
  [ "$(fm "$f" status)" = "In Progress" ] || continue
  name=$(basename "$f" .md); wt=$(fm "$f" worktree); ld=$(fm "$f" landed)
  short="${name:0:46}"

  if [ -z "$wt" ]; then
    printf '  %-46s  ORPHANED  (no worktree field — never triaged properly)\n' "$short"; drift=$((drift+1)); continue
  fi

  if ! git rev-parse --verify "$wt" >/dev/null 2>&1; then
    # A missing branch is AMBIGUOUS and the ambiguity is the whole trap:
    #   merged-then-cleaned-up looks EXACTLY like never-built. Git cannot tell you
    #   which. Only `landed` can, and these cards predate the gate that sets it.
    # So refuse to guess — say unverifiable and make a human/Claude read main's log.
    if [ -n "$ld" ]; then
      printf '  %-46s  MERGED    landed=%s (branch cleaned up) → should be Awaiting Confirmation\n' "$short" "$ld"
    else
      printf '  %-46s  UNVERIFIABLE  branch "%s" gone + no landed. Merged-and-cleaned, never\n' "$short" "$wt"
      printf '  %-46s                built, or a live lane not yet committed. CHECK MAIN LOG.\n' ""
    fi
    drift=$((drift+1)); continue
  fi

  if git merge-base --is-ancestor "$wt" main 2>/dev/null; then
    # the OLDEST merge on the ancestry path is the one that actually brought it in
    sha=$(git log --oneline --merges --ancestry-path "$wt..main" 2>/dev/null | tail -1 | awk '{print $1}')
    [ -z "$sha" ] && sha=$(git rev-parse --short "$wt")
    printf '  %-46s  MERGED    at %s → move to Awaiting Confirmation (landed=%s)\n' "$short" "$sha" "$sha"
    [ -z "$ld" ] && drift=$((drift+1))
    continue
  fi

  n=$(git rev-list --count "main..$wt" 2>/dev/null || echo 0)
  age=$(git log -1 --format=%cr "$wt" 2>/dev/null)
  if git worktree list --porcelain | grep -A2 "branch refs/heads/$wt$" | grep -q '^locked'; then
    printf '  %-46s  LIVE      (%s commit(s), last %s)\n' "$short" "$n" "$age"
  else
    printf '  %-46s  UNMERGED  (%s commit(s), last %s — no live lane; review + merge or kill)\n' "$short" "$n" "$age"
    drift=$((drift+1))
  fi
done < <(find "$DIR" -maxdepth 1 -name '*.md' -print0)

echo
if [ "$drift" = 0 ]; then
  echo "CLEAN — every In Progress card has a lane that actually exists."
else
  echo "DRIFT — $drift card(s) disagree with git. Reconcile them BEFORE building anything:"
  echo "  MERGED   → scripts/board-write.sh '‹card›' landed ‹sha› && scripts/board-write.sh '‹card›' status 'Awaiting Confirmation'"
  echo "  UNMERGED → review the branch, then scripts/merge-card.sh ‹branch› --review ‹json›"
  echo "  ORPHANED → grep main's log for the work FIRST; only rebuild if it truly isn't there."
fi
