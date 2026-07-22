// The `app` command group: drive a RUNNING Bismuth window's tabs from the shell (and, through the
// bismuth_cli MCP tool, from a Claude session) — list/open/close/focus tabs, run a safe command.
// Everything hits the running core's /ui/* routes, which relay over the per-window control socket
// the app holds open (core/src/uiControl.ts). A headless CLI has no window, so — unlike the
// file-based groups — these REQUIRE a running app.
//
// Core discovery precedence: --api <url> → BISMUTH_API → CLAUDE_RELAY_URL → run-registry
// (~/.bismuth/run, matched by --vault/BISMUTH_VAULT, else the single running core) → :4321.
// `--window <id>` targets a specific window (see `app windows`); omit it and the single open window
// is used (none → 404, several → 409, both benign "expected" outcomes, not retry conditions).
import type { CommandMap } from "../types";
import { flag, positionals, bool, fail, out } from "../args";
import { call } from "../http";
import { resolveRunRegistryBase } from "../../../core/src/runRegistry";
import { uiControlAllowedIds } from "../../../core/src/commands";

/** Resolve the running core's base URL (see module doc for the precedence). */
export function resolveCore(args: string[]): string {
  const explicit = flag(args, "api") ?? process.env.BISMUTH_API ?? process.env.CLAUDE_RELAY_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const vault = flag(args, "vault") ?? process.env.BISMUTH_VAULT;
  const fromRegistry = resolveRunRegistryBase(vault);
  if (fromRegistry) return fromRegistry;
  return "http://localhost:4321";
}

/** Wording shown when no running app is reachable at `base`. */
const unreachable = (base: string) => `could not reach a running Bismuth app at ${base} — open the app, or pass --api <url>`;

/** Send one /ui/command and return its reply.result, or fail with reply.error. `--window` targets a
 *  specific window (else the single open one). */
async function command(args: string[], action: string, cmdArgs: Record<string, unknown>): Promise<unknown> {
  const windowId = flag(args, "window");
  const reply = (await call(resolveCore(args), "POST", "/ui/command", { windowId, action, args: cmdArgs }, unreachable)) as {
    ok?: boolean;
    result?: unknown;
    error?: string;
  };
  if (!reply || reply.ok !== true) fail(reply?.error ?? "app control command failed");
  return reply.result;
}

export const commands: CommandMap = {
  "app windows": {
    summary: "List open Bismuth windows (id, label, active tab, tab count) from a running app",
    usage: "[--api <url>] [--pretty]",
    run: async (args) => out(await call(resolveCore(args), "GET", "/ui/windows", undefined, unreachable), args),
  },
  "app tabs": {
    summary: "List the open tabs + panes in a window",
    usage: "[--window <id>] [--api <url>] [--pretty]",
    run: async (args) => out(await command(args, "list-tabs", {}), args),
  },
  "app open": {
    summary: "Open a note path or sentinel (::graph/::inbox/.settings/::term:<uuid>) in a window",
    usage: "<content> [--new-tab] [--window <id>]",
    run: async (args) => {
      const [content] = positionals(args);
      if (!content) fail("usage: bismuth app open <content> [--new-tab] [--window <id>]");
      out(await command(args, "open-tab", { content, newTab: bool(args, "new-tab") }), args);
    },
  },
  "app close": {
    summary: "Close a tab by id (see `app tabs` for tab ids)",
    usage: "<tabId> [--window <id>]",
    run: async (args) => {
      const [tabId] = positionals(args);
      if (!tabId) fail("usage: bismuth app close <tabId> [--window <id>]");
      out(await command(args, "close-tab", { tabId }), args);
    },
  },
  "app focus": {
    summary: "Focus (activate) a tab by id",
    usage: "<tabId> [--window <id>]",
    run: async (args) => {
      const [tabId] = positionals(args);
      if (!tabId) fail("usage: bismuth app focus <tabId> [--window <id>]");
      out(await command(args, "focus-tab", { tabId }), args);
    },
  },
  "app run": {
    summary: "Run a safe UI command by id (see `app commands`); chat + heavyweight verbs are blocked",
    usage: "<commandId> [--window <id>]",
    run: async (args) => {
      const [id] = positionals(args);
      if (!id) fail("usage: bismuth app run <commandId> [--window <id>]");
      out(await command(args, "run-command", { id }), args);
    },
  },
  "app commands": {
    summary: "List the command ids `app run` accepts (the command catalog minus the app-control blocklist)",
    usage: "[--pretty]",
    run: (args) => out(uiControlAllowedIds(), args),
  },
};
