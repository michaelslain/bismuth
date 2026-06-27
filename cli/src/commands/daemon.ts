// Daemon command group for the `bismuth` CLI, mirroring server.ts's /daemon/* routes.
// MACHINE-level state lives under ~/.bismuth/daemon (BISMUTH_DAEMON_DIR override): status,
// devices, owner-read/set, install/setup — these don't touch the vault. But crons + processes
// are PER-VAULT (under <vault>/.daemon), so `daemon graph`, `daemon cron toggle/run`, and
// `daemon process toggle` REQUIRE a vault (--vault / BISMUTH_VAULT) and operate on that vault's
// .daemon dir.
import type { CommandMap } from "../types";
import { bool, fail, out, positionals, requireVault } from "../args";
import {
  daemonStatus,
  listDevices,
  getOwner,
  setOwner,
  setCronEnabled,
  setProcessEnabled,
  runCron,
  vaultDaemonDir,
} from "../../../core/src/daemon";
import { daemonGraph } from "../../../core/src/daemonGraph";
import { installStatus, runSetup } from "../../../core/src/daemonInstall";

export const commands: CommandMap = {
  "daemon status": {
    summary: "Print the claude-bot daemon's liveness, this device id, and current owner",
    usage: "[--pretty]",
    run: (args) => {
      out(daemonStatus(), args);
    },
  },
  "daemon devices": {
    summary: "List all heartbeating claude-bot devices (each flagged owner/this)",
    usage: "[--pretty]",
    run: (args) => {
      out(listDevices(), args);
    },
  },
  "daemon owner": {
    summary: "Print the current owner device, or claim a device as owner when <deviceId> is given",
    usage: "[<deviceId>] [--pretty]",
    run: (args) => {
      const [deviceId] = positionals(args);
      if (deviceId === undefined) {
        out(getOwner(), args);
      } else {
        out(setOwner(deviceId), args);
      }
    },
  },
  "daemon install": {
    summary: "Print the claude-bot install status (read-only; never throws)",
    usage: "[--pretty]",
    run: async (args) => {
      out(await installStatus(), args);
    },
  },
  "daemon setup": {
    summary: "Run the idempotent, adopt-only claude-bot setup and print the result",
    usage: "[--pretty]",
    run: async (args) => {
      out(await runSetup(), args);
    },
  },
  "daemon update": {
    summary: "Re-register the bundled daemon service (the daemon updates with the app)",
    usage: "[--pretty]",
    run: async (args) => {
      out(await runSetup(), args);
    },
  },
  "daemon graph": {
    summary: "Build this vault's daemon-mode graph (daemon hub → crons + processes) and print it as JSON",
    usage: "--vault <dir> [--pretty]",
    run: (args) => {
      out(daemonGraph(vaultDaemonDir(requireVault(args))), args);
    },
  },
  "daemon cron toggle": {
    summary: "Enable (or, with --off, disable) a cron in this vault by flipping its `enabled` frontmatter",
    usage: "<name> --vault <dir> [--off]",
    run: (args) => {
      const [name] = positionals(args);
      if (name === undefined) fail("usage: daemon cron toggle <name> --vault <dir> [--off]");
      setCronEnabled(name, !bool(args, "off"), vaultDaemonDir(requireVault(args)));
      out("ok", args);
    },
  },
  "daemon cron run": {
    summary: "Request the daemon to run a cron in this vault NOW (drops a trigger file the daemon polls)",
    usage: "<name> --vault <dir>",
    run: (args) => {
      const [name] = positionals(args);
      if (name === undefined) fail("usage: daemon cron run <name> --vault <dir>");
      runCron(name, vaultDaemonDir(requireVault(args)));
      out("ok", args);
    },
  },
  "daemon process toggle": {
    summary: "Enable (or, with --off, disable) a background process in this vault by flipping its `enabled` frontmatter",
    usage: "<name> --vault <dir> [--off]",
    run: (args) => {
      const [name] = positionals(args);
      if (name === undefined) fail("usage: daemon process toggle <name> --vault <dir> [--off]");
      setProcessEnabled(name, !bool(args, "off"), vaultDaemonDir(requireVault(args)));
      out("ok", args);
    },
  },
};
