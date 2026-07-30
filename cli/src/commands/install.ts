// Install command group for the `bismuth` CLI.
// Installs the bismuth CLI + MCP machine-wide from a source dir (bin/ + docs/), normally
// BISMUTH_INSTALL_SRC (the bundled-app tools resource) or --src. Idempotent +
// version-gated: a no-op when the bundled binaries are unchanged. `install --status`
// reports the current state (including which OTHER agent CLIs are detected/registered —
// see core/src/agentBackends/mcpRegistrars.ts); `install --mcp <cli>` (or `--mcp all`)
// registers Bismuth's MCP with those CLIs on demand — always opt-in, never automatic.
// `uninstall` reverses everything. Does NOT touch the vault.
import type { CommandMap } from "../types";
import { bool, flag, out } from "../args";
import {
  ensureBismuthInstalled,
  getBismuthStatus,
  registerAdditionalMcp,
  uninstallBismuth,
} from "../../../core/src/bismuthInstall";

export const commands: CommandMap = {
  install: {
    summary: "Install the bismuth CLI + MCP machine-wide (idempotent, version-gated)",
    usage: "[--src <dir>] [--status] [--dry-run] [--mcp <cli>[,<cli>…]|all]",
    run: async (args) => {
      const mcpArg = flag(args, "mcp");
      if (mcpArg) {
        const ids = mcpArg === "all" ? ["all"] : mcpArg.split(",").map((s) => s.trim()).filter(Boolean);
        out(await registerAdditionalMcp(ids), args);
        return;
      }
      if (bool(args, "status")) {
        out(await getBismuthStatus(), args);
        return;
      }
      const src = flag(args, "src") ?? process.env.BISMUTH_INSTALL_SRC;
      out(await ensureBismuthInstalled(src, undefined, { dryRun: bool(args, "dry-run") }), args);
    },
  },
  uninstall: {
    summary: "Remove the machine-wide bismuth CLI symlink, global MCP registration, and ~/.bismuth",
    run: async (args) => {
      out(await uninstallBismuth(), args);
    },
  },
};
