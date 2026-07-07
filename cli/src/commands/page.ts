// The `page` command group: the daemon inbox (core/src/daemonPages.ts). list/create/resolve/
// mark-failed run HEADLESSLY against `<vault>/.daemon/pages` (no running server), like the other
// file-based groups. `create` exists so an MCP / daemon caller authors a well-formed page — the
// nested `actions[]` frontmatter `resolvePage` depends on is easy to get subtly wrong by hand —
// through the validated createDaemonPage helper instead of a raw `file write` (still zero new MCP
// tools: it rides bismuth_cli).
import type { CommandMap } from "../types";
import { requireVault, flag, positionals, fail, out } from "../args";
import {
  listDaemonPages,
  resolvePage,
  markPageFailed,
  createDaemonPage,
  type PageAction,
} from "../../../core/src/daemonPages";

export const commands: CommandMap = {
  "page list": {
    summary: "List daemon inbox pages (each merged with its dynamic .state sidecar)",
    usage: "[--vault <dir>] [--retention-days <n>] [--pretty]",
    run: (args) => {
      const retention = Number(flag(args, "retention-days") ?? 7) || 7;
      out(listDaemonPages(requireVault(args), retention), args);
    },
  },
  "page create": {
    summary: "Create a daemon inbox page with validated frontmatter + action buttons",
    usage: "<slug> [--title <t>] [--body <md>] [--actions '<json>'] [--source <s>] [--deliver-at <iso>] [--vault <dir>]",
    run: (args) => {
      const [slug] = positionals(args);
      if (!slug) fail("usage: bismuth page create <slug> [--title ...] [--body ...] [--actions '<json>']");
      let actions: PageAction[] | undefined;
      const raw = flag(args, "actions");
      if (raw !== undefined) {
        try {
          actions = JSON.parse(raw) as PageAction[];
        } catch {
          fail(`--actions is not valid JSON: ${raw}`);
        }
      }
      out(
        createDaemonPage(requireVault(args), {
          slug,
          title: flag(args, "title"),
          body: flag(args, "body"),
          actions,
          source: flag(args, "source"),
          deliverAt: flag(args, "deliver-at"),
        }),
        args,
      );
    },
  },
  "page resolve": {
    summary: "Press a page action (approve → daemon runs its prompt; dismiss → resolved here, no daemon)",
    usage: "<page-path> <actionId> [--vault <dir>] [--pretty]",
    run: (args) => {
      const [path, actionId] = positionals(args);
      if (!path || !actionId) fail("usage: bismuth page resolve <page-path> <actionId>");
      out(resolvePage(requireVault(args), path, actionId), args);
    },
  },
  "page mark-failed": {
    summary: "Force a stuck 'working' page to 'failed' (the client escape hatch)",
    usage: "<page-path> [--vault <dir>]",
    run: (args) => {
      const [path] = positionals(args);
      if (!path) fail("usage: bismuth page mark-failed <page-path>");
      markPageFailed(requireVault(args), path);
      out({ ok: true }, args);
    },
  },
};
