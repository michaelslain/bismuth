#!/usr/bin/env bash
# gc-worktrees.sh — Bismuth Changes workflow hygiene.
#
# Removes git worktrees + branches whose work is FULLY MERGED into main, and
# prunes worktrees whose only diff is untracked junk (node_modules). Anything
# UNMERGED is reported and KEPT — never auto-deleted (that needs human judgment,
# e.g. a superseded competing attempt).
#
# Usage:
#   scripts/gc-worktrees.sh            # dry-run: show what WOULD be cleaned
#   scripts/gc-worktrees.sh --run      # actually remove merged worktrees+branches
#
# Safe by design: skips the main worktree, skips LOCKED worktrees, and only
# deletes a branch after `git merge-base --is-ancestor <branch> main`.
set -euo pipefail

RUN=0
[[ "${1:-}" == "--run" ]] && RUN=1

cd "$(git rev-parse --show-toplevel)"
MAIN_WT="$(git rev-parse --show-toplevel)"

merged=0 kept=0 junk=0
# git worktree list --porcelain: blocks of `worktree <path>` / `HEAD <sha>` / `branch refs/heads/<b>` / `locked`
path="" branch="" locked=0
flush() {
  [[ -z "$path" ]] && return
  if [[ "$path" == "$MAIN_WT" ]]; then :; # never touch main
  elif [[ $locked -eq 1 ]]; then echo "LOCKED  keep   $path"; kept=$((kept+1))
  elif [[ -z "$branch" ]]; then echo "DETACHED keep  $path"; kept=$((kept+1))
  elif git merge-base --is-ancestor "$branch" main 2>/dev/null; then
    echo "MERGED  remove $branch  ($path)"; merged=$((merged+1))
    if [[ $RUN -eq 1 ]]; then
      git worktree remove --force "$path" 2>/dev/null || rm -rf "$path"
      git branch -d "$branch" 2>/dev/null || true
    fi
  else
    # unmerged: is the ONLY diff untracked node_modules? then it's disposable junk
    dirty="$(git -C "$path" status --porcelain 2>/dev/null | grep -v 'node_modules' || true)"
    if [[ -z "$dirty" ]]; then
      echo "JUNK    remove $branch  ($path — node_modules only, branch UNMERGED — worktree removed, branch kept)"; junk=$((junk+1))
      [[ $RUN -eq 1 ]] && { git worktree remove --force "$path" 2>/dev/null || rm -rf "$path"; }
    else
      echo "UNMERGED keep  $branch  ($path — has real changes)"; kept=$((kept+1))
    fi
  fi
  path="" branch="" locked=0
}
while IFS= read -r line; do
  case "$line" in
    worktree\ *) flush; path="${line#worktree }" ;;
    branch\ refs/heads/*) branch="${line#branch refs/heads/}" ;;
    locked*) locked=1 ;;
    "") ;;
  esac
done < <(git worktree list --porcelain; echo)
flush
[[ $RUN -eq 1 ]] && git worktree prune

echo
echo "merged-removable=$merged  junk-removable=$junk  kept=$kept   $([[ $RUN -eq 1 ]] && echo '(REMOVED)' || echo '(dry-run — pass --run to apply)')"
