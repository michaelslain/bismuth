#!/usr/bin/env bash
# board-write.sh — the ONLY sanctioned way for the operator to write a kanban card.
#
# WHY THIS EXISTS: the board is the USER's document and their app writes it too.
# "Make the smallest targeted edit, never clobber their live edits" was a prose rule
# in the bismuth-flow skill, and prose rules get broken exactly when the operator is
# busy — a whole board once got gutted to 11 lines. This makes the rule mechanical:
# the card is re-read from disk at write time (never from stale context), exactly one
# frontmatter key changes, and the write is REFUSED if the diff touches anything else.
#
#   board-write.sh <card> <key> <value>   set ONE frontmatter key (creates it if absent)
#   board-write.sh <card> --append        append a body block from stdin (prefix-verified)
#   board-write.sh <card> --resolve-gate  close an OPEN plan/needs-input gate (user replied)
#   board-write.sh <card> --show          print the card as it is on disk right now
#
# <card> is a card title without .md ("Centralize the color system") or a full path.
# Exit 0 = written. Non-zero = refused, card untouched.
set -u
VAULT="${BISMUTH_VAULT:-/Users/michaelslain/Documents/library of alexandria}"
DIR="$VAULT/thoughts/Bismuth Changes"

usage() {
  sed -n '5,15p' "$0" | sed 's/^# \{0,1\}//' >&2
  exit 2
}

[ $# -ge 2 ] || usage
raw="$1"; shift
if [ -f "$raw" ]; then card="$raw"; else card="$DIR/$raw.md"; fi
[ -f "$card" ] || { echo "no such card: $card" >&2; exit 1; }

orig=$(mktemp); tmp=$(mktemp)
trap 'rm -f "$orig" "$tmp"' EXIT
cp "$card" "$orig"   # ground truth, re-read NOW — never from the operator's context

# every card must be frontmattered; refuse to touch anything that isn't
head -1 "$orig" | grep -qx -- '---' || { echo "refused — no frontmatter: $card" >&2; exit 1; }

case "${1:-}" in
  --show)
    cat "$orig"; exit 0;;

  --resolve-gate)
    # Close an OPEN gate the card was WAITING ON THE USER for. The user has replied
    # (in chat), so the '📋 Plan gate' / '❓ Needs input' marker preflight keys on must
    # become an answered marker — the skill's "answering a gate REPLACES the block".
    # Touches ONLY the marker token on its own line; the plan/question text below it
    # (a useful record) and everything else must survive byte-identically. Refuses if
    # there is no open gate, or if the swap would move any other content.
    sed -e 's/📋 \*\*Plan gate\*\*/💬 **Answered (plan approved)**/g' \
        -e 's/❓ \*\*Needs input\*\*/💬 **Answered**/g' "$orig" > "$tmp"
    grep -qE '💬 \*\*Answered' "$tmp" || { echo "refused — no open '📋 Plan gate' / '❓ Needs input' marker to resolve" >&2; exit 1; }
    bad=$(diff "$orig" "$tmp" | grep -E '^[<>]' | grep -vE '(Plan gate|Needs input|Answered)' || true)
    if [ -n "$bad" ]; then
      echo "refused — resolve-gate would touch more than the marker line:" >&2
      echo "$bad" >&2; exit 1
    fi
    ;;

  --append)
    cat "$orig" > "$tmp"
    printf '\n' >> "$tmp"
    cat >> "$tmp"
    # the existing card must survive byte-identically as a prefix
    n=$(wc -c < "$orig" | tr -d ' ')
    if ! head -c "$n" "$tmp" | cmp -s - "$orig"; then
      echo "refused — append would alter existing content" >&2; exit 1
    fi
    ;;

  *)
    key="$1"; shift
    [ $# -ge 1 ] || usage
    val="$*"
    case "$key" in *[!a-zA-Z0-9_-]*) echo "refused — bad key: $key" >&2; exit 1;; esac
    # A YAML value can span lines — a folded scalar or a list continues on the INDENTED lines
    # after `key:`. Replacing only the `key:` line orphans those, silently grafting the old
    # value's tail onto the new one (it once left a card reading "…has actually painted.\n gone
    # the graph is empty for a bit…"). So the key's whole block is replaced, and the dropped
    # continuation lines are recorded so the guard below can verify EXACTLY those and no others.
    dropped=$(mktemp); trap 'rm -f "$orig" "$tmp" "$dropped"' EXIT
    # A BLANK line inside a folded scalar is part of the value, not the end of it, so blanks are
    # buffered while skipping: dropped if an indented line follows (still inside the value),
    # replayed if a real key follows (they were separator lines that belong to the card).
    awk -v k="$key" -v v="$val" -v dropfile="$dropped" '
      function flush(  i) { for (i = 1; i <= nb; i++) print blanks[i]; nb = 0 }
      function sink(   i) { for (i = 1; i <= nb; i++) print blanks[i] >> dropfile; nb = 0 }
      BEGIN { inFM = 0; done = 0; skipping = 0; nb = 0 }
      NR == 1 && $0 == "---"            { inFM = 1; print; next }
      inFM && $0 == "---"               { if (skipping) flush(); if (!done) print k ": " v; inFM = 0; skipping = 0; print; next }
      inFM && skipping && /^[ \t]*$/    { blanks[++nb] = $0; next }
      inFM && skipping && /^[ \t]/      { sink(); print >> dropfile; next }
      inFM && skipping                  { flush(); skipping = 0 }
      inFM && index($0, k ":") == 1     { if (!done) { print k ": " v; done = 1; skipping = 1 } next }
                                        { print }
    ' "$orig" > "$tmp"
    # the diff must touch ONLY this key (plus the continuation lines we deliberately dropped) —
    # anything else means we would clobber the user
    bad=$(diff "$orig" "$tmp" | grep -E '^[<>]' | grep -vE "^[<>] ${key}:" \
          | { if [ -s "$dropped" ]; then grep -vxFf <(sed 's/^/< /' "$dropped"); else cat; fi } || true)
    if [ -n "$bad" ]; then
      echo "refused — edit would touch more than '${key}:':" >&2
      echo "$bad" >&2
      exit 1
    fi
    ;;
esac

# integrity: still a well-formed card
head -1 "$tmp" | grep -qx -- '---' || { echo "refused — result lost its frontmatter" >&2; exit 1; }
[ "$(grep -c -x -- '---' "$tmp")" -ge 2 ] || { echo "refused — result has an unclosed frontmatter" >&2; exit 1; }

cp "$tmp" "$card"
changed=$(diff "$orig" "$card" | grep -E '^[<>]' || true)
if [ -z "$changed" ]; then echo "no change: $(basename "$card" .md)"; else
  echo "wrote: $(basename "$card" .md)"
  echo "$changed" | sed 's/^/  /'
fi
