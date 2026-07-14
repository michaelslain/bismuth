#!/usr/bin/env bash
# rollback-card.sh — revert a card's landed commit when it regressed (idea S).
# Reverts the merge (or plain commit), runs the regression guard, and — if green —
# leaves you to push + reopen the card (move it to Done but Broken). Completes the
# guard loop: regression-guard detects → rollback-card reverts.
#
# Usage: scripts/rollback-card.sh <landed-sha> ["reason"]
set -u
cd "$(git rev-parse --show-toplevel)" || exit 2
sha="${1:-}"; reason="${2:-regressed}"
[ -z "$sha" ] && { echo "usage: rollback-card.sh <landed-sha> [reason]" >&2; exit 1; }
git rev-parse --verify "$sha^{commit}" >/dev/null 2>&1 || { echo "not a commit: $sha" >&2; exit 1; }

# a merge commit has 2+ parents → revert the first-parent mainline
parents=$(git rev-list --parents -n1 "$sha" | wc -w)
if [ "$parents" -ge 3 ]; then MFLAG="-m 1"; else MFLAG=""; fi

echo "reverting $sha ($reason)..."
if ! git revert --no-edit $MFLAG "$sha"; then
  echo "REVERT CONFLICT — resolve, then 'git revert --continue'. Leaving in-progress." >&2
  exit 1
fi
echo "reverted. running regression guard..."
if scripts/regression-guard.sh; then
  echo "GREEN after revert. Next: git push origin main, then reopen the card (Done but Broken, note the revert)."
else
  echo "RED after revert — the revert itself broke something; investigate before pushing." >&2
  exit 1
fi
