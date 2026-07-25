#!/usr/bin/env bash
# operator-tick.sh — ONE tick of the Kanban Workflow Operator: every read-only
# sensor, one command. The cycle ritual used to be four separately-forgettable
# commands, and history says separately-forgettable sensors get separately
# forgotten; this makes the pass un-skippable.
#
#   1. lane-status   git truth vs every In Progress card (the board lies)
#   2. board-scan    what each card claims to need
#   3. previews      is every Awaiting-Confirmation link actually alive
#   4. audit         paper vs practice — contradictions only, silence = clean
#
# READ-ONLY, ALWAYS: this prints; the operator acts. Fixes stay deliberate
# commands (board-write.sh, previews.sh start/sync, merge-card.sh at Done).
# Exit 1 iff audit found a contradiction — the strictest sensor gets the exit code.
#
# SAFE-vs-RISKY boundary (hard, for any unattended caller): a fully unattended
# tick may do SAFE actions — triage new Todo cards, post clarify questions,
# provision previews, push-notify. RISKY actions — building code, MERGING to
# main, removing cards — happen only in an interactive session, and merges only
# when the USER drags a card to Done (a loose builder once corrupted main).
set -u
cd "$(git rev-parse --show-toplevel)" || exit 2

echo "===== OPERATOR TICK ====="
echo
echo "### 1/4 lane-status — In Progress vs git truth ###"
scripts/lane-status.sh
echo
echo "### 2/4 board-scan — cards needing action ###"
scripts/board-scan.sh --actions
echo
echo "### 3/4 previews — Awaiting Confirmation liveness ###"
scripts/previews.sh status
echo
echo "### 4/4 audit — paper vs practice ###"
rc=0
if scripts/audit.sh; then
  echo "audit: CLEAN — board and reality agree"
else
  rc=1
fi
echo
echo "### tree ###"
echo "main @ $(git rev-parse --short main)   worktrees: $(git worktree list | wc -l | tr -d ' ')"
echo
echo "survey for the user: scripts/board-scan.sh --survey"
exit $rc
