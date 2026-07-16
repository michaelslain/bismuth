#!/usr/bin/env bash
# merge-card.test.sh — proves the merge gate REFUSES. Run it after touching merge-card.sh.
#
# WHY THIS EXISTS: merge-card.sh is the only thing standing between a bad lane and
# `main`, and it was itself untested — an unenforced rule and an unproven enforcer rot
# the same way. Every gate here is a hole that was real: a review of branch A merging
# branch B; a verdict written at commit 1 still reading isReal:true at commit 5 after
# three re-fixes; `"commit":"<branch>"` self-comparing to the tip and always passing.
# A gate you never watch refuse is a gate you are trusting on faith.
#
# It runs against a THROWAWAY repo in /tmp (never this one), with a stubbed
# regression-guard so gate 3 can be forced GREEN and RED on demand. Gates 1/1a-1d/2
# are the real script, byte for byte.
#
#   scripts/merge-card.test.sh            -> per-case PASS/FAIL + summary; exit 1 if any FAIL
#   scripts/merge-card.test.sh --verbose  -> also dump each refusal message
set -u
cd "$(git rev-parse --show-toplevel)" || exit 2
SRC="$PWD/scripts/merge-card.sh"
[ -f "$SRC" ] || { echo "no scripts/merge-card.sh here" >&2; exit 2; }
VERBOSE=0; [ "${1:-}" = "--verbose" ] && VERBOSE=1

R="${TMPDIR:-/tmp}/merge-card-test.$$"; J="$R-reviews"
trap 'rm -rf "$R" "$J"' EXIT
rm -rf "$R" "$J"; mkdir -p "$R/scripts" "$J"

# --- a two-lane repo: "a review of branch A merges branch B" must be attemptable ---
cd "$R" || exit 2
git init -q -b main . && git config user.email t@t && git config user.name t
cp "$SRC" scripts/merge-card.sh; chmod +x scripts/merge-card.sh
# The RED marker lives OUTSIDE the repo: an untracked marker inside it would trip
# gate 2 (dirty tree) and the guard would never run — a green-looking non-test.
printf '#!/usr/bin/env bash\n[ -f "%s/.RED" ] && { echo RED; exit 1; }\necho GREEN; exit 0\n' "$J" \
  > scripts/regression-guard.sh; chmod +x scripts/regression-guard.sh
echo base > f.txt; git add -A; git commit -qm base
git switch -qc lane-a; echo a > a.txt; git add -A; git commit -qm "lane A work"
git switch -qc lane-b main; echo b > b.txt; git add -A; git commit -qm "lane B work"
git switch -q main
A=$(git rev-parse lane-a); B=$(git rev-parse lane-b)

# Reviews live OUTSIDE the repo on purpose: a review file inside it is untracked, and
# gate 2 rightly refuses a dirty tree — which would mask the gate actually under test.
j(){ printf '%s\n' "$2" > "$J/$1.json"; }
pass=0; fail=0
# want_refuse <name> <why-regex> <args...>
# The gate must exit non-zero AND refuse for the RIGHT REASON. Asserting only "it
# refused" is theater: delete the wrong-branch gate and that review still gets refused
# one gate later as a stale commit, so a reason-blind test stays green through the very
# regression it exists to catch. Pin the reason.
want_refuse(){
  n="$1"; why="$2"; shift 2
  out=$(scripts/merge-card.sh "$@" 2>&1); rc=$?
  if [ $rc -eq 0 ]; then
    echo "  FAIL  $n — the gate did NOT refuse (exit=0)"; fail=$((fail+1))
  elif ! printf '%s' "$out" | grep -qE "$why"; then
    echo "  FAIL  $n — refused, but not for the expected reason (/$why/):"
    printf '%s\n' "$out" | sed 's/^/        /'; fail=$((fail+1))
  else
    echo "  PASS  $n"; pass=$((pass+1))
  fi
  [ $VERBOSE = 1 ] && printf '%s\n' "$out" | sed 's/^/        | /'
  return 0
}
want_merge(){
  n="$1"; shift
  out=$(scripts/merge-card.sh "$@" 2>&1); rc=$?
  if [ $rc -eq 0 ]; then echo "  PASS  $n"; pass=$((pass+1))
  else echo "  FAIL  $n (exit=$rc — a VALID review was refused)"; echo "$out" | sed 's/^/        /'; fail=$((fail+1)); fi
  [ $VERBOSE = 1 ] && printf '%s\n' "$out" | sed 's/^/        | /'
  return 0
}

echo "== the review must exist and conclude the work is real =="
j refuted  "{\"branch\":\"lane-b\",\"commit\":\"$B\",\"isReal\":false,\"blocking\":[],\"verdict\":\"cannot reproduce\"}"
j blocking "{\"branch\":\"lane-b\",\"commit\":\"$B\",\"isReal\":true,\"blocking\":[\"leaks a handle\"],\"verdict\":\"real but leaky\"}"
printf '{ not json' > "$J/malformed.json"
want_refuse "no --review at all"            "no --review"                    lane-b
want_refuse "review file missing"           "review file not found"          lane-b --review "$J/nope.json"
want_refuse "review malformed"              "malformed"                      lane-b --review "$J/malformed.json"
want_refuse "isReal:false"                  "isReal:false"                   lane-b --review "$J/refuted.json"
want_refuse "non-empty blocking[]"          "1 blocking issue"               lane-b --review "$J/blocking.json"

echo "== the review must be BOUND to what it reviewed =="
j unbound      "{\"isReal\":true,\"blocking\":[],\"verdict\":\"looks good to me\"}"
j nocommit     "{\"branch\":\"lane-b\",\"isReal\":true,\"blocking\":[],\"verdict\":\"no sha\"}"
j wrongbranch  "{\"branch\":\"lane-a\",\"commit\":\"$A\",\"isReal\":true,\"blocking\":[],\"verdict\":\"lane A is real\"}"
j refname      "{\"branch\":\"lane-b\",\"commit\":\"lane-b\",\"isReal\":true,\"blocking\":[],\"verdict\":\"self-referential\"}"
j headref      "{\"branch\":\"lane-b\",\"commit\":\"HEAD\",\"isReal\":true,\"blocking\":[],\"verdict\":\"HEAD moves\"}"
j ghost        "{\"branch\":\"lane-b\",\"commit\":\"0123456789abcdef0123456789abcdef01234567\",\"isReal\":true,\"blocking\":[],\"verdict\":\"no such commit\"}"
want_refuse "unbound (no branch, no commit)"    "does not say what it reviewed" lane-b --review "$J/unbound.json"
want_refuse "branch named but commit missing"   "does not say what it reviewed" lane-b --review "$J/nocommit.json"
want_refuse "review is for a DIFFERENT branch"  "is for branch .lane-a."        lane-b --review "$J/wrongbranch.json"
want_refuse "commit is a ref, not a sha"        "is not a commit sha"           lane-b --review "$J/refname.json"
want_refuse "commit is HEAD"                    "is not a commit sha"           lane-b --review "$J/headref.json"
want_refuse "commit does not exist here"        "does not exist in this repo"   lane-b --review "$J/ghost.json"
want_refuse "no such branch"                    "no such branch"                ghost-branch --review "$J/wrongbranch.json"

echo "== a branch that MOVED after its review is an UNREVIEWED branch =="
j atB "{\"branch\":\"lane-b\",\"commit\":\"$B\",\"isReal\":true,\"blocking\":[],\"verdict\":\"verified end-to-end\"}"
git switch -q lane-b
echo fix1 >> b.txt; git commit -qam "re-fix 1: address review"
echo fix2 >> b.txt; git commit -qam "re-fix 2: address review again"
git switch -q main
want_refuse "2 commits since review (stale)" "has 2 commit\(s\) since review" lane-b --review "$J/atB.json"

ORPHAN=$(git rev-parse lane-b)   # reviewed tip, about to be thrown away by a reset
git switch -q lane-b; git reset -q --hard main; echo redone > b.txt; git add -A
git commit -qm "rebuilt lane B from scratch"; git switch -q main
j orphan "{\"branch\":\"lane-b\",\"commit\":\"$ORPHAN\",\"isReal\":true,\"blocking\":[],\"verdict\":\"reviewed pre-rebase code\"}"
want_refuse "reviewed commit not on the branch (rebased)" "is not on .lane-b." lane-b --review "$J/orphan.json"

echo "== a correct, current review merges — and the merge records what licensed it =="
NEW=$(git rev-parse lane-b)
j fresh "{\"branch\":\"lane-b\",\"commit\":\"$NEW\",\"isReal\":true,\"blocking\":[],\"verdict\":\"verified via the real flow\"}"
want_merge "bound to the current tip -> MERGED + GREEN" lane-b --review "$J/fresh.json"
for t in "Review-Branch: lane-b" "Review-Commit: $NEW" "Review-Gate: OK" "Review-Verdict: verified via the real flow"; do
  if git log -1 --format='%B' main | grep -qF "$t"; then echo "  PASS  merge commit records '$t'"; pass=$((pass+1))
  else echo "  FAIL  merge commit is missing '$t'"; fail=$((fail+1)); fi
done

echo "== a RED guard rolls the merge back, however good the review was =="
git reset -q --hard "$(git rev-parse main^1)"; before=$(git rev-parse main); touch "$J/.RED"
want_refuse "RED guard -> auto-revert" "rolling the merge back" lane-b --review "$J/fresh.json"
rm -f "$J/.RED"
if [ "$(git rev-parse main)" = "$before" ]; then echo "  PASS  main restored to its pre-merge sha"; pass=$((pass+1))
else echo "  FAIL  main was LEFT BROKEN at $(git rev-parse --short main)"; fail=$((fail+1)); fi

echo
echo "$pass passed, $fail failed"
[ $fail = 0 ] || exit 1
