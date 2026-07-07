// The daemon-management tools, exposed by the Bismuth MCP server ONLY when the daemon is
// enabled for the active vault — the SAME gate as the memory tools (memoryDir(), i.e.
// BISMUTH_MEMORY_DIR is set). These restore the daemon control surface that the former
// standalone `claude-bot` MCP exposed (crons, processes, the daemon inbox/pages, daemon
// status + device ownership) and that was lost when claude-bot was absorbed into
// @bismuth/daemon.
//
// Design: like app-control, every tool BRIDGES an existing `bismuth` CLI command (via
// mcp/src/cli.ts's runCli) rather than reimplementing daemon logic — the CLI's `daemon`
// and `page` groups already call core directly. That keeps this workspace's dependency
// footprint tiny (no @bismuth/core import) and means there is exactly ONE code path for
// each daemon operation. Because they're daemon-GATED (not always-on), they never tax the
// context of the machine-wide sessions that don't have a daemon — mirroring the memory
// tools' precedent, not the always-on five.
//
// The pure name→argv mapper (`daemonCliArgs`) is separated from the spawn so it can be
// unit-tested without a subprocess.
import { memoryDir } from "./memory";
import { runCli, formatCliResult } from "./cli";

/** True when the daemon is enabled for this session's vault (same signal as the memory tools). */
export function daemonEnabled(): boolean {
  return memoryDir() != null;
}

/**
 * The vault root the daemon tools operate on. The vault-scoped CLI commands (crons,
 * processes, pages, the daemon graph) need `--vault`, and a Bismuth terminal tab only
 * injects BISMUTH_MEMORY_DIR (= `<vault>/.daemon/memory`), not BISMUTH_VAULT — so we
 * derive the vault by stripping the `/.daemon/memory` suffix, falling back to BISMUTH_VAULT
 * (the daemon session sets that explicitly). Returns null when neither is resolvable.
 */
export function daemonVaultRoot(): string | null {
  const mem = process.env.BISMUTH_MEMORY_DIR;
  if (mem) {
    const norm = mem.replace(/[/\\]+$/, "");
    const m = /^(.*)[/\\]\.daemon[/\\]memory$/.exec(norm);
    if (m && m[1]) return m[1];
  }
  return process.env.BISMUTH_VAULT || null;
}

// Raw JSON-Schema tool defs. Terse on purpose — token-frugal, and only ever seen inside a
// daemon-enabled session.
export const daemonTools = [
  {
    name: "daemon_status",
    description:
      "Daemon liveness (running?), this device's id, and the current owner device. (bismuth daemon status)",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "daemon_devices",
    description:
      "List all devices that have heartbeated for this daemon (each flagged owner/this). (bismuth daemon devices)",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "daemon_owner",
    description:
      "Show the current owner device, or — when `device` is given — claim that device as owner. (bismuth daemon owner)",
    inputSchema: {
      type: "object",
      properties: {
        device: {
          type: "string",
          description: "Optional device id to claim as owner. Omit to just read the current owner.",
        },
      },
    },
  },
  {
    name: "daemon_list",
    description:
      "List this vault's daemon crons + background processes with their enabled/running state, schedule, and last-run result. (bismuth daemon graph)",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "cron_run",
    description:
      "Run a cron NOW, out of schedule (drops a trigger the running owner daemon polls). E.g. run 'dream' to consolidate memory now. (bismuth daemon cron run)",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "Cron name (its file basename or frontmatter name)." } },
      required: ["name"],
    },
  },
  {
    name: "cron_toggle",
    description:
      "Enable or disable a cron by flipping its `enabled` frontmatter. Set enabled:false to pause it. (bismuth daemon cron toggle)",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Cron name." },
        enabled: { type: "boolean", description: "true = enable (default), false = disable/pause." },
      },
      required: ["name"],
    },
  },
  {
    name: "process_toggle",
    description:
      "Enable or disable a daemon background process by flipping its `enabled` frontmatter (also nudges the running daemon to start/stop it). Set enabled:false to disable. (bismuth daemon process toggle)",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Process name." },
        enabled: { type: "boolean", description: "true = enable (default), false = disable." },
      },
      required: ["name"],
    },
  },
  {
    name: "page_list",
    description:
      "List the daemon inbox — pages the daemon authored asking the user to approve/dismiss an action (each merged with its dynamic status). (bismuth page list)",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "page_create",
    description:
      "Author a daemon inbox page with validated frontmatter + action buttons (approve/dismiss). Use this instead of hand-writing the nested actions[] YAML. (bismuth page create)",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Page slug (its filename)." },
        title: { type: "string", description: "Optional page title." },
        body: { type: "string", description: "Optional markdown body (the editable draft / question)." },
        actions: {
          type: "array",
          description:
            "Optional action buttons: [{id, label, kind?:'primary'|'default'|'danger', prompt?, model?, timeout?}]. An action WITH `prompt` = approve (the daemon runs the prompt); WITHOUT = pure dismiss.",
          items: { type: "object" },
        },
        source: { type: "string", description: "Optional provenance label, e.g. 'cron:answer-emails'." },
        deliver_at: { type: "string", description: "Optional ISO instant to deliver at (omit = ASAP)." },
      },
      required: ["slug"],
    },
  },
  {
    name: "page_resolve",
    description:
      "Press a page action: approve → the daemon runs its prompt; dismiss → resolved here with no daemon round-trip. (bismuth page resolve)",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "The page's vault-relative path (from page_list), e.g. '.daemon/pages/foo.md'." },
        action: { type: "string", description: "The action id to press." },
      },
      required: ["path", "action"],
    },
  },
] as const;

const DAEMON_TOOL_NAMES: ReadonlySet<string> = new Set(daemonTools.map((t) => t.name));

/** Is `name` one of the daemon-gated tools? Used by the server to route dispatch. */
export function isDaemonTool(name: string): boolean {
  return DAEMON_TOOL_NAMES.has(name);
}

/**
 * PURE: map a daemon tool name + its args + the resolved vault root to the exact `bismuth`
 * CLI argv to run. Vault-scoped commands get `--vault <root>`; machine-level ones
 * (status/devices/owner) don't need it. Throws on a missing required arg or an unknown tool
 * — the server's try/catch turns that into an isError result. No I/O here, so it's unit-tested
 * directly.
 */
export function daemonCliArgs(name: string, a: Record<string, unknown>, vaultRoot: string): string[] {
  const str = (k: string): string | undefined => {
    const v = a[k];
    return typeof v === "string" && v.length > 0 ? v : undefined;
  };
  const req = (k: string): string => {
    const v = str(k);
    if (!v) throw new Error(`${name}: '${k}' is required`);
    return v;
  };
  const vault = ["--vault", vaultRoot];

  switch (name) {
    // ── machine-level (no vault) ────────────────────────────────────────────
    case "daemon_status":
      return ["daemon", "status", "--pretty"];
    case "daemon_devices":
      return ["daemon", "devices", "--pretty"];
    case "daemon_owner": {
      const device = str("device");
      return device ? ["daemon", "owner", device, "--pretty"] : ["daemon", "owner", "--pretty"];
    }

    // ── vault-scoped: crons + processes ─────────────────────────────────────
    case "daemon_list":
      return ["daemon", "graph", ...vault, "--pretty"];
    case "cron_run":
      return ["daemon", "cron", "run", req("name"), ...vault];
    case "cron_toggle": {
      const argv = ["daemon", "cron", "toggle", req("name"), ...vault];
      if (a.enabled === false) argv.push("--off");
      return argv;
    }
    case "process_toggle": {
      const argv = ["daemon", "process", "toggle", req("name"), ...vault];
      if (a.enabled === false) argv.push("--off");
      return argv;
    }

    // ── vault-scoped: the daemon inbox (pages) ──────────────────────────────
    case "page_list":
      return ["page", "list", ...vault, "--pretty"];
    case "page_create": {
      const argv = ["page", "create", req("slug"), ...vault];
      const title = str("title");
      if (title) argv.push("--title", title);
      const body = str("body");
      if (body) argv.push("--body", body);
      if (a.actions !== undefined) {
        argv.push("--actions", typeof a.actions === "string" ? a.actions : JSON.stringify(a.actions));
      }
      const source = str("source");
      if (source) argv.push("--source", source);
      const deliverAt = str("deliver_at");
      if (deliverAt) argv.push("--deliver-at", deliverAt);
      argv.push("--pretty");
      return argv;
    }
    case "page_resolve":
      return ["page", "resolve", req("path"), req("action"), ...vault, "--pretty"];

    default:
      throw new Error(`unknown daemon tool: ${name}`);
  }
}

/**
 * Run a daemon tool by bridging to the `bismuth` CLI. Resolves the vault root, maps the tool
 * to its argv (`daemonCliArgs`), spawns the CLI, and formats stdout/stderr/exit like the
 * `bismuth_cli` tool. Never throws — returns `{text, isError}` for the server to wrap.
 */
export async function runDaemonTool(
  repoRoot: string,
  name: string,
  a: Record<string, unknown>,
): Promise<{ text: string; isError: boolean }> {
  const vaultRoot = daemonVaultRoot();
  if (!vaultRoot) {
    return {
      text: "Daemon tools are unavailable — the daemon is not enabled for this vault.",
      isError: true,
    };
  }
  const argv = daemonCliArgs(name, a, vaultRoot);
  const r = await runCli(repoRoot, argv);
  return { text: formatCliResult(r), isError: r.code !== 0 };
}
