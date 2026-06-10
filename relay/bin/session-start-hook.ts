#!/usr/bin/env bun
// SessionStart hook: register this terminal-tab Claude Code session with the in-app
// relay so it appears as a root node in the agents graph.
import { reportSession, runHook } from "../lib/report.ts";

runHook(reportSession);
