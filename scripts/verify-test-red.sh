#!/usr/bin/env bash
# verify-test-red.sh — prove the acceptance test was actually RED before the fix.
#
# WHY THIS EXISTS: "the acceptance criterion becomes a test that must FAIL before the
# fix" is the one rule in this whole system that was pure prose AND self-reported —
# every lane types "CONFIRMED FAILING FIRST (5 fail)" into a card and nothing has ever
# checked it. It is also the rule an agent is most incentivised to fake: a forensic PR
# audit caught agents "fixing" red tests by swapping strict behavioral assertions for
# trivially-satisfied ones, and mutation data says AI suites hit 80%+ coverage but only
# 53-60% kill rate — they assert non-null instead of asserting values.
#
# The trap is mechanical, not moral. `bun test` exits 1 and prints "N fail" IDENTICALLY
# for three very different events:
#
#   error: Cannot find module '../src/newThing'   ->  " 0 pass / 1 fail / 1 error"   (never loaded)
#   const f = undefined; f()                      ->  " 0 pass / 1 fail"             (threw, asserted nothing)
#   expect(1).toBe(2)                             ->  " 0 pass / 1 fail / 1 expect() calls"
#
# Only the third is evidence. An honest lane that ran the test at the base, saw red, and
# reported red is reporting NOTHING when the test imports a module the fix introduced —
# the COMMON case, because the fix and its test are written together. That red proves the
# file didn't exist; it cannot prove the bug existed. Two signals separate them:
#
#   `(fail)` vs `N error`      — did the module load at all?
#   `error: expect(` lines     — did an ASSERTION fail, or did the body just throw?
#
# The second signal was learned the hard way: this script's own synthetic control called
# extractTags() with the wrong arity, threw a TypeError before any expect(), and the
# script cheerfully reported "RED for a behavioral reason". A malformed test and a real
# crash-red are indistinguishable by `(fail)` alone. A well-formed test that expects a
# throw still registers an assertion (`expect(() => f()).toThrow()`), so "red with zero
# assertions evaluated" is malformed-or-missing-surface, never proof.
#   Limit: bun reports both counters RUN-WIDE, not per test. If the pattern matches many
#   files, another file's failed assertion can mask a throwing acceptance test. The check
#   is therefore sound in ONE direction only: zero assertion-failures => definitely not
#   proof; one or more => an assertion failed SOMEWHERE in the run. Narrow the pattern to
#   the acceptance test itself and the signal is exact.
#
#   verify-test-red.sh <branch> <test-file-or-pattern> [--base <sha>]
#   verify-test-red.sh --card <card> <test-file-or-pattern>   (branch from `worktree:`)
#
# Exit 0 = PROVEN     an assertion failed at base, passes at tip. Real acceptance evidence.
# Exit 1 = REFUSED    vacuous — green at base (proves nothing) or still red at tip.
# Exit 3 = INCONCLUSIVE  red, but for a reason that proves nothing: the test couldn't LOAD
#                        at base (imports a module the fix added), or its body THREW before
#                        evaluating any assertion. Both are compile/typo errors wearing a
#                        red's clothes. NOT proof — see the advice it prints; do not let a
#                        lane bank this as a pass.
# Exit 2 = usage/setup error.
#
# bash 3.2 compatible (macOS system bash) — no associative arrays.
set -u
VAULT="${BISMUTH_VAULT:-/Users/michaelslain/Documents/library of alexandria}"
DIR="$VAULT/thoughts/Bismuth Changes"
REPO=$(git rev-parse --show-toplevel) || exit 2
cd "$REPO" || exit 2

fm() { awk -v k="$2" '{ if ($0 ~ "^"k":") { sub(/^[^:]*: */, ""); print; exit } }' "$1"; }

# print the synopsis + exit codes straight out of the header. ANCHORED on markers, not on
# line numbers: the first version of this hardcoded `sed -n '28,42p'` and the very next
# edit to the header silently made it print the middle of a sentence.
usage() {
  awk '/^#   verify-test-red\.sh </, /^# Exit 2/ { sub(/^# ?/, ""); print }' "$0" >&2
  exit 2
}

branch=""; pattern=""; base=""; card=""
while [ $# -gt 0 ]; do
  case "$1" in
    --base) base="${2:-}"; shift 2;;
    --card) card="${2:-}"; shift 2;;
    -*)     echo "unknown flag: $1" >&2; exit 2;;
    *)      if [ -z "$branch" ] && [ -z "$card" ]; then branch="$1"; else pattern="$1"; fi; shift;;
  esac
done

# a card names its lane in `worktree:` — same resolution merge-card.sh/lane-status.sh use
if [ -n "$card" ]; then
  if [ -f "$card" ]; then cardf="$card"; else cardf="$DIR/$card.md"; fi
  [ -f "$cardf" ] || { echo "no such card: $cardf" >&2; exit 2; }
  branch=$(fm "$cardf" worktree)
  [ -n "$branch" ] || { echo "card has no worktree: field (triage it first): $cardf" >&2; exit 2; }
fi

[ -n "$branch" ] && [ -n "$pattern" ] || { usage; }

git rev-parse --verify "$branch" >/dev/null 2>&1 || { echo "no such branch: $branch" >&2; exit 2; }

# always operate on the tip's SHA, never the branch NAME: a live lane has the branch
# checked out in its own worktree, and git refuses to check the same branch out twice.
tip=$(git rev-parse "$branch")
tip_short=$(git rev-parse --short "$tip")

# ---- base = where the lane forked off main ------------------------------------
# `git merge-base <branch> main` is right ONLY while the branch is unmerged. Once it has
# landed, the branch IS an ancestor of main, so merge-base returns the branch TIP — base
# == tip, an empty diff, and the script would cheerfully report "changes no test files".
# For a landed branch the fork point is the merge-base with the MERGE's first parent
# (the oldest merge on the ancestry path is the one that brought it in — lane-status.sh
# uses the same trick). This is what makes the script usable on already-merged history,
# which is the only way to audit a claim after the fact.
if [ -z "$base" ]; then
  if git merge-base --is-ancestor "$tip" main 2>/dev/null; then
    mc=$(git log --format=%H --merges --ancestry-path "$tip..main" 2>/dev/null | tail -1)
    if [ -n "$mc" ]; then
      base=$(git merge-base "$tip" "$mc^1" 2>/dev/null) || true
      echo "   note: branch already merged (at $(git rev-parse --short "$mc")) — fork point taken from that merge's first parent"
    else
      echo "REFUSED — $branch is already in main with no merge commit (fast-forwarded or rebased)," >&2
      echo "   so its fork point is unrecoverable from git. Pass --base <sha> explicitly." >&2
      exit 2
    fi
  else
    base=$(git merge-base "$tip" main 2>/dev/null) || true
  fi
  [ -n "$base" ] || { echo "cannot find the fork point of $branch; pass --base <sha>" >&2; exit 2; }
fi
base_short=$(git rev-parse --short "$base")

echo "== verify-test-red =="
echo "   branch  $branch ($tip_short)"
echo "   base    $base_short  $(git log -1 --format=%s "$base" | cut -c1-56)"
echo "   test    $pattern"
echo

# ---- the test/source split -----------------------------------------------------
# THE HEURISTIC (and its limits — state them, don't hide them): a changed file is a TEST
# file iff its path has a /test/, /tests/ or /__tests__/ segment, or its basename ends
# .test.<ext> / .spec.<ext>. Everything else — including docs and config — is SOURCE and
# is WITHHELD from the base checkout.
#   Limit 1: a lane that hides its fix in a path matching those patterns (e.g. editing
#            core/test/helpers.ts to make the assertion pass) defeats this. The withheld
#            SOURCE list is printed so a human can see what was actually held back.
#   Limit 2: a shared test helper that legitimately needs a new export is applied as a
#            test file, so a fix smuggled into it rides along silently.
#   Limit 3: fixtures/snapshots under test/ are applied too — usually right, occasionally
#            enough to make a snapshot test pass on its own.
is_test_path() {
  case "$1" in
    */test/*|test/*|*/tests/*|tests/*|*/__tests__/*)               return 0;;
    *.test.ts|*.test.tsx|*.test.js|*.test.jsx|*.test.mjs)          return 0;;
    *.spec.ts|*.spec.tsx|*.spec.js|*.spec.jsx|*.spec.mjs)          return 0;;
    *) return 1;;
  esac
}

tests=""; sources=""; ntest=0; nsrc=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  if is_test_path "$f"; then tests="$tests$f
"; ntest=$((ntest+1)); else sources="$sources$f
"; nsrc=$((nsrc+1)); fi
done < <(git diff --name-only --diff-filter=ACMRT "$base" "$tip")

if [ "$ntest" = 0 ]; then
  echo "REFUSED — the branch changes no test files at all."
  echo "          There is no acceptance test to be red. The check is vacuous by construction."
  exit 1
fi

echo "-- test files (applied onto the base) --"
printf '%s' "$tests" | sed 's/^/   + /'
if [ "$nsrc" -gt 0 ]; then
  echo "-- source files (WITHHELD — this is the fix) --"
  printf '%s' "$sources" | sed 's/^/   - /'
fi
echo

# ---- throwaway worktree; never the user's tree, never main ---------------------
WT=$(mktemp -d "${TMPDIR:-/tmp}/verify-red.XXXXXX") || exit 2
cleanup() {
  cd "$REPO" 2>/dev/null || return
  git worktree remove --force "$WT" >/dev/null 2>&1 || rm -rf "$WT"
  git worktree prune >/dev/null 2>&1
}
trap cleanup EXIT INT TERM
rm -rf "$WT"   # git worktree add wants to create it itself
git worktree add --detach "$WT" "$base" >/dev/null 2>&1 || {
  echo "cannot create throwaway worktree at $base" >&2; exit 2; }

# node_modules: link, never `bun install` (slow, and it would mutate the lockfile).
# Per-ENTRY symlinks, not the whole dir: @bismuth/* are RELATIVE links to sibling
# workspaces, so symlinking the directory wholesale would resolve them against the REAL
# repo and silently feed tip-of-main workspace source into a base checkout. Rebuild that
# scope to point back into the throwaway.
#   Caveat: third-party deps come from the INVOKING repo's install, i.e. the tip's
#   node_modules. If the branch changed a dependency version, the base runs against the
#   newer dep. Printed below when it could matter.
link_modules() {
  local ws="$1" src dst e t
  if [ "$ws" = "." ]; then src="$REPO/node_modules"; dst="$WT/node_modules"
  else src="$REPO/$ws/node_modules"; dst="$WT/$ws/node_modules"; fi
  [ -d "$src" ] || return 0
  mkdir -p "$dst"
  for e in "$src"/*; do
    [ -e "$e" ] || continue
    case "$(basename "$e")" in
      @bismuth)
        mkdir -p "$dst/@bismuth"
        for t in "$e"/*; do
          [ -e "$t" ] || continue
          # link the scope entry at the THROWAWAY's copy of that workspace
          ln -sfn "$WT/$(basename "$(readlink "$t" 2>/dev/null || echo "$t")")" \
                  "$dst/@bismuth/$(basename "$t")"
        done;;
      *) ln -sfn "$e" "$dst/$(basename "$e")";;
    esac
  done
}
link_modules .
for ws in core app cli mcp relay memory daemon; do
  [ -d "$WT/$ws" ] && link_modules "$ws"
done

# A repo with no install makes EVERY import unresolvable — which this script would then
# report as INCONCLUSIVE, i.e. it would accuse an honest lane of the exact fraud it exists
# to catch. Fail loudly instead of guessing. (Lanes run from worktrees, which routinely
# have no node_modules of their own.)
ws_of=$(printf '%s' "$pattern" | awk -F/ '{ print $1 }')
case "$ws_of" in
  core|app|cli|mcp|relay|memory|daemon)
    [ -d "$REPO/$ws_of/node_modules" ] || {
      echo "REFUSED — $REPO/$ws_of/node_modules is missing, so nothing would resolve and every"
      echo "   test would look like a load error. Run from a repo that has been installed, or"
      echo "   \`bun install\` here first. (This script never installs — it must not mutate a lockfile.)"
      exit 2; };;
esac
git diff --name-only "$base" "$tip" | grep -qE '(^|/)(package\.json|bun\.lock(b)?)$' &&
  echo "   WARN  the branch touches package.json/bun.lock — the base runs against the TIP's deps."

# ---- run the tests, and tell a real red from a load error ----------------------
# `bun test` cannot be trusted by exit code here: it exits 1 both when an assertion fails
# and when an import can't resolve. Parse instead.
#   (fail) lines    = a test BODY ran and failed         -> maybe meaningful
#   "N error"       = a module never loaded              -> vacuous, proves nothing
#   "error: expect(" = an ASSERTION was evaluated + failed -> the only real evidence
#   expect() calls  = whether the run asserted ANYTHING at all
run_at() {
  local dir="$1" log="$2"
  ( cd "$dir" && bun test "$pattern" ) >"$log" 2>&1
  return 0
}
count_fail()   { grep -c '(fail)' "$1" 2>/dev/null | tr -d ' '; }
sum_field()    { awk -v k="$2" '$2 == k && $1 ~ /^[0-9]+$/ { n = $1 } END { print n + 0 }' "$1"; }
expect_calls() { awk '/expect\(\) calls/ { for (i = 1; i <= NF; i++) if ($i ~ /^[0-9]+$/) { print $i; exit } } END { }' "$1"; }
load_errs()    { grep -cE "Cannot find module|Could not resolve|Export named .* not found|SyntaxError:" "$1" 2>/dev/null | tr -d ' '; }
# a red that is an ASSERTION failure, not a bare throw. bun prints this header per
# failed matcher: `error: expect(received).toBe(expected)`
assert_fails() { grep -cE '^error: expect\(' "$1" 2>/dev/null | tr -d ' '; }

BASE_LOG="$WT/.red-base.log"; TIP_LOG="$WT/.red-tip.log"

# apply ONLY the branch's test files onto the base — the fix itself stays behind
( cd "$WT" && printf '%s' "$tests" | tr '\n' '\0' | xargs -0 -- git checkout "$tip" -- ) 2>/dev/null || {
  echo "cannot apply the branch's test files onto the base" >&2; exit 2; }

echo "-- base $base_short + the branch's tests, WITHOUT the fix --"
run_at "$WT" "$BASE_LOG"
bfail=$(count_fail "$BASE_LOG"); bpass=$(sum_field "$BASE_LOG" pass)
berr=$(sum_field "$BASE_LOG" error); bload=$(load_errs "$BASE_LOG"); bexp=$(expect_calls "$BASE_LOG")
bassert=$(assert_fails "$BASE_LOG")
echo "   $bpass pass / $bfail (fail) / $berr error / ${bexp:-0} expect() calls / ${bassert:-0} failed assertion(s)"

# the honest case, and the one that makes this script worth writing
if [ "${berr:-0}" -gt 0 ] || [ "${bload:-0}" -gt 0 ]; then
  if [ "${bfail:-0}" = 0 ] || [ "${bload:-0}" -gt 0 ]; then
    echo
    grep -E "Cannot find module|Could not resolve|Export named .* not found|SyntaxError:" "$BASE_LOG" |
      head -3 | sed 's/^/   /'
    echo
    echo "INCONCLUSIVE — the test could not LOAD at the base. This is a COMPILE error, not a red."
    echo "   The test imports something the fix introduced, so at the base it fails because the"
    echo "   module isn't there — it would fail identically if the bug had never existed. bun still"
    echo "   prints \"$bfail fail\" and exits 1, which is exactly what a lane screenshots as proof."
    echo "   THIS IS NOT PROOF. Do not bank it."
    echo
    echo "   What the lane should do instead:"
    echo "   1. Write the acceptance test against the surface that ALREADY EXISTS at the base —"
    echo "      the entry point the user's bug actually travels through (the exported function the"
    echo "      app calls, not the new helper the fix factored out). That test compiles at the base"
    echo "      and goes red for the real reason."
    echo "   2. Keep unit tests for the new module in a SEPARATE file. They are useful, but they"
    echo "      are not acceptance evidence and must not be cited as the red."
    echo "   3. If the feature adds a genuinely new entry point with no pre-existing surface, say"
    echo "      so on the card — \"new surface, no meaningful red available\" — and lean on the"
    echo "      browser/verify proof. An honest 'not applicable' beats a fake 'CONFIRMED FAILING'."
    exit 3
  fi
  echo "   WARN  $bfail (fail) alongside $berr load error(s) — the red is PARTLY a compile error."
  echo "         Only the (fail) lines count as evidence; the erroring file proves nothing."
fi

if [ "${bfail:-0}" = 0 ]; then
  echo
  echo "REFUSED — the test PASSES at the base, without the fix."
  echo "   It cannot be evidence for a change it does not depend on. The acceptance check is"
  echo "   VACUOUS: it asserts something that was already true. Either it tests the wrong thing,"
  echo "   or it asserts too weakly (non-null instead of the value the card actually demands)."
  [ "${bexp:-0}" = 0 ] && echo "   Note: 0 expect() calls — this test asserts NOTHING."
  exit 1
fi

# red, but did any assertion actually get EVALUATED? a body that throws before its first
# expect() is indistinguishable from a test with a typo in it (this script's own control
# threw on an arity mistake and was called "behavioral"). Not proof.
if [ "${bassert:-0}" = 0 ]; then
  echo
  grep -B2 '(fail)' "$BASE_LOG" | grep -E '^(error|TypeError|ReferenceError)' | head -3 | sed 's/^/   /'
  echo
  echo "INCONCLUSIVE — the test is RED, but ZERO assertions were evaluated. The body THREW"
  echo "   before reaching its first expect(). A test with a typo in it (wrong arity, wrong"
  echo "   export name) fails exactly this way, and so does a test whose surface is missing at"
  echo "   the base — neither proves the BUG existed. bun still prints \"$bfail fail\" and exits 1."
  echo "   THIS IS NOT PROOF. Do not bank it."
  echo
  echo "   What the lane should do instead:"
  echo "   1. If the bug IS a crash, assert the crash: expect(() => f(...)).toThrow(...) — that"
  echo "      registers an assertion, so the red becomes evidence instead of an exception."
  echo "   2. If it is not a crash, the throw is a bug in the TEST. Fix the test to call the real"
  echo "      surface correctly, then re-run — the red you want is a failed expect(), not a stack"
  echo "      trace."
  exit 3
fi

echo "   RED for a behavioral reason ($bassert failed assertion(s) evaluated) — real evidence."
grep '(fail)' "$BASE_LOG" | head -5 | sed 's/^/     /'

# ---- and it must be green at the tip -------------------------------------------
echo
echo "-- tip $tip_short, with the fix --"
( cd "$WT" && git checkout --force "$tip" >/dev/null 2>&1 ) || {
  echo "cannot check out $branch in the throwaway worktree" >&2; exit 2; }
run_at "$WT" "$TIP_LOG"
tfail=$(count_fail "$TIP_LOG"); tpass=$(sum_field "$TIP_LOG" pass)
terr=$(sum_field "$TIP_LOG" error); texp=$(expect_calls "$TIP_LOG")
echo "   $tpass pass / $tfail (fail) / $terr error / ${texp:-0} expect() calls"

if [ "${tfail:-0}" != 0 ] || [ "${terr:-0}" -gt 0 ]; then
  echo
  grep -E '\(fail\)|Cannot find module|SyntaxError:' "$TIP_LOG" | head -5 | sed 's/^/   /'
  echo
  echo "REFUSED — the test is still RED at the branch tip. The fix does not satisfy its own"
  echo "   acceptance test. Fix it in the worktree, then re-run."
  exit 1
fi

if [ "${tpass:-0}" = 0 ]; then
  echo
  echo "REFUSED — nothing ran at the tip (0 pass). Check the pattern: $pattern"
  exit 1
fi

echo
echo "PROVEN — red at $base_short for a behavioral reason, green at $tip_short."
echo "   $bassert assertion(s) failed without the fix and pass with it. The acceptance test earns"
echo "   its claim. Cite this on the card instead of \"confirmed failing first\":"
echo "     verify-test-red.sh $branch '$pattern' -> PROVEN ($bassert red @ $base_short, $tpass green @ $tip_short)"
exit 0
