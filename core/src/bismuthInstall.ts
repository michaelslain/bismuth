// Machine-wide install of the bismuth CLI + MCP server.
//
// The bundled app ships compiled `bismuth` + `bismuth-mcp` binaries and the docs/ tree as
// a Tauri resource; the sidecar gets its path in BISMUTH_INSTALL_SRC. On boot (and via
// `bismuth install` / an in-app command) we ensure that source is installed under
// ~/.bismuth, the CLI is symlinked onto PATH, and the MCP is registered in the user's
// GLOBAL Claude config (`claude mcp add -s user`) — so every terminal + every Claude
// session gets them, not just Bismuth app tabs.
//
// Version-gated + idempotent: a content hash of the two binaries is stored at
// ~/.bismuth/.version; if it matches AND the symlink + MCP registration are present, the
// ensure is a no-op. Any change to the bundled binaries (a new build) flips the hash and
// triggers a reinstall. Side effects + detection are injectable (InstallIO) for tests.
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  existsSync,
  mkdirSync,
  rmSync,
  cpSync,
  chmodSync,
  readFileSync,
  writeFileSync,
  lstatSync,
  readlinkSync,
  unlinkSync,
  symlinkSync,
  accessSync,
  constants as fsConstants,
  createReadStream,
} from "node:fs";
import { createHash } from "node:crypto";
import { whichClaude } from "./claudeWhich";
import { MCP_REGISTRARS, type BismuthMcpSpec } from "./agentBackends/mcpRegistrars";

const HOME = homedir();
export const BISMUTH_HOME = join(HOME, ".bismuth");
const BIN_DIR = join(BISMUTH_HOME, "bin");
const DOCS_DIR = join(BISMUTH_HOME, "docs");
const MARKER = join(BISMUTH_HOME, ".version");
const CLI_DEST = join(BIN_DIR, "bismuth");
const MCP_DEST = join(BIN_DIR, "bismuth-mcp");
// Candidate PATH dirs for the CLI symlink, preferred first (machine-wide before per-user).
const LINK_DIRS = ["/usr/local/bin", join(HOME, ".local", "bin")];

/** Per-registrar detect/register status for the "other CLIs" surface (core/src/agentBackends/
 *  mcpRegistrars.ts) — every non-Claude agent CLI Bismuth knows how to register its MCP with. */
export interface AdditionalMcpStatus {
  label: string;
  detected: boolean;
  registered: boolean;
}

export interface BismuthStatus {
  /** A version marker exists at ~/.bismuth/.version. */
  installed: boolean;
  /** The stored marker (content hash), or null. */
  version: string | null;
  /** Our CLI symlink on PATH, or null. */
  cliPath: string | null;
  cliLinked: boolean;
  mcpRegistered: boolean;
  /** Detected/registered status for every OTHER agent CLI (opt-in — see `mcp.registerWith` in
   *  settingsSchema.ts and `bismuth install --mcp`). Undefined only if the injected IO doesn't
   *  implement `additionalMcpStatus` (older fakes in tests). */
  additionalMcp?: Record<string, AdditionalMcpStatus>;
}

export type InstallAction =
  | "up-to-date"
  | "installed"
  | "updated"
  | "would-install"
  | "would-update"
  | "skipped-no-src";

export interface InstallResult {
  action: InstallAction;
  status: BismuthStatus;
  warnings: string[];
}

/** Effectful + detection operations, injected so the decision logic is unit-testable. */
export interface InstallIO {
  /** Content hash of the source binaries, or null if the source is missing/incomplete. */
  hashSrc(src: string): Promise<string | null>;
  readMarker(): string | null;
  writeMarker(hash: string): void;
  /** Our CLI symlink present on PATH (pointing into ~/.bismuth)? */
  cliLinked(): { linked: boolean; path: string | null };
  mcpRegistered(): Promise<boolean>;
  /** Copy bin/ + docs/ from src into ~/.bismuth and chmod the binaries. */
  installFiles(src: string): void;
  /** Symlink ~/.bismuth/bin/bismuth onto PATH (never clobbering a foreign file). */
  linkCli(): { ok: boolean; path: string | null; warning?: string };
  /** Register the MCP in the user's global Claude config (idempotent remove+add). */
  registerMcp(): Promise<{ ok: boolean; warning?: string }>;
  /**
   * Register the MCP with every OTHER (non-Claude) agent CLI id the caller opted into — best
   * effort per id, keyed by registrar id, never throws (see core/src/agentBackends/mcpRegistrars.ts).
   * `ids` of `["all"]` registers with every detected registrar. Optional so existing InstallIO
   * fakes (tests) that predate this multi-CLI step keep type-checking unchanged.
   */
  registerAdditionalMcp?(ids: string[]): Promise<Record<string, { ok: boolean; warning?: string }>>;
  /** Detected/registered status for every OTHER agent CLI registrar. Optional for the same reason
   *  as registerAdditionalMcp. */
  additionalMcpStatus?(): Promise<Record<string, AdditionalMcpStatus>>;
}

function sha256File(path: string): Promise<string> {
  return new Promise((res, rej) => {
    const h = createHash("sha256");
    const s = createReadStream(path);
    s.on("data", (c) => h.update(c));
    s.on("end", () => res(h.digest("hex")));
    s.on("error", rej);
  });
}

async function runClaude(
  bin: string,
  args: string[],
  timeoutMs = 15_000,
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const proc = Bun.spawn([bin, ...args], {
      env: process.env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const timer = setTimeout(() => proc.kill(), timeoutMs);
    try {
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      return { code, stdout, stderr };
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    return { code: -1, stdout: "", stderr: e instanceof Error ? e.message : String(e) };
  }
}

function isWritableDir(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true });
    accessSync(dir, fsConstants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** Resolve our CLI symlink among the candidate dirs: a symlink pointing into ~/.bismuth. */
function findOurLink(): string | null {
  for (const dir of LINK_DIRS) {
    const target = join(dir, "bismuth");
    try {
      const st = lstatSync(target, { throwIfNoEntry: false });
      if (st?.isSymbolicLink() && resolve(readlinkSync(target)).startsWith(BISMUTH_HOME)) {
        return target;
      }
    } catch {
      // unreadable — skip
    }
  }
  return null;
}

/** The real, default IO — does the actual fs + claude work. */
export const defaultIO: InstallIO = {
  async hashSrc(src) {
    const cli = join(src, "bin", "bismuth");
    const mcp = join(src, "bin", "bismuth-mcp");
    if (!existsSync(cli) || !existsSync(mcp)) return null;
    return `${await sha256File(cli)}:${await sha256File(mcp)}`;
  },
  readMarker() {
    try {
      return existsSync(MARKER) ? readFileSync(MARKER, "utf8").trim() || null : null;
    } catch {
      return null;
    }
  },
  writeMarker(hash) {
    mkdirSync(BISMUTH_HOME, { recursive: true });
    writeFileSync(MARKER, hash);
  },
  cliLinked() {
    const path = findOurLink();
    return { linked: path != null && existsSync(CLI_DEST), path };
  },
  async mcpRegistered() {
    const claude = whichClaude();
    if (!claude) return false;
    const r = await runClaude(claude, ["mcp", "get", "bismuth"]);
    return r.code === 0;
  },
  installFiles(src) {
    mkdirSync(BIN_DIR, { recursive: true });
    cpSync(join(src, "bin"), BIN_DIR, { recursive: true });
    for (const f of [CLI_DEST, MCP_DEST]) if (existsSync(f)) chmodSync(f, 0o755);
    rmSync(DOCS_DIR, { recursive: true, force: true });
    const docsSrc = join(src, "docs");
    if (existsSync(docsSrc)) cpSync(docsSrc, DOCS_DIR, { recursive: true });
  },
  linkCli() {
    for (const dir of LINK_DIRS) {
      if (!isWritableDir(dir)) continue;
      const target = join(dir, "bismuth");
      try {
        const st = lstatSync(target, { throwIfNoEntry: false });
        if (st) {
          const ours = st.isSymbolicLink() && resolve(readlinkSync(target)).startsWith(BISMUTH_HOME);
          if (!ours) continue; // foreign file/symlink — never clobber; try next dir
          unlinkSync(target);
        }
        symlinkSync(CLI_DEST, target);
        return { ok: true, path: target };
      } catch {
        // not writable / race — try next dir
      }
    }
    return { ok: false, path: null, warning: "no writable PATH dir for the bismuth CLI symlink" };
  },
  async registerMcp() {
    const claude = whichClaude();
    if (!claude) return { ok: false, warning: "claude not found on PATH — skipped MCP registration" };
    await runClaude(claude, ["mcp", "remove", "-s", "user", "bismuth"]); // ignore if absent
    const add = await runClaude(claude, [
      "mcp", "add", "-s", "user", "bismuth",
      "-e", `BISMUTH_DOCS_DIR=${DOCS_DIR}`,
      "-e", `BISMUTH_CLI=${CLI_DEST}`,
      "--", MCP_DEST,
    ]);
    if (add.code !== 0) return { ok: false, warning: `claude mcp add failed: ${add.stderr.trim() || add.stdout.trim()}` };
    return { ok: true };
  },
  async registerAdditionalMcp(ids) {
    const spec: BismuthMcpSpec = { mcpBin: MCP_DEST, docsDir: DOCS_DIR, cliBin: CLI_DEST };
    const wantAll = ids.includes("all");
    const out: Record<string, { ok: boolean; warning?: string }> = {};
    for (const registrar of MCP_REGISTRARS) {
      if (!wantAll && !ids.includes(registrar.id)) continue;
      out[registrar.id] = await registrar.register(spec);
    }
    return out;
  },
  async additionalMcpStatus() {
    const out: Record<string, AdditionalMcpStatus> = {};
    for (const registrar of MCP_REGISTRARS) {
      const detected = registrar.detect() != null;
      out[registrar.id] = { label: registrar.label, detected, registered: detected ? await registrar.isRegistered() : false };
    }
    return out;
  },
};

/** Read-only status. Never throws. */
export async function getBismuthStatus(io: InstallIO = defaultIO): Promise<BismuthStatus> {
  const version = io.readMarker();
  const { linked, path } = io.cliLinked();
  let mcpRegistered = false;
  try {
    mcpRegistered = await io.mcpRegistered();
  } catch {
    mcpRegistered = false;
  }
  const additionalMcp = io.additionalMcpStatus ? await io.additionalMcpStatus() : undefined;
  return { installed: version != null, version, cliPath: path, cliLinked: linked, mcpRegistered, additionalMcp };
}

/**
 * Registration of Bismuth's MCP server with OTHER (non-Claude) agent CLIs. Runs only for CLIs the
 * user named — either on demand (`bismuth install --mcp <cli>`) or, on boot, for whatever is listed
 * in `mcp.registerWith` (naming a CLI there IS the opt-in). A CLI absent from both is never touched,
 * which is the whole point: Claude auto-registers because Bismuth is a Claude-first app, but writing
 * uninvited into someone's Codex or Gemini config is not ours to do.
 * `ids` of `["all"]` registers with every detected registrar. Best-effort per id; never throws.
 */
export async function registerAdditionalMcp(
  ids: string[],
  io: InstallIO = defaultIO,
): Promise<Record<string, { ok: boolean; warning?: string }>> {
  if (!io.registerAdditionalMcp) return {};
  return io.registerAdditionalMcp(ids);
}

/** Detected/registered status for every OTHER agent CLI registrar — the "which CLIs are detected
 *  and which are registered" listing `bismuth install --status` surfaces. */
export async function getAdditionalMcpStatus(
  io: InstallIO = defaultIO,
): Promise<Record<string, AdditionalMcpStatus>> {
  if (!io.additionalMcpStatus) return {};
  return io.additionalMcpStatus();
}

/**
 * Version-gated, idempotent ensure. `src` = the install source dir (bin/ + docs/), normally
 * BISMUTH_INSTALL_SRC. No-op when the bundled-binary hash matches the stored marker AND
 * the CLI symlink + MCP registration are present. Never throws — failures surface as warnings.
 */
export async function ensureBismuthInstalled(
  src: string | undefined,
  io: InstallIO = defaultIO,
  opts: { dryRun?: boolean; registerWith?: string[] } = {},
): Promise<InstallResult> {
  const status0 = await getBismuthStatus(io);
  if (!src) return { action: "skipped-no-src", status: status0, warnings: [] };

  const hash = await io.hashSrc(src);
  if (!hash) return { action: "skipped-no-src", status: status0, warnings: [] };

  const wasInstalled = status0.version != null;
  if (status0.version === hash && status0.cliLinked && status0.mcpRegistered) {
    return { action: "up-to-date", status: status0, warnings: [] };
  }
  if (opts.dryRun) {
    return { action: wasInstalled ? "would-update" : "would-install", status: status0, warnings: [] };
  }

  const warnings: string[] = [];
  io.installFiles(src);
  const link = io.linkCli();
  if (link.warning) warnings.push(link.warning);
  const mcp = await io.registerMcp();
  if (mcp.warning) warnings.push(mcp.warning);
  // Other CLIs the user LISTED in `mcp.registerWith`. Naming a CLI there is the explicit opt-in —
  // the setting would be a footgun otherwise: a user who adds "codex", restarts, and finds nothing
  // registered has been silently ignored. So consent recorded in settings is acted on here, while a
  // CLI absent from the list is still never touched. Best-effort + idempotent, like every step above.
  if (opts.registerWith?.length) {
    const results = await registerAdditionalMcp(opts.registerWith, io);
    for (const [id, r] of Object.entries(results)) {
      if (r.warning) warnings.push(`${id}: ${r.warning}`);
    }
  }
  io.writeMarker(hash);

  const status = await getBismuthStatus(io);
  return { action: wasInstalled ? "updated" : "installed", status, warnings };
}

/** Remove the symlink (if ours), the global MCP registration, and ~/.bismuth. Never throws. */
export async function uninstallBismuth(): Promise<{ removed: boolean; warnings: string[] }> {
  const warnings: string[] = [];
  try {
    const link = findOurLink();
    if (link) unlinkSync(link);
  } catch (e) {
    warnings.push(`failed to remove CLI symlink: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    const claude = whichClaude();
    if (claude) await runClaude(claude, ["mcp", "remove", "-s", "user", "bismuth"]);
  } catch {
    // best-effort
  }
  // Best-effort: reverse any of the opt-in "other CLI" registrations too, so an uninstall doesn't
  // leave a dangling ~/.codex/~/.cline/~/.openclaw/~/.gemini/~/.qwen/~/.copilot/~/.config/amp/
  // ~/.factory/~/.config/crush/~/.config/goose entry pointing at a bin dir that's about to be
  // deleted. Each registrar's own unregister() already no-ops when we never registered it (or
  // it's a foreign entry), so this is safe to run unconditionally.
  for (const registrar of MCP_REGISTRARS) {
    try {
      await registrar.unregister();
    } catch {
      // best-effort
    }
  }
  try {
    rmSync(BISMUTH_HOME, { recursive: true, force: true });
  } catch (e) {
    warnings.push(`failed to remove ${BISMUTH_HOME}: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { removed: true, warnings };
}
