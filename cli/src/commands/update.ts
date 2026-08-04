// The `update` command group: thin wrappers over core's git-based self-update routes
// (core/src/selfUpdate.ts, wired at `GET /update/status` / `POST /update/apply` in
// core/src/server.ts). Those routes carry NO owner-token gate and were already reachable via
// `bismuth api GET /update/status` — but nothing told an agent they existed. Same API-base
// resolution as `commands/api.ts`: `--api <url>` → `BISMUTH_API` env → `http://localhost:4321`.
//
// Self-update only applies to a bundled SOURCE build (BISMUTH_INSTALL_SRC + BISMUTH_APP_PATH set
// on the running core) — everywhere else `status` reports `{available:false, reason:"not-a-
// source-build"}` and `apply` reports `{phase:"error", message:"self-update unavailable …"}`.
// Both are read/trigger-only: `apply` kicks off `git pull` + rebuild in the BACKGROUND and returns
// immediately (poll `update status` or `GET /update/progress` via `bismuth api` for phase).
import type { CommandMap } from "../types";
import { flag, out } from "../args";
import { call } from "../http";

function apiBase(args: string[]): string {
  return flag(args, "api") ?? process.env.BISMUTH_API ?? "http://localhost:4321";
}

/** Wording shown when no server is reachable at `base`. */
const unreachable = (base: string) =>
  `could not reach a running server at ${base} — start one with \`bismuth serve\` (or pass --api <url>)`;

export const commands: CommandMap = {
  "update status": {
    summary: "Check whether this build is behind origin/main (git-based self-update; source builds only)",
    usage: "[--api <url>] [--pretty]",
    run: async (args) => out(await call(apiBase(args), "GET", "/update/status", undefined, unreachable), args),
  },
  "update apply": {
    summary: "Pull + rebuild + relaunch (returns immediately; poll `update status` for progress)",
    usage: "[--api <url>] [--pretty]",
    run: async (args) => out(await call(apiBase(args), "POST", "/update/apply", undefined, unreachable), args),
  },
};
