#!/usr/bin/env bun
// UserPromptSubmit hook: keep this session "awake" in the agents graph while the user
// works. Posts a full register (not just a heartbeat) so a session whose SessionStart
// was missed or dropped — e.g. an out-of-order event — self-heals and still appears.
import { reportSession, runHook } from "../lib/report.ts";

runHook(reportSession);
