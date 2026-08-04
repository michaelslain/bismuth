// Backends command group for the `bismuth` CLI.
//
// `bismuth backends` answers "which agent CLIs work on this machine, and what will Bismuth do with
// each?" The catalog (core/src/agentBackends/catalog.ts) declares what each CLI *can* do; this
// reports what is actually installed here, which is a different question and the one you want when
// a chat tab shows a setup screen.
//
// Read-only and cheap: it resolves binaries and asks for version strings. It never runs an agent
// turn, authenticates, spends money, starts a daemon, or writes config. Registering Bismuth's MCP
// server with a CLI is deliberately NOT here — that writes to files the user owns, so it stays an
// explicit `bismuth install --mcp <cli>`.
import type { CommandMap } from "../types";
import { bool, out } from "../args";
import { checkBackends, type BackendReport } from "../../../core/src/agentBackends/doctor";

/** One human-readable line per backend. `--json` (via `out`) is the machine path; this is the
 *  default because the common use is a person checking why a provider won't start. */
function formatTable(reports: BackendReport[]): string {
  const rows = reports.map((r) => {
    // An adapter is fetched by npx on first use, so it has no installed version to show and must not
    // get a bare ✓ — the runner being present says nothing about whether the bridge will run.
    const state = r.adapterPackage
      ? `adapter → ${r.adapterPackage}`
      : r.installed
        ? (r.problem ? `! ${r.problem}` : (r.version ?? "installed"))
        : "not installed";
    const surfaces = [
      r.surfaces.chat ? "chat" : null,
      r.surfaces.terminal ? "terminal" : null,
      r.surfaces.relayReporting !== "none" ? `relay:${r.surfaces.relayReporting}` : null,
      r.surfaces.daemon ? "daemon" : null,
      r.surfaces.mcp !== "none" ? `mcp:${r.surfaces.mcp}` : null,
      `memory:${r.surfaces.memory}`,
    ]
      .filter(Boolean)
      .join(" ");
    const mark = r.adapterPackage ? "~" : r.installed && !r.problem ? "✓" : r.installed ? "!" : "·";
    return { mark, id: r.id, state, surfaces, hint: r.installHint };
  });
  const idW = Math.max(...rows.map((r) => r.id.length), 7);
  const stateW = Math.max(...rows.map((r) => r.state.length), 5);
  const lines = rows.map(
    (r) => `${r.mark} ${r.id.padEnd(idW)}  ${r.state.padEnd(stateW)}  ${r.surfaces}`,
  );
  const missing = rows.filter((r) => r.hint);
  if (missing.length) {
    lines.push("");
    lines.push("Not installed:");
    for (const m of missing) lines.push(`  ${m.id}: ${m.hint}`);
  }
  return lines.join("\n");
}

export const commands: CommandMap = {
  backends: {
    summary: "List agent backends: which CLIs are installed here, and which surfaces each supports",
    usage: "[--json] [--installed]",
    run: async (args) => {
      const all = await checkBackends();
      const reports = bool(args, "installed") ? all.filter((r) => r.installed) : all;
      // `--json` is handled by out(); the readable table is the default for a human debugging a
      // provider that won't start.
      if (args.includes("--json")) {
        out(reports, args);
        return;
      }
      console.log(formatTable(reports));
    },
  },
};
