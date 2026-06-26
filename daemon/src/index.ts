// @bismuth/daemon — the per-vault daemon runtime, absorbed from claude-bot.
//
// The runnable entry is src/daemon/index.ts (compiled to a bundled sidecar binary and
// run as a launchd/systemd service). This barrel exposes the path/config surface for any
// in-process consumer. The vault-aware multiplexing rewrite (one runtime, per-vault
// brains) lands in the daemon-adaptation phase.
export * from "./lib/config";
