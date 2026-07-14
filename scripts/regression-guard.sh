#!/usr/bin/env bash
# regression-guard.sh — the post-merge gate.
# Full typecheck + test suites. GREEN = safe; RED = a merge regressed something
# (like the #96 masonry change silently breaking the cards view) → file a card
# and `git log --oneline -8` to find the culprit commit.
# NOTE: the core suite has ONE known-flaky `(live)` chat E2E test that times out
# under load but passes in isolation — if that's the only failure, it's the flake,
# re-run: bun test core/test/chat.test.ts -t "approving Write creates the file".
set -u
cd "$(git rev-parse --show-toplevel)" || exit 2
fail=0

echo "== typecheck =="
if bun run typecheck >/tmp/rg-tc.log 2>&1; then echo "  clean"
else echo "  TYPE ERRORS:"; grep -iE "error TS|error:" /tmp/rg-tc.log | head; fail=1; fi

echo "== bun test core =="
if bun test core >/tmp/rg-core.log 2>&1; then echo "  $(grep -E '[0-9]+ pass' /tmp/rg-core.log | tail -1)"
else echo "  FAILURES:"; grep -E "\(fail\)|[0-9]+ fail" /tmp/rg-core.log | head; fail=1; fi

echo "== bun test app =="
if bun test app >/tmp/rg-app.log 2>&1; then echo "  $(grep -E '[0-9]+ pass' /tmp/rg-app.log | tail -1)"
else echo "  FAILURES:"; grep -E "\(fail\)|[0-9]+ fail" /tmp/rg-app.log | head; fail=1; fi

echo
if [ $fail = 0 ]; then echo "GREEN — no regressions."
else echo "RED — a merge regressed something. Bisect: git log --oneline -8"; exit 1; fi
