#!/usr/bin/env bash
# previews.sh — the per-card preview lifecycle manager.
#
# WHY THIS EXISTS: when a card reaches "Awaiting Confirmation" the user tests THAT
# CHANGE IN ISOLATION before promoting it to Done — that's the entire point of the
# worktrees. Hand-rolling "spin up a core+vite pair in the lane's worktree" per card
# meant the user had to ask "what's the localhost for bug 87?" one card at a time.
# This automates it, and writes the URL to the card's `preview` frontmatter property
# instead of hosting a dashboard — the BOARD is the interface (the user's own words).
#
#   previews.sh status            human table: card, state, url, port pair, worktree
#   previews.sh start <card>      provision + launch + write the `preview` property
#   previews.sh stop <card>       stop that card's servers (leave the worktree; clear preview)
#   previews.sh gc [--run]        kill ORPHANED preview servers (dry run by default)
#   previews.sh sync              reconcile every Awaiting-Confirmation card's `preview`
#                                  property with reality (set only ever happens in `start`;
#                                  sync's job is narrower: clear it if the server died)
#
# Port convention: core 433x / vite 143x, same x, so core = vite + 2900. x starts at 2
# (1432/4332 — never 1430/4330) to preserve the four hand-launched previews:
#   1432=#87 chat chrome, 1433=#107 subagents, 1434=cards-view/masonry, 1435=daemon chats.
# A card's own `preview` property IS the state — no separate port ledger. First-time
# assignment picks the lowest x whose pair is currently free (checked live, via lsof).
#
# bash 3.2 compatible (macOS system bash) — no associative arrays.
set -u
VAULT="${BISMUTH_VAULT:-/Users/michaelslain/Documents/library of alexandria}"
DIR="$VAULT/thoughts/Bismuth Changes"
REPO="$(git rev-parse --show-toplevel 2>/dev/null)"
[ -n "$REPO" ] || { echo "not inside a git repo" >&2; exit 2; }
cd "$REPO" || exit 2
[ -d "$DIR" ] || { echo "board dir not found: $DIR" >&2; exit 1; }
LOGDIR="$REPO/.claude/preview-logs"
BOARD_WRITE="$REPO/scripts/board-write.sh"

fm(){ awk -v k="$2" '{ if($0 ~ "^"k":"){ sub(/^[^:]*: */,""); print; exit } }' "$1"; }

resolve_card(){ # $1 = title or path -> prints card path
  if [ -f "$1" ]; then printf '%s\n' "$1"; else printf '%s\n' "$DIR/$1.md"; fi
}

slugify(){
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//' | cut -c1-50
}

vite_port_of(){ printf '%s' "$1" | sed -nE 's#^https?://[^:/]+:([0-9]+)/?$#\1#p'; }

port_listening(){ lsof -ti tcp:"$1" -sTCP:LISTEN >/dev/null 2>&1; }
core_alive(){ curl -fsS -m 2 "http://localhost:$1/version" >/dev/null 2>&1; }

# prints "vite core" and returns 0 iff the card's recorded preview is actually live
card_live_ports(){
  local pv v c
  pv=$(fm "$1" preview); v=$(vite_port_of "$pv")
  [ -n "$v" ] || return 1
  c=$((v + 2900))
  port_listening "$v" && port_listening "$c" && core_alive "$c" || return 1
  printf '%s %s\n' "$v" "$c"
}

# lowest free x (>=2) whose 143x/433x pair is both currently unbound
next_free_ports(){
  local x=2 v c
  while [ "$x" -le 97 ]; do
    v=$((1430 + x)); c=$((4330 + x))
    if ! port_listening "$v" && ! port_listening "$c"; then
      printf '%s %s\n' "$v" "$c"; return 0
    fi
    x=$((x + 1))
  done
  return 1
}

# prints the sha this card's isolated work lives at (landed^2, else the worktree
# branch tip), or fails — never guesses.
resolve_target_sha(){
  local card="$1" ld wt
  ld=$(fm "$card" landed); wt=$(fm "$card" worktree)
  if [ -n "$ld" ] && git rev-parse --verify "${ld}^2" >/dev/null 2>&1; then
    git rev-parse "${ld}^2"; return 0
  fi
  if [ -n "$wt" ] && git rev-parse --verify "$wt" >/dev/null 2>&1; then
    git rev-parse "$wt"; return 0
  fi
  return 1
}

# prints the path of an EXISTING worktree whose HEAD == $1, if any (read-only —
# does not create). Handles both "reuse the lane's original worktree" and
# "reuse a preview worktree we made earlier".
find_existing_worktree(){
  local target="$1" matches pick
  matches=$(git worktree list --porcelain | awk -v t="$target" '
    /^worktree /{p=substr($0,10)}
    /^HEAD /{h=substr($0,6); if (h==t) print p}
  ')
  [ -z "$matches" ] && return 0
  # several worktrees can share a HEAD (e.g. a dead lane + our own preview-* copy) —
  # prefer one already named preview-*, else take the first, but always exactly one.
  pick=$(printf '%s\n' "$matches" | grep '/preview-' | head -1)
  [ -z "$pick" ] && pick=$(printf '%s\n' "$matches" | head -1)
  printf '%s\n' "$pick"
}

# bun install in $1 if node_modules is missing, or if @bismuth/core resolves
# OUTSIDE this worktree (the "root node_modules symlinks back to MAIN" trap).
ensure_deps(){
  local wt="$1" wt_abs resolved
  wt_abs=$(cd "$wt" && pwd -P)
  if [ ! -d "$wt/node_modules" ]; then
    echo "  bun install (fresh) in $wt"
    (cd "$wt" && bun install) || return 1
    return 0
  fi
  if [ -d "$wt/node_modules/@bismuth/core" ]; then
    resolved=$(cd "$wt/node_modules/@bismuth/core" 2>/dev/null && pwd -P)
    case "$resolved" in
      "$wt_abs"/*) return 0 ;;
      *) echo "  node_modules/@bismuth/core resolves OUTSIDE this worktree ($resolved) — reinstalling" ;;
    esac
  else
    echo "  node_modules/@bismuth/core missing — reinstalling"
  fi
  rm -rf "$wt/node_modules"
  (cd "$wt" && bun install) || return 1
}

launch_servers(){
  local wt="$1" vite="$2" core="$3" slug="$4"
  mkdir -p "$LOGDIR"
  ( cd "$wt" && nohup bun run "$wt/core/src/server.ts" --port "$core" \
      --vault "$VAULT" --memory "$VAULT/.daemon/memory" \
      >"$LOGDIR/$slug.core.log" 2>&1 </dev/null & )
  ( cd "$wt/app" && VITE_API_BASE="http://localhost:$core" nohup bun run vite --port "$vite" --strictPort \
      >"$LOGDIR/$slug.vite.log" 2>&1 </dev/null & )
}

wait_live(){
  local vite="$1" core="$2" tries=30
  while [ "$tries" -gt 0 ]; do
    if port_listening "$vite" && port_listening "$core" && core_alive "$core"; then return 0; fi
    sleep 1; tries=$((tries - 1))
  done
  return 1
}

cmd_status(){
  printf '%-52s %-6s %-24s %-11s %s\n' "CARD" "STATE" "URL" "PORTS" "WORKTREE"
  while IFS= read -r -d '' f; do
    st=$(fm "$f" status)
    case "$st" in "Awaiting Confirmation"|"Done but Broken") ;; *) continue ;; esac
    name=$(basename "$f" .md); wt=$(fm "$f" worktree); pv=$(fm "$f" preview)
    ports=$(card_live_ports "$f")
    if [ -n "$ports" ]; then
      v=${ports%% *}; c=${ports##* }
      printf '%-52.52s %-6s %-24s %-11s %s\n' "$name" "live" "http://localhost:$v" "$c/$v" "$wt"
    elif [ -n "$pv" ]; then
      printf '%-52.52s %-6s %-24s %-11s %s\n' "$name" "dead" "$pv" "-" "$wt"
    else
      printf '%-52.52s %-6s %-24s %-11s %s\n' "$name" "none" "-" "-" "$wt"
    fi
  done < <(find "$DIR" -maxdepth 1 -name '*.md' -print0)
}

cmd_start(){
  local raw="${1:-}" card name slug ports v c target wt_path
  [ -n "$raw" ] || { echo "usage: previews.sh start <card>" >&2; exit 2; }
  card=$(resolve_card "$raw")
  [ -f "$card" ] || { echo "no such card: $card" >&2; exit 1; }
  name=$(basename "$card" .md)
  slug=$(slugify "$name")

  ports=$(card_live_ports "$card")
  if [ -n "$ports" ]; then
    v=${ports%% *}
    echo "already live: $name -> http://localhost:$v"
    exit 0
  fi

  target=$(resolve_target_sha "$card") || {
    echo "REFUSE — $name has no usable landed^2 or worktree branch. Not guessing." >&2
    exit 1
  }
  wt_path=$(find_existing_worktree "$target")
  if [ -z "$wt_path" ]; then
    wt_path="$REPO/.claude/worktrees/preview-$slug"
    echo "provisioning worktree at $wt_path ($target)"
    git worktree add --detach "$wt_path" "$target" || exit 1
  else
    echo "reusing existing worktree: $wt_path"
  fi

  ensure_deps "$wt_path" || { echo "bun install failed in $wt_path" >&2; exit 1; }

  # best-effort: reuse this card's OWN previously-recorded port pair if it's free again
  local pv old_v old_c
  pv=$(fm "$card" preview); old_v=$(vite_port_of "$pv")
  if [ -n "$old_v" ] && ! port_listening "$old_v" && ! port_listening "$((old_v + 2900))"; then
    v="$old_v"; c=$((old_v + 2900))
  else
    ports=$(next_free_ports) || { echo "no free preview ports left" >&2; exit 1; }
    v=${ports%% *}; c=${ports##* }
  fi

  echo "launching core:$c vite:$v (logs: $LOGDIR/$slug.{core,vite}.log)"
  launch_servers "$wt_path" "$v" "$c" "$slug"

  if wait_live "$v" "$c"; then
    "$BOARD_WRITE" "$card" preview "http://localhost:$v" >/dev/null
    echo "live: http://localhost:$v"
  else
    echo "FAILED to come up within 30s — tail of logs:" >&2
    tail -n 15 "$LOGDIR/$slug.core.log" 2>/dev/null | sed 's/^/  [core] /' >&2
    tail -n 15 "$LOGDIR/$slug.vite.log" 2>/dev/null | sed 's/^/  [vite] /' >&2
    exit 1
  fi
}

cmd_stop(){
  local raw="${1:-}" card name pv v c p pids
  [ -n "$raw" ] || { echo "usage: previews.sh stop <card>" >&2; exit 2; }
  card=$(resolve_card "$raw")
  [ -f "$card" ] || { echo "no such card: $card" >&2; exit 1; }
  name=$(basename "$card" .md)
  pv=$(fm "$card" preview); v=$(vite_port_of "$pv")
  if [ -n "$v" ]; then
    c=$((v + 2900))
    for p in "$v" "$c"; do
      pids=$(lsof -ti tcp:"$p" -sTCP:LISTEN 2>/dev/null || true)
      if [ -n "$pids" ]; then kill $pids 2>/dev/null; echo "  killed port $p"; fi
    done
  else
    echo "  no preview recorded for: $name"
  fi
  "$BOARD_WRITE" "$card" preview "" >/dev/null
  echo "stopped: $name"
}

cmd_sync(){
  local n_ok=0 n_cleared=0
  while IFS= read -r -d '' f; do
    [ "$(fm "$f" status)" = "Awaiting Confirmation" ] || continue
    pv=$(fm "$f" preview); [ -n "$pv" ] || continue
    name=$(basename "$f" .md)
    ports=$(card_live_ports "$f")
    if [ -n "$ports" ]; then
      n_ok=$((n_ok + 1))
    else
      "$BOARD_WRITE" "$f" preview "" >/dev/null
      echo "cleared stale preview: $name ($pv)"
      n_cleared=$((n_cleared + 1))
    fi
  done < <(find "$DIR" -maxdepth 1 -name '*.md' -print0)
  echo "sync done — live=$n_ok cleared=$n_cleared"
}

cmd_gc(){
  local RUN=0; [ "${1:-}" = "--run" ] && RUN=1
  local n_junk=0 n_orphan=0 pid rest vault target wtp v c p pids

  echo "== rule (a): servers pointed at a /tmp or /private/tmp throwaway vault =="
  while IFS= read -r line; do
    pid=${line%% *}; rest=${line#* }
    case "$rest" in
      *core/src/server.ts*)
        vault=$(printf '%s' "$rest" | sed -nE 's/.*--vault[= ]("[^"]*"|[^ ]*).*/\1/p' | tr -d '"')
        case "$vault" in
          /tmp/*|/private/tmp/*)
            echo "  JUNK   pid=$pid  vault=$vault"
            n_junk=$((n_junk + 1))
            [ "$RUN" = 1 ] && kill -9 "$pid" 2>/dev/null
            ;;
        esac ;;
      *node_modules/.bin/vite*)
        case "$rest" in
          */tmp/*|*/private/tmp/*)
            echo "  JUNK   pid=$pid  $rest"
            n_junk=$((n_junk + 1))
            [ "$RUN" = 1 ] && kill -9 "$pid" 2>/dev/null
            ;;
        esac ;;
    esac
  done < <(ps -axo pid=,command=)

  echo
  echo "== rule (b): a port WE assign (14/43 3x range) whose card's worktree is gone =="
  while IFS= read -r -d '' f; do
    pv=$(fm "$f" preview); v=$(vite_port_of "$pv"); [ -n "$v" ] || continue
    c=$((v + 2900))
    port_listening "$v" || port_listening "$c" || continue
    if ! target=$(resolve_target_sha "$f"); then
      echo "  SKIP   $(basename "$f" .md) — can't resolve landed^2/worktree, not guessing"
      continue
    fi
    wtp=$(find_existing_worktree "$target")
    if [ -z "$wtp" ] || [ ! -d "$wtp" ]; then
      echo "  ORPHAN $(basename "$f" .md)  ports=$v/$c  worktree gone"
      n_orphan=$((n_orphan + 1))
      if [ "$RUN" = 1 ]; then
        for p in "$v" "$c"; do
          pids=$(lsof -ti tcp:"$p" -sTCP:LISTEN 2>/dev/null || true)
          [ -n "$pids" ] && kill -9 $pids 2>/dev/null
        done
      fi
    fi
  done < <(find "$DIR" -maxdepth 1 -name '*.md' -print0)

  echo
  echo "junk=$n_junk orphan=$n_orphan  $([ "$RUN" = 1 ] && echo '(REMOVED)' || echo '(dry-run — pass --run to apply)')"
}

case "${1:-}" in
  status) cmd_status ;;
  start)  shift; cmd_start "${1:-}" ;;
  stop)   shift; cmd_stop "${1:-}" ;;
  sync)   cmd_sync ;;
  gc)     shift; cmd_gc "${1:-}" ;;
  *) echo "usage: previews.sh {status|start <card>|stop <card>|sync|gc [--run]}" >&2; exit 2 ;;
esac
