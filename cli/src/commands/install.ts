// Install command group for the `bismuth` CLI.
// Installs the bismuth CLI + MCP machine-wide from a source dir (bin/ + docs/), normally
// BISMUTH_INSTALL_SRC (the bundled-app tools resource) or --src. Idempotent +
// version-gated: a no-op when the bundled binaries are unchanged. `install --status`
// reports the current state; `uninstall` reverses it. Does NOT touch the vault.
import type { CommandMap } from "../types";
import { bool, flag, out } from "../args";
import {
  ensureBismuthInstalled,
  getBismuthStatus,
  uninstallBismuth,
} from "../../../core/src/bismuthInstall";

export const commands: CommandMap = {
  install: {
    summary: "Install the bismuth CLI + MCP machine-wide (idempotent, version-gated)",
    usage: "[--src <dir>] [--status] [--dry-run]",
    run: async (args) => {
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
