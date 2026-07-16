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
# (1432/4332 — never 1430/4330) to stay clear of the user's own dev pair (1420/4321).
#
# THE BOARD IS THE PORT LEDGER. A card's `preview` property IS the state — assignment
# reads the board and nothing else, so the same board always yields the same answer.
# Deliberately NOT "lowest port free per lsof right now": that made a card's port a
# function of whatever happened to be running at the time, so the same card could get
# a different URL on every start. Reading the board also preserves the hand-launched
# previews for free, because they are recorded on their own cards:
#   1432=#87 chat chrome, 1433=#107 subagents, 1434=cards-view/masonry, 1435=daemon chats.
#
# bash 3.2 compatible (macOS system bash) — no associative arrays.
set -u
VAULT="${BISMUTH_VAULT:-/Users/michaelslain/Documents/library of alexandria}"
DIR="$VAULT/thoughts/Bismuth Changes"
REPO="$(git rev-parse --show-toplevel 2>/dev/null)"
[ -n "$REPO" ] || { echo "not inside a git repo" >&2; exit 2; }
cd "$REPO" || exit 2
[ -d "$DIR" ] || { echo "board dir not found: $DIR" >&2; exit 1; }

# The MAIN checkout — git ALWAYS lists it first. Everything preview-related is
# anchored to it (not to $REPO, which is the lane itself when run from a worktree)
# so a preview provisioned from anywhere lands in, and is reusable from, one place.
MAIN_WT="$(git worktree list --porcelain | awk '/^worktree /{print substr($0,10); exit}')"
WT_DIR="$MAIN_WT/.claude/worktrees"
LOGDIR="$MAIN_WT/.claude/preview-logs"
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

# 0 iff the process LISTENING on port $1 was launched out of worktree $2.
#
# "Something is listening and answers /version" is NOT proof the preview is ours —
# it is only proof that SOMEBODY is there. Caught live: a hand-launched vite from
# .claude/worktrees/fix-96-cards-masonry had been holding 1440 since Jul 13, so our
# own vite died with EADDRINUSE while wait_live happily saw the port up and reported
# "live", writing that stranger's URL to the card. Same "user tests a lie" outcome as
# reusing main, just through a different door.
#
# We launch core as `bun run <wt>/core/src/server.ts` and vite out of <wt>/app, so the
# worktree path is in the listener's own command line. Trailing slash so a worktree
# name that prefixes another (…-895-3 vs …-895-33) can't match.
port_from_worktree(){
  local port="$1" wt="$2" pids p cmd
  pids=$(lsof -ti tcp:"$port" -sTCP:LISTEN 2>/dev/null)
  [ -n "$pids" ] || return 1
  for p in $pids; do
    cmd=$(ps -o command= -p "$p" 2>/dev/null)
    case "$cmd" in *"$wt/"*) return 0 ;; esac
  done
  return 1
}

# 0 iff a REAL, ours-and-answering preview for worktree $3 is on the pair $1/$2
preview_live(){
  local vite="$1" core="$2" wt="$3"
  port_from_worktree "$vite" "$wt" && port_from_worktree "$core" "$wt" && core_alive "$core"
}

# 0 iff each port is free or already ours — i.e. nobody else is squatting the pair
ports_free_or_ours(){
  local vite="$1" core="$2" wt="$3" p
  for p in "$vite" "$core"; do
    port_listening "$p" || continue
    port_from_worktree "$p" "$wt" || return 1
  done
  return 0
}

# describes whoever holds $1, for a refusal message the user can act on
port_holder(){
  local pids p
  pids=$(lsof -ti tcp:"$1" -sTCP:LISTEN 2>/dev/null)
  for p in $pids; do printf 'pid %s: %s\n' "$p" "$(ps -o command= -p "$p" 2>/dev/null | cut -c1-110)"; done
}

# prints "vite core" and returns 0 iff the card's recorded preview is actually live
card_live_ports(){
  local pv v c
  pv=$(fm "$1" preview); v=$(vite_port_of "$pv")
  [ -n "$v" ] || return 1
  c=$((v + 2900))
  port_listening "$v" && port_listening "$c" && core_alive "$c" || return 1
  printf '%s %s\n' "$v" "$c"
}

# every vite port the BOARD has already handed out, one per line, skipping card $1
board_claimed_ports(){
  local skip="${1:-}" skip_b f pv v
  skip_b=$([ -n "$skip" ] && basename "$skip" || echo "")
  while IFS= read -r -d '' f; do
    [ -n "$skip_b" ] && [ "$(basename "$f")" = "$skip_b" ] && continue
    pv=$(fm "$f" preview); v=$(vite_port_of "$pv")
    [ -n "$v" ] && printf '%s\n' "$v"
  done < <(find "$DIR" -maxdepth 1 -name '*.md' -print0)
}

# prints "vite core" for card $1: its OWN recorded port if it has one, else the lowest
# x>=2 whose 143x no OTHER card claims. Pure function of the board — the same board
# always yields the same ports, so a card's URL is stable across restarts and does not
# depend on what happened to be listening when start ran. Preserving a card's recorded
# port is what keeps the hand-assigned 1432/#87, 1433/#107, 1435/daemon-chats alive.
assign_ports(){
  local card="$1" pv v claimed x
  pv=$(fm "$card" preview); v=$(vite_port_of "$pv")
  if [ -n "$v" ]; then printf '%s %s\n' "$v" "$((v + 2900))"; return 0; fi
  claimed=$(board_claimed_ports "$card")
  x=2
  while [ "$x" -le 97 ]; do
    v=$((1430 + x))
    if ! printf '%s\n' "$claimed" | grep -qx "$v"; then
      printf '%s %s\n' "$v" "$((v + 2900))"; return 0
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

# prints the path of an EXISTING, REUSABLE worktree whose HEAD == $1, if any
# (read-only — does not create). Handles both "reuse the lane's original worktree"
# and "reuse a preview worktree we made earlier". Prints nothing when the only
# thing at that sha is the main checkout — cmd_start then provisions a fresh one.
#
# ONLY worktrees under $WT_DIR are reusable. The main checkout is deliberately
# excluded: lane branches routinely sit at main's tip, and `git worktree list` puts
# main FIRST, so a naive head -1 hands back the user's own checkout whenever the
# target sha == main's HEAD. That would serve MAIN's code at the URL we then write
# to the card — the user "confirms" a change they never actually saw. This function
# existing at all is what keeps that from being reachable.
find_existing_worktree(){
  local target="$1" line p="" h cand="" pick
  while IFS= read -r line; do
    case "$line" in
      "worktree "*) p=${line#worktree } ;;
      "HEAD "*)
        h=${line#HEAD }
        if [ "$h" = "$target" ]; then
          case "$p" in "$WT_DIR"/*) cand="$cand$p
" ;; esac
        fi ;;
    esac
  done < <(git worktree list --porcelain)
  [ -z "$cand" ] && return 0
  # several worktrees can share a HEAD (e.g. a dead lane + our own preview-* copy) —
  # prefer one already named preview-*, else take the first, but always exactly one.
  pick=$(printf '%s' "$cand" | grep '/preview-' | head -1)
  [ -z "$pick" ] && pick=$(printf '%s' "$cand" | head -1)
  printf '%s\n' "$pick"
}

# Is $1 (an absolute, symlink-resolved worktree path) dependency-healthy?
#
# The link that actually matters is core/node_modules/@bismuth/memory. core/src/server.ts
# -> chat.ts does `import "@bismuth/memory"`, so a worktree whose core can't resolve it
# does not boot (verified against the stale ios-app worktree, whose install predates the
# memory workspace), and one resolving OUTSIDE the worktree would be running MAIN's code
# behind the card's URL. bun links workspaces RELATIVELY
# (core/node_modules/@bismuth/memory -> ../../../memory), so a healthy worktree always
# resolves inside itself — checked against all 30 worktrees.
#
# The predecessor tested $wt/node_modules/@bismuth/core, which exists in NO node_modules
# in this repo and never will: bun only materialises a workspace link where a package.json
# DECLARES the dep, and only cli declares @bismuth/core (app/core import core by relative
# path). The guard was therefore always false, so every start "repaired" a healthy tree.
deps_ok(){
  local wt_abs="$1" link resolved
  [ -d "$wt_abs/node_modules" ] || return 1
  link="$wt_abs/core/node_modules/@bismuth/memory"
  [ -e "$link" ] || return 1
  resolved=$(cd "$link" 2>/dev/null && pwd -P) || return 1
  case "$resolved" in "$wt_abs"/*) return 0 ;; *) return 1 ;; esac
}

# Repair deps by INSTALLING, never by deleting. `bun install` is idempotent and relinks
# workspaces in place, so there is nothing rm -rf buys us — and a wrong guard in front of
# an `rm -rf node_modules` is how this script nearly deleted main's 1.6G node_modules out
# from under the user's own running vite. Re-check after installing so a repair that
# didn't work fails LOUDLY instead of silently "succeeding" every single start.
ensure_deps(){
  local wt="$1" wt_abs
  wt_abs=$(cd "$wt" 2>/dev/null && pwd -P) || { echo "no such worktree: $wt" >&2; return 1; }
  deps_ok "$wt_abs" && return 0
  echo "  bun install in $wt (workspace links incomplete)"
  (cd "$wt_abs" && bun install) || return 1
  deps_ok "$wt_abs" && return 0
  echo "  bun install ran but @bismuth/memory still does not resolve inside $wt" >&2
  return 1
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

# waits for OUR servers — a stranger already on the port can no longer satisfy this
wait_live(){
  local vite="$1" core="$2" wt="$3" tries=30
  while [ "$tries" -gt 0 ]; do
    preview_live "$vite" "$core" "$wt" && return 0
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

  # NB: the "already live?" question can only be answered once we know which worktree
  # this card's preview must run from — see the ownership check below. Asking it before
  # that (as this used to) means "somebody is on the port" gets mistaken for "we are".

  target=$(resolve_target_sha "$card") || {
    echo "REFUSE — $name has no usable landed^2 or worktree branch. Not guessing." >&2
    exit 1
  }
  # never the main checkout — see find_existing_worktree
  wt_path=$(find_existing_worktree "$target")
  if [ -z "$wt_path" ]; then
    wt_path="$WT_DIR/preview-$slug"
    echo "provisioning worktree at $wt_path ($target)"
    git worktree add --detach "$wt_path" "$target" || exit 1
  else
    echo "reusing existing worktree: $wt_path"
  fi

  ensure_deps "$wt_path" || { echo "deps unusable in $wt_path" >&2; exit 1; }

  ports=$(assign_ports "$card") || { echo "no free preview ports left" >&2; exit 1; }
  v=${ports%% *}; c=${ports##* }

  # Already up AND actually ours -> idempotent no-op.
  if preview_live "$v" "$c" "$wt_path"; then
    "$BOARD_WRITE" "$card" preview "http://localhost:$v" >/dev/null
    echo "already live: $name -> http://localhost:$v"
    exit 0
  fi

  # Someone ELSE holds this card's pair. Refuse: launching now would fail on
  # --strictPort/EADDRINUSE while the stranger keeps answering, and we would write
  # THEIR url to the card. Never adopt a server we did not start.
  if ! ports_free_or_ours "$v" "$c" "$wt_path"; then
    echo "REFUSE — $name's ports ($v/$c) are held by something that is not its preview:" >&2
    { port_holder "$v"; port_holder "$c"; } | sed 's/^/  /' >&2
    echo "  stop that process (or previews.sh gc --run if it is an orphan), then retry." >&2
    exit 1
  fi

  echo "launching core:$c vite:$v (logs: $LOGDIR/$slug.{core,vite}.log)"
  launch_servers "$wt_path" "$v" "$c" "$slug"

  if wait_live "$v" "$c" "$wt_path"; then
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
  local raw="${1:-}" card name pv v c p pids pid cmd target wt_path killed
  [ -n "$raw" ] || { echo "usage: previews.sh stop <card>" >&2; exit 2; }
  card=$(resolve_card "$raw")
  [ -f "$card" ] || { echo "no such card: $card" >&2; exit 1; }
  name=$(basename "$card" .md)
  pv=$(fm "$card" preview); v=$(vite_port_of "$pv")
  if [ -z "$v" ]; then
    echo "  no preview recorded for: $name"
  else
    c=$((v + 2900))
    # Kill ONLY processes launched out of this card's worktree. A recorded port is not
    # a licence to kill whoever happens to hold it now — that could be the user's own
    # dev server or another card's preview that legitimately took the port later.
    target=$(resolve_target_sha "$card") && wt_path=$(find_existing_worktree "$target") || wt_path=""
    if [ -z "$wt_path" ]; then
      echo "  can't resolve $name's worktree — not killing anything on $v/$c." >&2
      echo "  (if those are orphans, previews.sh gc --run is the tool for that.)" >&2
    else
      killed=0
      for p in "$v" "$c"; do
        pids=$(lsof -ti tcp:"$p" -sTCP:LISTEN 2>/dev/null || true)
        for pid in $pids; do
          cmd=$(ps -o command= -p "$pid" 2>/dev/null)
          case "$cmd" in
            *"$wt_path/"*) kill "$pid" 2>/dev/null; echo "  killed pid $pid on port $p"; killed=1 ;;
            *) echo "  left pid $pid on port $p alone — not $name's preview" >&2 ;;
          esac
        done
      done
      [ "$killed" = 0 ] && echo "  nothing of $name's was running"
    fi
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

# Sourced with PREVIEWS_LIB=1 (scripts/previews.test.ts) -> expose the functions above
# and run no command. Executed normally -> dispatch.
[ "${PREVIEWS_LIB:-0}" = "1" ] && return 0

case "${1:-}" in
  status) cmd_status ;;
  start)  shift; cmd_start "${1:-}" ;;
  stop)   shift; cmd_stop "${1:-}" ;;
  sync)   cmd_sync ;;
  gc)     shift; cmd_gc "${1:-}" ;;
  *) echo "usage: previews.sh {status|start <card>|stop <card>|sync|gc [--run]}" >&2; exit 2 ;;
esac
