// Daemon command group for the `bismuth` CLI.
// Reads/writes the daemon's shared machine-identity state under ~/.bismuth/daemon
// (BISMUTH_DAEMON_DIR override) — NOT the vault — mirroring server.ts's /daemon/*
// routes. status/devices/owner-read/graph just read shared files; owner-set,
// cron/process toggle, and cron run flip frontmatter / drop trigger files that the
// running daemon polls. install/setup spawn the claude-bot entrypoint (read-only
// status vs. the idempotent, adopt-only setup). None of these touch the vault, so
// none require --vault.
import type { CommandMap } from "../types";
import { bool, fail, out, positionals } from "../args";
import {
  daemonStatus,
  listDevices,
  getOwner,
  setOwner,
  setCronEnabled,
  setProcessEnabled,
  runCron,
} from "../../../core/src/daemon";
import { daemonGraph } from "../../../core/src/daemonGraph";
import { installStatus, runSetup, runUpdate } from "../../../core/src/claudebot";

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
    summary: "Update claude-bot: git pull + bun install + restart the daemon (idempotent)",
    usage: "[--pretty]",
    run: async (args) => {
      out(await runUpdate(), args);
    },
  },
  "daemon graph": {
    summary: "Build the daemon-mode graph (daemon hub → crons + processes) and print it as JSON",
    usage: "[--pretty]",
    run: (args) => {
      out(daemonGraph(), args);
    },
  },
  "daemon cron toggle": {
    summary: "Enable (or, with --off, disable) a cron by flipping its `enabled` frontmatter",
    usage: "<name> [--off]",
    run: (args) => {
      const [name] = positionals(args);
      if (name === undefined) fail("usage: daemon cron toggle <name> [--off]");
      setCronEnabled(name, !bool(args, "off"));
      out("ok", args);
    },
  },
  "daemon cron run": {
    summary: "Request the daemon to run a cron NOW (drops a trigger file the daemon polls)",
    usage: "<name>",
    run: (args) => {
      const [name] = positionals(args);
      if (name === undefined) fail("usage: daemon cron run <name>");
      runCron(name);
      out("ok", args);
    },
  },
  "daemon process toggle": {
    summary: "Enable (or, with --off, disable) a background process by flipping its `enabled` frontmatter",
    usage: "<name> [--off]",
    run: (args) => {
      const [name] = positionals(args);
      if (name === undefined) fail("usage: daemon process toggle <name> [--off]");
      setProcessEnabled(name, !bool(args, "off"));
      out("ok", args);
    },
  },
};
