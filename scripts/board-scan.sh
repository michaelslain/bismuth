#!/usr/bin/env bash
# board-scan.sh — the auto-pickup operator's sensor.
# Reads the Bismuth Changes kanban cards and prints, per card, the operator's
# NEXT ACTION by column. The board is the command surface: this is what turns a
# card drop into work without the user talking to Claude Code.
#
#   Todo                 → TRIAGE + BUILD   (structure the brain-dump, launch a worktree lane)
#   In Progress          → building          (a workflow owns it)
#   Awaiting Confirmation → WAITING ON YOU   (preview + acceptance; notify the user)
#   Done but Broken      → RE-FIX            (escalate per bounces)
#   Done                 → MERGE + CLEANUP + REMOVE
#   Ideas                → idea
#
# Usage: scripts/board-scan.sh            (human view)
#        scripts/board-scan.sh --actions  (only cards needing operator action)
# bash 3.2 compatible (macOS system bash) — no associative arrays.
set -u
VAULT="${BISMUTH_VAULT:-/Users/michaelslain/Documents/library of alexandria}"
DIR="$VAULT/thoughts/Bismuth Changes"
ACTIONS_ONLY=0; [ "${1:-}" = "--actions" ] && ACTIONS_ONLY=1
[ -d "$DIR" ] || { echo "board dir not found: $DIR" >&2; exit 1; }

fm(){ awk -v k="$2" '{ if($0 ~ "^"k":"){ sub(/^[^:]*: */,""); print; exit } }' "$1"; }

lines=(); pending=0
while IFS= read -r -d '' f; do
  st=$(fm "$f" status); wt=$(fm "$f" worktree); ld=$(fm "$f" landed)
  bo=$(fm "$f" bounces); name=$(basename "$f" .md)
  case "$st" in
    Todo)                    act="TRIAGE + BUILD";           pending=$((pending+1));;
    "In Progress")           act="building (workflow owns it)";;
    "Awaiting Confirmation") act="WAITING ON YOU -> notify"; pending=$((pending+1));;
    "Done but Broken")       act="RE-FIX"; [ -n "$bo" ] && act="RE-FIX (bounces=$bo -> escalate)"; pending=$((pending+1));;
    Done)                    act="MERGE + CLEANUP + REMOVE"; pending=$((pending+1));;
    Ideas)                   act="idea";;
    *)                       st="<none>"; act="(no status -> treat as Todo)"; pending=$((pending+1));;
  esac
  lines+=("$st|$act|$name|$ld")
done < <(find "$DIR" -maxdepth 1 -name '*.md' -print0)

echo "-- Bismuth Changes board --"
for col in Todo "Done but Broken" "In Progress" "Awaiting Confirmation" Done Ideas "<none>"; do
  if [ "$ACTIONS_ONLY" = 1 ]; then case "$col" in "In Progress"|Ideas) continue;; esac; fi
  first=1
  for L in "${lines[@]}"; do
    s=${L%%|*}; rest=${L#*|}; a=${rest%%|*}; rest=${rest#*|}; n=${rest%%|*}; l=${rest##*|}
    [ "$s" = "$col" ] || continue
    [ $first = 1 ] && { echo; echo "[$col]"; first=0; }
    tail=""; [ -n "$l" ] && tail="  [landed $l]"
    printf '  - %-50s %s%s\n' "$n" "$a" "$tail"
  done
done
echo; echo "-> $pending card(s) need operator action."
