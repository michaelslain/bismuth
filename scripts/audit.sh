#!/usr/bin/env bash
# audit.sh — paper vs practice. Does this system still match the skill that describes it?
#
# WHY THIS EXISTS: every failure this workflow has ever had has ONE shape — the skill
# says X, reality is Y, and nobody checked. In a single session: an operator ran a whole
# day against a stale board; nearly merged a review that said isReal:false; let 33
# worktrees (22 already merged into main) pile up; left five dead servers running, one
# squatting the user's own :4321; and, while "cleaning up orphans", killed all four LIVE
# previews with a fall-through case statement. Every one of those was a documented rule
# with no enforcement, and every one was caught by a human noticing, hours late. This
# script is that noticing, automated.
#
# It is also the gate that keeps the OTHER gates honest. lane-status/preflight/board-write/
# merge-card each enforce one rule; nothing checked whether the rules still describe the
# system — so the paper drifts, and drifted paper is what an operator obeys.
#
# CONTRADICTIONS ONLY — never a status dump. Each finding says what the skill CLAIMS,
# what is TRUE, and the one command that fixes it. Silence + exit 0 when the board and
# reality agree; that silence is the whole point, because a noisy auditor gets ignored.
# (board-scan.sh already prints the board. This prints only where the board is lying.)
#
#   audit.sh              audit the board + repo against the skill   (exit 1 if contradicted)
#   audit.sh --fix-paper  also name the SKILL.md claims that are FALSE of this system, so a
#                         human corrects the PAPER instead of papering over reality
#
# READ-ONLY, ALWAYS: it never writes a card, never kills a process, never removes a
# worktree. It prints the command; a human runs it. An operator that killed first and
# identified second is precisely why this file exists.
# bash 3.2 compatible (macOS system bash) — no associative arrays.
set -u
VAULT="${BISMUTH_VAULT:-/Users/michaelslain/Documents/library of alexandria}"
DIR="$VAULT/thoughts/Bismuth Changes"
cd "$(git rev-parse --show-toplevel)" || exit 2
[ -d "$DIR" ] || { echo "board dir not found: $DIR" >&2; exit 2; }

FIX_PAPER=0
case "${1:-}" in
  --fix-paper) FIX_PAPER=1;;
  "") ;;
  *) echo "usage: audit.sh [--fix-paper]" >&2; exit 2;;
esac

fm() { awk -v k="$2" '{ if ($0 ~ "^"k":") { sub(/^[^:]*: */, ""); print; exit } }' "$1"; }

# SKILL.md lives in the MAIN working tree — .claude/ is untracked, so a linked worktree
# has no copy of it. Find the main tree via the SHARED git dir rather than hardcoding.
common=$(git rev-parse --git-common-dir)
case "$common" in /*) ;; *) common="$PWD/$common";; esac
MAIN_REPO=$(cd "$(dirname "$common")" && pwd)
SKILL="$MAIN_REPO/.claude/skills/bismuth-flow/SKILL.md"

n=0
say() { # slug | subject | paper-claim | what-is-true | the one fix
  [ $n = 0 ] && { echo "== audit: the board says one thing, reality says another =="; }
  n=$((n + 1))
  echo
  echo "✗ $1 — $2"
  echo "   paper  $3"
  echo "   real   $4"
  echo "   fix    $5"
}

# ---- is a preview genuinely usable? -------------------------------------------------
# A listening port is NOT a working server. The vite dev server answers 200 on ANY path
# (SPA fallback), so curling /version on 143x proves only that vite is up — the user can
# still open a page that loads nothing. The truth is two-part: vite serves the app AND
# the core it was launched against answers. We read that core from the vite process's OWN
# env (VITE_API_BASE) instead of guessing the 143x→433x convention — and a preview whose
# vite has NO VITE_API_BASE is its own trap: the frontend silently falls back to :4321,
# so the user would be testing their own dev server instead of the card's build.
preview_state() { # $1 url -> LIVE | DEAD | DEFAULTED | BADURL | "NOCORE <api>"
  local url="$1" port pid api
  port=${url##*:}; port=${port%%/*}
  case "$port" in ''|*[!0-9]*) echo BADURL; return;; esac
  curl -sf -m 3 -o /dev/null "http://localhost:$port/" 2>/dev/null || { echo DEAD; return; }
  pid=$(lsof -ti "tcp:$port" -sTCP:LISTEN 2>/dev/null | head -1)
  [ -n "$pid" ] || { echo DEAD; return; }
  api=$(ps eww -p "$pid" 2>/dev/null | tr ' ' '\n' | sed -n 's/^VITE_API_BASE=//p' | head -1)
  [ -n "$api" ] || { echo DEFAULTED; return; }
  curl -sf -m 3 "$api/version" 2>/dev/null | grep -q '"version"' || { echo "NOCORE $api"; return; }
  echo LIVE
}

wt_of_pid() { # $1 pid -> the worktree dir it runs from ("" if unknowable)
  local d
  d=$(lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)
  [ -n "$d" ] || return 0
  printf '%s' "${d%/app}"   # vite is launched from <worktree>/app; core from the root
}

card_for() { # $1 a possibly-truncated card name (lane-status pads/truncates to 46) -> real name
  local hit
  hit=$(find "$DIR" -maxdepth 1 -name "$1*.md" -print 2>/dev/null | head -1)
  if [ -n "$hit" ]; then basename "$hit" .md; else printf '%s' "$1"; fi
}

PREVIEW_WTS=""   # "<worktree dir>|<card>" per line — filled below, used by the GC check

# ---- per-card checks: preview invariant, landed-vs-git, triage, status-vs-git --------
while IFS= read -r -d '' f; do
  name=$(basename "$f" .md)
  st=$(fm "$f" status); ty=$(fm "$f" type); wt=$(fm "$f" worktree)
  ld=$(fm "$f" landed);  pv=$(fm "$f" preview)

  # (1) THE PREVIEW INVARIANT — a card in the user's court they cannot click is rot.
  case "$st" in "Awaiting Confirmation"|"Done but Broken")
    if [ -z "$pv" ]; then
      say preview-missing "$name" \
        "SKILL.md 'EVERY card in Awaiting Confirmation has a live preview link. No exceptions, ever.'" \
        "preview: is empty — the column says it's the user's turn, but there is nothing to open" \
        "provision at ${ld:-<landed>}^2, then: scripts/board-write.sh '$name' preview http://localhost:143x"
    else
      state=$(preview_state "$pv")
      pwt=""
      case "$state" in
        LIVE)
          pid=$(lsof -ti "tcp:${pv##*:}" -sTCP:LISTEN 2>/dev/null | head -1)
          [ -n "$pid" ] && pwt=$(wt_of_pid "$pid")
          [ -n "$pwt" ] && PREVIEW_WTS="$PREVIEW_WTS$pwt|$name"$'\n'
          ;;
        DEAD)
          say preview-dead "$name" \
            "SKILL.md 'a stale link is as bad as none — never leave the column with a card the user can't click'" \
            "preview: $pv — nothing is listening; the user clicks it and gets a connection refused" \
            "relaunch core+vite for this card off ${ld:-<landed>}^2 (see the SKILL's provisioning steps)"
          ;;
        NOCORE*)
          say preview-half-dead "$name" \
            "SKILL.md 'EVERY card in Awaiting Confirmation has a LIVE preview link'" \
            "preview: $pv — vite is up but its core (${state#NOCORE }) is dead: the page opens and loads nothing" \
            "restart the core: bun run core/src/server.ts --port ${state##*:} --vault \"$VAULT\" --memory \"$VAULT/.daemon/memory\""
          ;;
        DEFAULTED)
          say preview-tests-a-lie "$name" \
            "SKILL.md 'launch against the REAL vault ... VITE_API_BASE=http://localhost:433x' (the preview must serve THIS card's build)" \
            "preview: $pv has no VITE_API_BASE — the frontend falls back to :4321, so the user would test their OWN dev server, not this card" \
            "kill that vite and relaunch it with VITE_API_BASE=http://localhost:433x pointing at this card's core"
          ;;
        BADURL)
          say preview-malformed "$name" \
            "SKILL.md schema: preview (text — the card's http://localhost:143x URL)" \
            "preview: '$pv' has no usable port" \
            "scripts/board-write.sh '$name' preview http://localhost:143x"
          ;;
      esac
    fi
  ;; esac

  # (3) landed is defined as "the merge sha on main" — so it must BE on main.
  if [ -n "$ld" ]; then
    if ! git rev-parse --verify --quiet "$ld^{commit}" >/dev/null 2>&1; then
      say landed-ghost "$name" \
        "SKILL.md schema: landed (text — the merge sha on main)" \
        "landed: $ld is not a commit in this repo at all" \
        "find the real merge (git log --oneline --grep '$name') then: scripts/board-write.sh '$name' landed <sha>"
    elif ! git merge-base --is-ancestor "$ld" main 2>/dev/null; then
      say landed-not-on-main "$name" \
        "SKILL.md schema: landed (text — the merge sha on main); the card claims it shipped" \
        "landed: $ld exists but is NOT an ancestor of main — main does not contain this work" \
        "re-merge via the gate: scripts/merge-card.sh ${wt:-<branch>} --review <review.json> --card '$name'"
    fi
  fi

  # (7) status vs git, both directions.
  case "$st" in
    "Awaiting Confirmation"|"Done but Broken"|Done)
      [ -z "$ld" ] && say shipped-without-proof "$name" \
        "SKILL.md 'landed is the only durable proof a card actually shipped'; this column means it shipped" \
        "status '$st' but landed: is empty — git has no record this was ever merged" \
        "scripts/lane-status.sh, then: scripts/board-write.sh '$name' landed <sha>"
      ;;
    Todo)
      if [ -n "$ld" ]; then
        say todo-already-shipped "$name" \
          "SKILL.md 'Todo is a queue' — a Todo card has not been built" \
          "status Todo but landed: $ld — git says this already merged; building it would rebuild shipped work" \
          "scripts/board-write.sh '$name' status 'Awaiting Confirmation'"
      elif [ -n "$wt" ] && git rev-parse --verify --quiet "$wt^{commit}" >/dev/null 2>&1 &&
           git merge-base --is-ancestor "$wt" main 2>/dev/null; then
        say todo-already-merged "$name" \
          "SKILL.md 'Todo is a queue' — a Todo card has not been built" \
          "status Todo but branch '$wt' is already an ancestor of main — the work is IN main" \
          "scripts/board-write.sh '$name' landed \$(git log --oneline --merges --ancestry-path $wt..main | tail -1 | awk '{print \$1}')"
      fi
      ;;
  esac

  # (6) untriaged card sitting in a buildable column. (In Progress + no worktree is
  #     lane-status.sh's ORPHANED — left to it so this doesn't double-report.)
  case "$st" in Todo|"In Progress"|"Done but Broken")
    [ -z "$ty" ] && say untriaged-no-type "$name" \
      "SKILL.md 'preflight.sh must exit 0 before you fan ANYTHING out' — it refuses a card with no type" \
      "status '$st' (a buildable column) but type: is empty — preflight will REFUSE it, so it can never move" \
      "triage it: scripts/board-write.sh '$name' type <bug|feature|design|idea|question>"
    if [ -z "$wt" ] && [ "$st" != "In Progress" ]; then
      say untriaged-no-worktree "$name" \
        "SKILL.md 'worktree (text — the ONE authoritative branch)'; preflight refuses a card without one" \
        "status '$st' (a buildable column) but worktree: is empty — preflight will REFUSE it, so it can never move" \
        "triage it: scripts/board-write.sh '$name' worktree <branch-name>"
    fi
  ;; esac
done < <(find "$DIR" -maxdepth 1 -name '*.md' -print0)

# ---- (2) In Progress must have a lane that exists — ask lane-status.sh, don't re-derive
if [ -x scripts/lane-status.sh ]; then
  # Fields 2+ only, and stop at the DRIFT footer: that footer's own lines START with
  # MERGED/UNMERGED/ORPHANED (they're the remediation legend) and must never be read as
  # cards. Fed in by process substitution, not a pipe, so say() can still raise n.
  while IFS='|' read -r verdict nm; do
    [ -n "$nm" ] || continue
    card=$(card_for "$nm")
    case "$verdict" in
      MERGED)   fix="scripts/board-write.sh '$card' landed <sha> && scripts/board-write.sh '$card' status 'Awaiting Confirmation'";;
      UNMERGED) fix="review it, then: scripts/merge-card.sh <branch> --review <review.json> --card '$card'";;
      *)        fix="git log --oneline --grep '$card' main   # find the work BEFORE rebuilding it";;
    esac
    say "lane-$(printf '%s' "$verdict" | tr 'A-Z' 'a-z')" "$card" \
      "SKILL.md 'In Progress means a lane is building it RIGHT NOW. If no lane is running, that card is a LIE.'" \
      "lane-status.sh says $verdict — no live lane owns this card" \
      "$fix"
  done < <(scripts/lane-status.sh 2>/dev/null | awk '
    /^DRIFT/ { exit }
    { for (i = 2; i <= NF; i++)
        if ($i ~ /^(MERGED|UNMERGED|ORPHANED|UNVERIFIABLE)$/) {
          nm = $1; for (j = 2; j < i; j++) nm = nm " " $j
          print $i "|" nm; break
        } }
  ')
fi

# ---- (4) worktree hygiene ------------------------------------------------------------
gc=$(scripts/gc-worktrees.sh 2>/dev/null)
merged_wts=$(printf '%s\n' "$gc" | sed -n 's/^MERGED  remove //p')
merged_n=$(printf '%s' "$merged_wts" | grep -c . )
if [ "$merged_n" -gt 0 ]; then
  # A merged worktree that is SERVING a card's live preview is not a GC candidate —
  # it is a trap. gc-worktrees.sh has no idea cards exist, so `--run` would delete the
  # very thing the user is being asked to test. Report those separately and loudly.
  guarded=""
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    p=${line##*(}; p=${p%)}
    hit=$(printf '%s' "$PREVIEW_WTS" | awk -F'|' -v d="$p" '$1 == d { print $2; exit }')
    [ -n "$hit" ] && guarded="$guarded$p|$hit"$'\n'
  done < <(printf '%s\n' "$merged_wts")

  if [ -n "$guarded" ]; then
    while IFS='|' read -r p c; do
      [ -n "$c" ] || continue
      say gc-would-kill-a-live-preview "$c" \
        "SKILL.md 'Every cycle: gc-worktrees.sh (it keeps unmerged + locked; it is safe)' AND 'Never GC an Awaiting-Confirmation worktree'" \
        "both cannot be true: this card's LIVE preview is served from $p, whose branch is merged — gc-worktrees.sh --run would DELETE it" \
        "do NOT run gc --run while this card is open; see audit.sh --fix-paper (the paper is wrong, not you)"
    done < <(printf '%s' "$guarded")
  fi

  guard_n=$(printf '%s' "$guarded" | grep -c . )
  safe_n=$((merged_n - guard_n))
  if [ "$safe_n" -gt 0 ]; then
    note=""
    [ "$guard_n" -gt 0 ] && note=" — but $guard_n of them serve a live preview (above), so --run is NOT safe as-is"
    say worktree-debris "$safe_n merged worktree(s) are GC candidates" \
      "SKILL.md 'cleanup happens at Done' + 'Every cycle: gc-worktrees.sh' — merged worktrees do not accumulate" \
      "$merged_n worktree(s) are fully merged into main and still on disk$note" \
      "scripts/gc-worktrees.sh          # dry-run, read it, THEN --run"
  fi
fi

# ---- (5) orphan servers — REPORT ONLY, NEVER KILL ------------------------------------
# The one rule with a body count: an operator "cleaning up orphans" matched a fall-through
# case and killed all four LIVE previews. So this identifies, prints, and stops. A human
# re-reads ps for that exact pid and decides. Default-deny, never default-kill.
wt_paths=$(git worktree list --porcelain | sed -n 's/^worktree //p')
while read -r pid cmd; do
  [ -n "${pid:-}" ] || continue
  reason=""
  case "$cmd" in *--vault*)
    v=$(printf '%s' "$cmd" | sed -n 's/.*--vault //p' | sed 's/ --.*//')
    case "$v" in /tmp/*|/private/tmp/*) reason="its --vault is a throwaway under /tmp ($v) — nobody is testing this";; esac
  ;; esac
  if [ -z "$reason" ]; then
    d=$(wt_of_pid "$pid")
    # Only judge servers running from THIS repo's tree — someone else's project having a
    # vite up is not our contradiction, and an auditor that cries about unrelated
    # processes is one an operator learns to skip.
    case "${d:-/nowhere}" in "$MAIN_REPO"/*|"$MAIN_REPO") ;; *) d="";; esac
    if [ -n "$d" ] && ! printf '%s\n' "$wt_paths" | grep -qxF "$d"; then
      if [ -d "$d" ]; then reason="it runs from $d, which is no longer a registered git worktree"
      else reason="the worktree it runs from is GONE from disk ($d)"; fi
    fi
  fi
  [ -n "$reason" ] || continue
  say orphan-server "pid $pid — $(printf '%s' "$cmd" | sed 's|.*/||' | cut -c1-40)" \
    "SKILL.md 'kill preview servers whose card is gone' — no server outlives its worktree" \
    "$reason" \
    "VERIFY THEN DECIDE — never kill on a heuristic: ps -p $pid -o command=   # then kill $pid only if that is still it"
done < <(ps -axo pid=,command= | grep -E 'core/src/server\.ts|\.bin/vite|bun run vite' | grep -v grep)

# ---- --fix-paper: claims in SKILL.md that are FALSE of this system --------------------
# NOT "the board drifted" — these are places where the PAPER is wrong, so fixing the board
# would be papering over it. This script never edits SKILL.md; it points, a human writes.
if [ "$FIX_PAPER" = 1 ]; then
  p=0
  paper() { # slug | the claim (with its SKILL.md line) | why it is false | what the paper should say
    [ $p = 0 ] && { echo; echo "== --fix-paper: SKILL.md claims that are not true of this system =="; }
    p=$((p + 1))
    echo
    echo "✗ $1"
    echo "   claims  $2"
    echo "   false   $3"
    echo "   correct $4"
  }

  if [ ! -f "$SKILL" ]; then
    echo; echo "-- cannot audit the paper: SKILL.md not found at $SKILL" >&2
  else
    # a) every script the skill tells the operator to run must exist
    for s in $(grep -oE '[a-zA-Z0-9_-]+\.sh' "$SKILL" | sort -u); do
      [ -f "scripts/$s" ] && continue
      ln=$(grep -n "$s" "$SKILL" | head -1 | cut -d: -f1)
      paper "missing-script — $s" \
        "SKILL.md:${ln:-?} tells the operator to run \`$s\`" \
        "scripts/$s does not exist — the instruction cannot be followed, and this is the remedy the skill names for a rule it calls an invariant" \
        "either write scripts/$s or replace that sentence with the command that actually works"
    done

    # b) the GC claim vs. previews (only assert it when we can SHOW it)
    if [ -n "${guarded:-}" ]; then
      ln=$(grep -n 'it is safe' "$SKILL" | head -1 | cut -d: -f1)
      ln2=$(grep -n 'Never GC an Awaiting-Confirmation worktree' "$SKILL" | head -1 | cut -d: -f1)
      paper "gc-is-not-safe" \
        "SKILL.md:${ln:-?} 'Every cycle: gc-worktrees.sh (it keeps unmerged + locked; it is safe)'" \
        "it is NOT safe: gc-worktrees.sh removes any MERGED worktree, and a card's preview is usually the lane's ORIGINAL worktree at a merged sha (SKILL.md:51 explicitly says to reuse it). Right now --run would delete $(printf '%s' "$guarded" | grep -c .) live preview(s). SKILL.md:${ln2:-?} 'Never GC an Awaiting-Confirmation worktree' is unenforceable prose — gc-worktrees.sh cannot see cards." \
        "make it a script, not a sentence: teach gc-worktrees.sh to skip any worktree whose path serves a card's preview (or that a card's landed^2 resolves to), then the claim becomes true"
    fi

    # c) a surface the skill points the operator at must actually answer
    for u in $(grep -oE 'http://localhost:[0-9]{4}' "$SKILL" | sort -u); do
      port=${u##*:}
      curl -sf -m 2 -o /dev/null "$u/" 2>/dev/null && continue
      ln=$(grep -n "$u" "$SKILL" | head -1 | cut -d: -f1)
      paper "dead-surface — $u" \
        "SKILL.md:${ln:-?} points the operator at $u" \
        "nothing is listening on :$port" \
        "if that surface was superseded (SKILL.md:49 — the user replaced the hosted dashboard with the per-card preview property), delete the claim; if not, the loop step that refreshes it isn't being run"
    done
  fi
  n=$((n + p))
fi

# ---- verdict -------------------------------------------------------------------------
# Healthy = say nothing at all. Anything printed above is a rule this system is breaking.
[ "$n" = 0 ] && exit 0
echo
echo "-- $n contradiction(s). Each is a rule the skill states and nothing enforces."
[ "$FIX_PAPER" = 0 ] && echo "-- if a claim above is wrong ABOUT THE SYSTEM, run: scripts/audit.sh --fix-paper"
exit 1
