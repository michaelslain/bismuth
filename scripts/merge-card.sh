#!/usr/bin/env bash
# merge-card.sh — the gated merge. Fails CLOSED and auto-reverts a red merge.
#
# WHY THIS EXISTS: "the review must say isReal before you merge" and "the merge stays
# only if the regression guard is GREEN" were prose rules, which means they were two
# judgement calls made by a tired operator at the end of a long lane. One refuted
# build nearly shipped because isReal:false is easy to skim past. Here the review
# verdict is PARSED, not read, and a red guard rolls the merge back automatically —
# main cannot be left broken by walking away.
#
# WHY THE REVIEW IS BOUND TO A BRANCH + COMMIT: parsing closed the hole at the READING
# step and re-opened it at the TRANSCRIPTION step. The verdict is written by the party
# that wants to merge, so an UNBOUND review is just that party's own assertion wearing
# a JSON costume — a review of branch A would happily merge branch B, and a review
# written at commit 1 still said isReal:true at commit 5 after three re-fixes. So the
# review must NAME what it reviewed, and this gate refuses unless that name is the
# branch being merged AND that commit is the branch's CURRENT tip. A branch that moved
# after its review is an UNREVIEWED branch; it says so and stops. The verdict + the
# reviewed sha are then recorded as trailers on the merge commit itself (not a git
# note: notes live in refs/notes/* and are NOT pushed by default, so the audit trail
# would be silently dropped by the very `git push origin main` that ships the merge).
#
#   merge-card.sh <branch> --review <review.json>   [--card <card>]
#
# review.json is the lane's adversarial review, and MUST identify what it reviewed:
#   { "branch": "<branch>", "commit": "<reviewed tip sha>",
#     "isReal": bool, "blocking": [...], "verdict": "<one-line summary>" }
# `commit` must be a SHA, never a ref: a ref moves, so "commit":"<branch>"/"HEAD"
# would compare the tip to itself and pass the staleness gate unconditionally.
# Missing/malformed/refuted/unbound/unpinned/stale review => refuse. No flag => refuse.
# Exit 0 = merged and GREEN (still unpushed — push + set landed yourself).
set -u
cd "$(git rev-parse --show-toplevel)" || exit 2
VAULT="${BISMUTH_VAULT:-/Users/michaelslain/Documents/library of alexandria}"
DIR="$VAULT/thoughts/Bismuth Changes"

branch=""; review=""; card=""
while [ $# -gt 0 ]; do
  case "$1" in
    --review) review="${2:-}"; shift 2;;
    --card)   card="${2:-}";   shift 2;;
    -*)       echo "unknown flag: $1" >&2; exit 2;;
    *)        branch="$1"; shift;;
  esac
done
[ -n "$branch" ] || { echo "usage: merge-card.sh <branch> --review <review.json> [--card <card>]" >&2; exit 2; }

# ---- gate 1: the review must exist, be BOUND to this branch+tip, and say real ---
[ -n "$review" ] || { echo "REFUSED — no --review. A lane never merges unreviewed." >&2; exit 1; }
[ -f "$review" ] || { echo "REFUSED — review file not found: $review" >&2; exit 1; }
abs=$(cd "$(dirname "$review")" && pwd)/$(basename "$review")

# the branch must resolve BEFORE we can bind a review to its tip
git rev-parse --verify "$branch" >/dev/null 2>&1 || { echo "REFUSED — no such branch: $branch" >&2; exit 1; }
tip=$(git rev-parse --verify "$branch^{commit}")

# one parse, four lines out: verdict / branch / commit / one-line verdict text
parsed=$(bun -e '
  const fs = require("fs");
  const line = s => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  const say = (v, b, c, t) => process.stdout.write([v, line(b), line(c), line(t).slice(0, 200)].join("\n") + "\n");
  try {
    const r = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const blocking = Array.isArray(r.blocking) ? r.blocking : (r.blocking ? [r.blocking] : []);
    const v = r.isReal !== true ? "REFUTED" : blocking.length ? "BLOCKING:" + blocking.length : "OK";
    say(v, r.branch, r.commit, r.verdict);
  } catch (e) { say("MALFORMED", "", "", ""); }
' "$abs" 2>/dev/null || printf 'MALFORMED\n\n\n\n')

verdict=$(printf '%s\n' "$parsed" | awk 'NR==1')
r_branch=$(printf '%s\n' "$parsed" | awk 'NR==2')
r_commit=$(printf '%s\n' "$parsed" | awk 'NR==3')
r_text=$(printf '%s\n' "$parsed" | awk 'NR==4')

[ "$verdict" = "MALFORMED" ] && { echo "REFUSED — review unreadable/malformed: $review" >&2; exit 1; }

# --- gate 1a: the review must NAME what it reviewed --------------------------
# An unbound verdict is unauthenticated: it is the merging party's own claim, and it
# binds to nothing. Refuse rather than assume it meant this branch at this sha.
if [ -z "$r_branch" ] || [ -z "$r_commit" ]; then
  echo "REFUSED — review does not say what it reviewed (branch=${r_branch:-<missing>} commit=${r_commit:-<missing>})." >&2
  echo "          A review must be bound to its subject. Required schema:" >&2
  echo '          { "branch": "<branch>", "commit": "<reviewed tip sha>", "isReal": bool, "blocking": [], "verdict": "<summary>" }' >&2
  exit 1
fi

# commit must be an object NAME (hex sha), not just any revision git can resolve.
# A ref MOVES: "commit":"lane-b" (or "HEAD") makes gate 1c compare the tip against
# itself, so it passes unconditionally and the gate cheerfully prints "bound to
# lane-b@<tip>" — the unbound hole, reopened through the front door. A sha names one
# immutable commit; that is the whole point of binding. (Short shas are fine: they
# still name a fixed object.)
sha_shaped=1
case "$r_commit" in *[!0-9a-fA-F]*) sha_shaped=0;; esac
[ ${#r_commit} -ge 7 ] || sha_shaped=0
if [ "$sha_shaped" = 0 ]; then
  echo "REFUSED — review.commit '$r_commit' is not a commit sha." >&2
  echo "          A branch/ref moves, so it binds the review to nothing — record the sha" >&2
  echo "          the reviewer actually read: git rev-parse $r_branch" >&2
  exit 1
fi

# --- gate 1b: that name must be the branch we are actually merging -------------
b_norm=${branch#refs/heads/}; rb_norm=${r_branch#refs/heads/}
if [ "$rb_norm" != "$b_norm" ]; then
  echo "REFUSED — review is for branch '$rb_norm', but you are merging '$b_norm'." >&2
  echo "          A review of one branch does not license the merge of another." >&2
  exit 1
fi

# --- gate 1c: the reviewed commit must still be the branch's tip ---------------
# If the branch moved after the review, the review describes code that is no longer
# what would land. That is not a merge with a stale review; it is an UNREVIEWED merge.
r_full=$(git rev-parse --verify "${r_commit}^{commit}" 2>/dev/null) || {
  echo "REFUSED — reviewed commit '$r_commit' does not exist in this repo." >&2; exit 1; }
if [ "$r_full" != "$tip" ]; then
  if git merge-base --is-ancestor "$r_full" "$tip" 2>/dev/null; then
    since=$(git rev-list --count "$r_full..$tip")
    echo "REFUSED — branch has $since commit(s) since review; re-review required." >&2
    echo "          reviewed $(git rev-parse --short "$r_full") but '$b_norm' is now at $(git rev-parse --short "$tip"):" >&2
    git log --oneline "$r_full..$tip" | sed 's/^/            /' >&2
  else
    echo "REFUSED — reviewed commit $(git rev-parse --short "$r_full") is not on '$b_norm' (rebased/reset since review?)." >&2
    echo "          The review describes code that is not what would land. Re-review required." >&2
  fi
  exit 1
fi

# --- gate 1d: and only then, what the review actually concluded ----------------
case "$verdict" in
  OK) echo "review: isReal, no blocking issues — bound to $b_norm@$(git rev-parse --short "$tip").";;
  REFUTED)    echo "REFUSED — review says isReal:false. Fix it in the worktree, re-review." >&2; exit 1;;
  BLOCKING:*) echo "REFUSED — review lists ${verdict#BLOCKING:} blocking issue(s). Fix them first." >&2; exit 1;;
  *)          echo "REFUSED — review unreadable/malformed ($verdict): $review" >&2; exit 1;;
esac

# ---- gate 2: the tree and the branch must be sane ------------------------------
[ -z "$(git status --porcelain)" ] || { echo "REFUSED — working tree dirty; commit/stash first." >&2; exit 1; }
git switch main >/dev/null 2>&1 || { echo "REFUSED — cannot switch to main" >&2; exit 1; }
ahead=$(git rev-list --count "main..$branch")
[ "$ahead" -gt 0 ] || { echo "REFUSED — $branch has no commits main doesn't already have." >&2; exit 1; }
echo "merging $branch ($ahead commit(s)) -> main"

before=$(git rev-parse HEAD)

# ---- merge --------------------------------------------------------------------
# The verdict rides ON the merge commit as trailers, so the merge stays auditable
# after review.json (usually a temp file) is gone: `git log --format='%(trailers)'`,
# or `git log --grep='^Review-Commit:' main`. Trailers travel with the push; a git
# note would not (refs/notes/* is not pushed by default).
# (isReal:true + zero blocking are not transcribed here on faith — gate 1d above
#  exits non-zero on anything but OK, so reaching this line proves both.)
msg="Merge branch '$b_norm' — reviewed at $(git rev-parse --short "$tip")

Review-Branch: $b_norm
Review-Commit: $tip
Review-Gate: $verdict
Review-File: $abs"
[ -n "$r_text" ] && msg="$msg
Review-Verdict: $r_text"

if ! git merge --no-ff -m "$msg" "$branch"; then
  echo "MERGE CONFLICT — resolve by keeping BOTH features, then re-run." >&2
  git merge --abort 2>/dev/null
  exit 1
fi
after=$(git rev-parse HEAD)

# ---- gate 3: the guard decides whether the merge survives ----------------------
echo
if scripts/regression-guard.sh; then
  echo
  echo "MERGED + GREEN: $after"
  [ -n "$card" ] && echo "next: git push origin main && scripts/board-write.sh \"$card\" landed $after"
  [ -n "$card" ] || echo "next: git push origin main, then set the card's landed to $after"
  exit 0
fi

echo
echo "RED — rolling the merge back automatically (main must never be left broken)." >&2
git reset --hard "$before" >/dev/null 2>&1
echo "main restored to $before. The lane's work is still on '$branch' — fix it there." >&2
exit 1
