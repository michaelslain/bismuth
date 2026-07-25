#!/usr/bin/env bash
# make-sandbox.sh — a disposable, NEUTERED clone of the real vault for testing
# authoring-cards (cards the user must CREATE junk to test: embeds, `??` refs,
# image drops). Testing those against the real vault means polluting their
# knowledge base, so they simply won't test — the card rots in Awaiting
# Confirmation. The clone is the fix: real notes, real structure, zero risk.
#
# WHY A SCRIPT: this was a four-step prose procedure in SKILL.md with a live-data
# trap in the middle — a clone carries `.settings` + per-calendar sync frontmatter,
# so three sandbox cores once booted straight into syncing the user's REAL Google
# Calendar (tokens are MACHINE-wide at ~/.bismuth/gcal, so any core on this machine
# can reach the real account; the only gates are the flags this script flips off).
#
#   make-sandbox.sh <slug>        clone -> ~/.bismuth/sandboxes/<slug>, neutered
#   make-sandbox.sh --list        list sandboxes
#   make-sandbox.sh --rm <slug>   remove one (refuses anything outside the dir,
#                                 refuses while a server is serving it)
#
# What "neutered" means, exactly:
#   - .git removed                 the throwaway can never commit into vault history
#   - .settings                    googleCalendar.enabled + daemon.enabled -> false
#   - every `googleCalendarSync: true` in the clone's md files -> false
#     (sync is per-calendar now; the .settings flag alone is only the LEGACY gate)
#
# Sandboxes live under ~/.bismuth/sandboxes, NOT /tmp — deliberately: previews.sh
# gc treats any server with a /tmp vault as junk and kills it, and a sandbox
# serving an Awaiting-Confirmation card is the user's live test surface.
#
# Serve one behind a card's preview:  previews.sh start <card> --vault <sandbox>
# bash 3.2 compatible (macOS system bash) — no associative arrays.
set -u
VAULT="${BISMUTH_VAULT:-/Users/michaelslain/Documents/library of alexandria}"
SBX="$HOME/.bismuth/sandboxes"

neuter_settings(){ # $1 = sandbox root. Flip the two outward-reaching switches.
  local f="$1/.settings" tmp
  [ -f "$f" ] || return 0
  tmp="$f.tmp.$$"
  awk '
    /^[^[:space:]#]/ { sec=$0 }
    {
      if ((sec ~ /^googleCalendar:/ || sec ~ /^daemon:/) && $0 ~ /^[[:space:]]+enabled:[[:space:]]*true/)
        sub(/true/, "false")
      print
    }
  ' "$f" >"$tmp" && mv "$tmp" "$f"
}

neuter_gcal_frontmatter(){ # $1 = sandbox root. Per-calendar sync overrides the legacy flag.
  local root="$1" f n=0
  while IFS= read -r f; do
    sed -i '' 's/googleCalendarSync:[[:space:]]*true/googleCalendarSync: false/' "$f"
    n=$((n + 1))
  done < <(grep -rl --include='*.md' 'googleCalendarSync:[[:space:]]*true' "$root" 2>/dev/null)
  echo "$n"
}

cmd_make(){
  local slug="${1:-}" dest notes flipped
  [ -n "$slug" ] || { echo "usage: make-sandbox.sh <slug>" >&2; exit 2; }
  [ -d "$VAULT" ] || { echo "vault not found: $VAULT" >&2; exit 1; }
  dest="$SBX/$slug"
  [ -e "$dest" ] && { echo "already exists: $dest (make-sandbox.sh --rm '$slug' first)" >&2; exit 1; }
  mkdir -p "$SBX"

  # APFS copy-on-write clone: ~3s for the whole vault, near-zero disk until written.
  # -c fails across volumes; fall back to a plain copy rather than dying.
  echo "cloning $VAULT"
  if ! cp -Rc "$VAULT" "$dest" 2>/dev/null; then
    echo "  (clonefile unavailable — plain copy, slower)"
    rm -rf "$dest"
    cp -R "$VAULT" "$dest" || { echo "copy failed" >&2; exit 1; }
  fi

  rm -rf "$dest/.git"
  mkdir -p "$dest/.daemon/memory"
  neuter_settings "$dest"
  flipped=$(neuter_gcal_frontmatter "$dest")

  notes=$(find "$dest" -name '*.md' -not -path '*/.daemon/*' | wc -l | tr -d ' ')
  echo "sandbox ready: $dest"
  echo "  notes: $notes   .git: removed   gcal frontmatter flipped: $flipped file(s)"
  grep -A1 '^googleCalendar:' "$dest/.settings" 2>/dev/null | grep 'enabled:' | sed 's/^/  .settings googleCalendar /'
  grep -A1 '^daemon:' "$dest/.settings" 2>/dev/null | grep 'enabled:' | sed 's/^/  .settings daemon /'
  echo
  echo "serve it behind a card:  scripts/previews.sh start '<card>' --vault \"$dest\""
  echo "then SAY ON THE CARD the preview is a sandbox — what the user types is disposable."
}

cmd_list(){
  [ -d "$SBX" ] || { echo "no sandboxes ($SBX does not exist)"; return 0; }
  local d
  for d in "$SBX"/*/; do
    [ -d "$d" ] || continue
    printf '%-40s %s\n' "$(basename "$d")" "$(du -sh "$d" 2>/dev/null | cut -f1)"
  done
}

cmd_rm(){
  local slug="${1:-}" dest real holders
  [ -n "$slug" ] || { echo "usage: make-sandbox.sh --rm <slug>" >&2; exit 2; }
  dest="$SBX/$slug"
  real=$(cd "$dest" 2>/dev/null && pwd -P) || { echo "no such sandbox: $dest" >&2; exit 1; }
  case "$real" in
    "$SBX"/*) ;;
    *) echo "REFUSE — $real is not under $SBX. Not deleting." >&2; exit 1;;
  esac
  # a server still serving this sandbox = an Awaiting-Confirmation card still points
  # here. Removing the vault out from under it hands the user a broken preview.
  holders=$(ps -axo pid=,command= | grep -F -- "--vault $real" | grep -v grep || true)
  if [ -n "$holders" ]; then
    echo "REFUSE — a server is still serving this sandbox:" >&2
    printf '%s\n' "$holders" | sed 's/^/  /' | cut -c1-140 >&2
    echo "  previews.sh stop the card first." >&2
    exit 1
  fi
  rm -rf "$real"
  echo "removed: $real"
}

case "${1:-}" in
  --list) cmd_list ;;
  --rm)   shift; cmd_rm "${1:-}" ;;
  --*|"") echo "usage: make-sandbox.sh <slug> | --list | --rm <slug>" >&2; exit 2 ;;
  *)      cmd_make "$1" ;;
esac
