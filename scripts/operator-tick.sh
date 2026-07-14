#!/usr/bin/env bash
# operator-tick.sh — ONE tick of the Kanban Workflow Operator.
# What a session (and, once wired, a daemon cron — brainstorm idea J) runs each
# cycle to drive the board with no user chat. Prints the state + the action plan;
# the operator (Claude) then executes each pending action per bismuth-changes-operator.
#
# SAFE-vs-RISKY boundary (hard): a fully unattended tick may do the SAFE actions
# autonomously — triage new Todo cards, post clarify questions, provision previews,
# push-notify, run the regression guard. RISKY actions — building code, MERGING to
# main, removing cards — stay gated (green regression-guard) and human-adjacent;
# never auto-merge unattended (a loose builder once corrupted main).
set -u
cd "$(git rev-parse --show-toplevel)" || exit 2

echo "===== OPERATOR TICK ====="
echo
echo "### board — cards needing action ###"
scripts/board-scan.sh --actions
echo
echo "### tree ###"
echo "main @ $(git rev-parse --short main)   worktrees: $(git worktree list | wc -l | tr -d ' ')"
echo
echo "Plan: Todo -> triage+build | Done-but-Broken -> re-fix (escalate by bounces)"
echo "      Done -> merge(gated)+cleanup+remove | Awaiting Confirmation -> preview+notify"
echo "Guards: scripts/regression-guard.sh (post-merge) · scripts/gc-worktrees.sh --run (prune)"
