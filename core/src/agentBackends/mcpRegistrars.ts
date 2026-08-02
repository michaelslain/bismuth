// core/src/agentBackends/mcpRegistrars.ts
//
// Generalizes Bismuth's MCP-server registration from "Claude Code only" (core/src/bismuthInstall.ts's
// registerMcp()) to every agent CLI the user has installed. This is useful even for CLIs Bismuth
// never drives as a chat backend (e.g. OpenClaw is a poor chat backend but its MCP story is fine) —
// so this module is deliberately independent of chatProviders/agentBackends' catalog.ts.
//
// Design mirrors bismuthInstall.ts's InstallIO seam exactly: every effectful operation (spawn a CLI,
// read/write a config file) is injectable via RegistrarIO, so registrar logic is unit-testable
// without touching the real ~/.codex, ~/.cline, ~/.openclaw, ~/.gemini, ~/.qwen, ~/.copilot,
// ~/.config/amp, ~/.factory, ~/.config/crush, ~/.config/goose, or spawning a real agent binary
// (see core/test/agentBackends/mcpRegistrars.test.ts).
//
// Per-CLI mechanism table:
//  - Codex:    `codex mcp add <name> --env K=V -- <cmd>` → ~/.codex/config.toml. TOML is NEVER
//              hand-edited (rule: Codex goes through `codex mcp add` or not at all). No verified
//              `mcp remove`; unregister() attempts the conventional sibling verb best-effort.
//  - Cline:    `cline mcp add <name> --transport stdio --yes -- <cmd>` (NO --env flag — verified
//              from the compiled binary's own commander.js option table: only --transport/--header/
//              --yes/--json exist). Registration is therefore two-step: the CLI creates the entry,
//              then we patch in ONLY the `env` field ourselves. No verified `mcp remove` either, so
//              unregister() edits ~/.cline/data/settings/cline_mcp_settings.json directly (the one
//              path rule #1 explicitly allows: no scriptable removal path exists).
//  - OpenClaw: `openclaw mcp set <name> '<json>'` — one shot, JSON payload includes env — the
//              cleanest of the five. Stored under `mcp.servers.<name>` (NOT top-level `mcpServers`)
//              in ~/.openclaw/openclaw.json. `openclaw mcp unset <name>` is a verified removal path.
//  - Gemini:   `gemini mcp add <name> <cmd> -e K=V --scope user` → ~/.gemini/settings.json
//              `mcpServers`. `gemini mcp remove <name>` is verified.
//  - Qwen:     Same `mcpServers` shape as Gemini (confirmed field-for-field), config at
//              ~/.qwen/settings.json, `qwen mcp remove <name>` verified — but the exact `qwen mcp
//              add` flag table shown in research does NOT list an env flag, so (like Cline) Qwen
//              gets the two-step CLI-add-then-env-patch treatment rather than an assumed `-e`.
//  - Copilot:  `copilot mcp add <name> --env K=V -- <cmd>` → ~/.copilot/mcp-config.json
//              `mcpServers` — verified verbatim from github/docs raw source. `copilot mcp remove`
//              is a verified removal path.
//  - Amp:      `amp mcp add <name> --env K=V -- <cmd>` → ~/.config/amp/settings.json, under the
//              literal (dotted) top-level key `"amp.mcpServers"` — NOT a nested `amp: {mcpServers}`
//              object — confirmed live in `--help` output. `amp mcp remove <name>` is verified.
//  - Droid:    `droid mcp add <name> "<cmd>" --env K=V` → ~/.factory/mcp.json `mcpServers` — note
//              the command is a single positional string, not a `-- cmd` split. `droid mcp remove`
//              is verified.
//  - Crush:    NO `crush mcp add` subcommand exists (confirmed absent from the CLI usage
//              reference) — every registration goes through the file: ~/.config/crush/crush.json
//              `mcp.<name>` (verified verbatim shape from the project's GitHub README), so
//              register()/unregister() write/remove the whole entry ourselves (rule #2's file
//              fallback, not a two-step patch).
//  - Goose:    Same situation as Crush — no non-interactive `goose extension add` one-liner was
//              found (only the interactive `goose configure` wizard), so registration writes
//              directly into ~/.config/goose/config.yaml's `extensions:` LIST (an array of
//              `{name, enabled, transport:{type,command,args}, env}` objects, not a name-keyed
//              object like every other CLI here) — confirmed shape from official docs. YAML, so
//              edited via the `yaml` Document API (mutateFrontmatter's precedent), never
//              round-tripped through plain-object stringify (which would nuke comments/formatting).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parseDocument } from "yaml";
import { whichBinary } from "../claudeWhich";

/** What the caller wants registered: our compiled MCP binary + the env it needs to find the docs
 *  tree / cli binary / (optionally) a specific vault. Mirrors the env vars bismuthInstall.ts's
 *  registerMcp() already passes to `claude mcp add` for the machine-wide install case. */
export interface BismuthMcpSpec {
  mcpBin: string;
  docsDir?: string;
  cliBin: string;
  vaultRoot?: string;
  memoryDir?: string;
}

export interface McpRegistrar {
  id: string;
  label: string;
  /** Resolved binary on PATH, or null. */
  detect(): string | null;
  isRegistered(): Promise<boolean>;
  register(spec: BismuthMcpSpec): Promise<{ ok: boolean; warning?: string }>;
  unregister(): Promise<void>;
}

// --- Injectable effectful seam (mirrors bismuthInstall.ts's InstallIO) -----------------------

export interface RegistrarIO {
  which(bin: string): string | null;
  /** Spawn `bin args…`, stdin ignored, killed after `timeoutMs`. Never throws — a spawn failure
   *  surfaces as `{code: -1, stderr: <message>}`. */
  run(bin: string, args: string[], timeoutMs?: number): Promise<{ code: number; stdout: string; stderr: string }>;
  readFile(path: string): string | null;
  writeFile(path: string, content: string): void;
  homedir(): string;
  now(): string;
}

const DEFAULT_TIMEOUT_MS = 15_000;

async function spawnBestEffort(
  bin: string,
  args: string[],
  timeoutMs: number,
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const proc = Bun.spawn([bin, ...args], { env: process.env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
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

/** The real, default IO — does the actual spawn + fs work. */
export const defaultRegistrarIO: RegistrarIO = {
  which: (bin) => whichBinary(bin),
  run: (bin, args, timeoutMs = DEFAULT_TIMEOUT_MS) => spawnBestEffort(bin, args, timeoutMs),
  readFile: (path) => {
    try {
      return existsSync(path) ? readFileSync(path, "utf8") : null;
    } catch {
      return null;
    }
  },
  writeFile: (path, content) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  },
  homedir: () => homedir(),
  now: () => new Date().toISOString(),
};

// --- Env the MCP server needs ------------------------------------------------------------------

function buildEnv(spec: BismuthMcpSpec): Record<string, string> {
  const env: Record<string, string> = { BISMUTH_CLI: spec.cliBin };
  if (spec.docsDir) env.BISMUTH_DOCS_DIR = spec.docsDir;
  if (spec.vaultRoot) env.BISMUTH_VAULT = spec.vaultRoot;
  if (spec.memoryDir) env.BISMUTH_MEMORY_DIR = spec.memoryDir;
  return env;
}

// --- Pure JSON helpers (unit-testable with plain strings, no fs/subprocess) -------------------

/** Parse JSON leniently: `null` text (file absent) → `{}` (an empty config is fine to build on);
 *  unparseable text → `null`, distinct from "empty", so callers can warn instead of clobbering. */
function parseJsonLenient(text: string | null): Record<string, unknown> | null {
  if (text == null) return {};
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return null;
  }
}

function getPath(obj: Record<string, unknown>, path: string[]): unknown {
  let cur: unknown = obj;
  for (const k of path) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

/** Best-effort indent detection so a rewritten file doesn't reformat the user's whole config;
 *  defaults to 2 spaces for a brand-new file. */
function detectIndent(text: string | null): string {
  if (!text) return "  ";
  const m = text.match(/\n([ \t]+)\S/);
  return m ? m[1] : "  ";
}

/**
 * Structure-preserving PATCH of just `obj[...keyPath][name].env`, preserving every other field of
 * that entry (command/args/disabled/…) plus every unrelated top-level key and other server entries
 * untouched. Used where the CLI's own add/set command has no way to pass our env vars (Cline,
 * Qwen) — we let the CLI write the base entry, then patch in only the env block ourselves.
 * Returns `{text: null}` when the file is unparseable or the target entry doesn't exist yet (the
 * caller should treat that as "nothing to patch", not an error — the CLI add may have failed).
 */
export function patchJsonMcpServerEnv(
  existingText: string | null,
  keyPath: string[],
  name: string,
  env: Record<string, string>,
): { text: string | null } {
  const parsed = parseJsonLenient(existingText);
  if (parsed === null) return { text: null };
  const container = getPath(parsed, keyPath);
  if (!container || typeof container !== "object") return { text: null };
  const entry = (container as Record<string, unknown>)[name];
  if (!entry || typeof entry !== "object") return { text: null };
  (entry as Record<string, unknown>).env = env;
  return { text: JSON.stringify(parsed, null, detectIndent(existingText)) + "\n" };
}

/**
 * Structure-preserving REMOVAL of `obj[...keyPath][name]`, but only when `isOurs(existing)` is
 * true — mirrors bismuthInstall.ts's linkCli() "never clobber a foreign file" discipline: a
 * pre-existing entry we didn't write is left alone even on unregister. Every other key (unknown
 * top-level keys, other servers under the same keyPath) survives untouched.
 */
export function removeJsonMcpServer(
  existingText: string | null,
  keyPath: string[],
  name: string,
  isOurs: (existing: unknown) => boolean,
): { text: string | null; removed: boolean } {
  if (existingText == null) return { text: existingText, removed: false };
  const parsed = parseJsonLenient(existingText);
  if (parsed === null) return { text: existingText, removed: false };
  const container = getPath(parsed, keyPath);
  if (!container || typeof container !== "object") return { text: existingText, removed: false };
  const c = container as Record<string, unknown>;
  const existing = c[name];
  if (existing === undefined || !isOurs(existing)) return { text: existingText, removed: false };
  delete c[name];
  return { text: JSON.stringify(parsed, null, detectIndent(existingText)) + "\n", removed: true };
}

/**
 * Structure-preserving UPSERT of a whole `obj[...keyPath][name]` entry — used where no CLI
 * `mcp add` subcommand exists at all (Crush), so we must create/overwrite the ENTIRE entry
 * ourselves rather than patching just the env block onto something a CLI already created.
 * Refuses (returns `{text: null, warning}`) when a pre-existing entry isn't ours, mirroring
 * removeJsonMcpServer's ownership discipline. Creates the container path if missing. Every
 * unrelated top-level key, and every other entry under keyPath, survives untouched.
 */
export function upsertJsonMcpServer(
  existingText: string | null,
  keyPath: string[],
  name: string,
  entry: Record<string, unknown>,
  isOurs: (existing: unknown) => boolean,
): { text: string | null; warning?: string } {
  const parsed = parseJsonLenient(existingText);
  if (parsed === null) return { text: null, warning: "existing MCP config isn't valid JSON — skipped" };
  let cur: Record<string, unknown> = parsed;
  for (const k of keyPath) {
    const next = cur[k];
    if (!next || typeof next !== "object" || Array.isArray(next)) cur[k] = {};
    cur = cur[k] as Record<string, unknown>;
  }
  const existing = cur[name];
  if (existing !== undefined && !isOurs(existing)) {
    return { text: null, warning: `a "${name}" MCP entry already exists and wasn't created by Bismuth — skipped` };
  }
  cur[name] = entry;
  return { text: JSON.stringify(parsed, null, detectIndent(existingText)) + "\n" };
}

/** Ownership check generalized over where in an entry the `command` field lives — every JSON
 *  registrar keeps it at the top level (`entry.command`), but Goose nests it under
 *  `entry.transport.command`. True when it points into `<home>/.bismuth` — i.e. something we
 *  (a past run of this installer) wrote, not the user's own unrelated config. */
function ownsEntryCommand(home: string, extractCommand: (existing: unknown) => unknown): (existing: unknown) => boolean {
  const prefix = join(home, ".bismuth");
  return (existing) => {
    if (!existing || typeof existing !== "object") return false;
    const command = extractCommand(existing);
    return typeof command === "string" && command.startsWith(prefix);
  };
}

/** True when an existing MCP-server JSON entry's `command` points into `<home>/.bismuth` — i.e.
 *  something we (a past run of this installer) wrote, not the user's own unrelated config. */
function ownsCommand(home: string): (existing: unknown) => boolean {
  return ownsEntryCommand(home, (existing) => (existing as Record<string, unknown>).command);
}

// --- YAML helpers (Goose's config.yaml `extensions:` LIST — array-of-objects, not a name-keyed
// object, so it needs its own merge shape distinct from the JSON dict helpers above) -----------

/** Get (or lazily create) the `extensions` YAMLSeq node on a parsed Document. */
function extensionsSeq(doc: ReturnType<typeof parseDocument>): any {
  let seq = doc.get("extensions");
  if (!seq || typeof (seq as any).items === "undefined") {
    doc.set("extensions", []);
    seq = doc.get("extensions");
  }
  return seq;
}

function stringifyYamlDoc(doc: ReturnType<typeof parseDocument>): string {
  let out = doc.toString({ flowCollectionPadding: false });
  if (!out.endsWith("\n")) out += "\n";
  return out;
}

/**
 * Structure-preserving UPSERT of one item (matched by its `name` field) in Goose's
 * `extensions:` YAML list — preserves every other key in the document (provider/model/…),
 * every other extension entry, and comments, by editing via the `yaml` Document API rather
 * than round-tripping through parse()+stringify(). Refuses to touch a pre-existing entry
 * that isn't ours (same discipline as upsertJsonMcpServer). `existingText: null` (file
 * absent) is treated as an empty document to build fresh.
 */
export function upsertYamlExtension(
  existingText: string | null,
  name: string,
  entry: Record<string, unknown>,
  isOurs: (existing: unknown) => boolean,
): { text: string | null; warning?: string } {
  let doc: ReturnType<typeof parseDocument>;
  try {
    doc = parseDocument(existingText ?? "");
  } catch {
    return { text: null, warning: "existing config isn't valid YAML — skipped" };
  }
  if (doc.errors.length > 0) return { text: null, warning: "existing config isn't valid YAML — skipped" };
  const seq = extensionsSeq(doc);
  const idx = seq.items.findIndex((it: any) => it?.get && it.get("name") === name);
  if (idx >= 0) {
    // NOTE: seq.get(idx) returns the raw Map NODE for a non-scalar item (only scalars get
    // unwrapped) — .toJSON() is what actually converts it to a plain JS object isOurs() can
    // introspect; passing the node itself would make every `?.` chain in isOurs() silently
    // resolve to undefined.
    const existingJson = seq.items[idx].toJSON();
    if (!isOurs(existingJson)) {
      return { text: null, warning: `a "${name}" extension already exists and wasn't created by Bismuth — skipped` };
    }
    seq.set(idx, doc.createNode(entry));
  } else {
    seq.add(doc.createNode(entry));
  }
  return { text: stringifyYamlDoc(doc) };
}

/**
 * Structure-preserving REMOVAL of one item (matched by `name`) from Goose's `extensions:`
 * list, but only when `isOurs(existing)` is true — mirrors removeJsonMcpServer's "never
 * clobber a foreign entry" discipline, even on unregister.
 */
export function removeYamlExtension(
  existingText: string | null,
  name: string,
  isOurs: (existing: unknown) => boolean,
): { text: string | null; removed: boolean } {
  if (existingText == null) return { text: existingText, removed: false };
  let doc: ReturnType<typeof parseDocument>;
  try {
    doc = parseDocument(existingText);
  } catch {
    return { text: existingText, removed: false };
  }
  if (doc.errors.length > 0) return { text: existingText, removed: false };
  const seq = doc.get("extensions") as any;
  if (!seq || typeof seq.items === "undefined") return { text: existingText, removed: false };
  const idx = seq.items.findIndex((it: any) => it?.get && it.get("name") === name);
  if (idx < 0) return { text: existingText, removed: false };
  const existingJson = seq.items[idx].toJSON();
  if (!isOurs(existingJson)) return { text: existingText, removed: false };
  seq.delete(idx);
  return { text: stringifyYamlDoc(doc), removed: true };
}

// --- Registrations ledger (~/.bismuth/.mcp-registrations.json) --------------------------------

export interface McpLedgerEntry {
  at: string;
  method: "cli" | "config";
  path?: string;
}

function ledgerPath(io: RegistrarIO): string {
  return join(io.homedir(), ".bismuth", ".mcp-registrations.json");
}

function readLedger(io: RegistrarIO): Record<string, McpLedgerEntry> {
  const text = io.readFile(ledgerPath(io));
  if (!text) return {};
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" ? (v as Record<string, McpLedgerEntry>) : {};
  } catch {
    return {};
  }
}

function writeLedgerEntry(io: RegistrarIO, id: string, entry: McpLedgerEntry): void {
  const ledger = readLedger(io);
  ledger[id] = entry;
  io.writeFile(ledgerPath(io), JSON.stringify(ledger, null, 2) + "\n");
}

function clearLedgerEntry(io: RegistrarIO, id: string): void {
  const ledger = readLedger(io);
  if (!(id in ledger)) return;
  delete ledger[id];
  io.writeFile(ledgerPath(io), JSON.stringify(ledger, null, 2) + "\n");
}

/** Did WE register this id, per our own ledger? This is the authoritative "did Bismuth do this"
 *  signal `unregister()` gates on — most importantly for Codex, where the config is TOML we never
 *  read, so there is no other way to avoid removing a "bismuth"-named entry the user created
 *  themselves for something unrelated to this installer. */
function hasLedgerEntry(io: RegistrarIO, id: string): boolean {
  return id in readLedger(io);
}

// --- Per-CLI registrars -------------------------------------------------------------------------

/** OpenAI Codex CLI. TOML config — never hand-edited; every op goes through `codex mcp …`. */
export function createCodexRegistrar(io: RegistrarIO = defaultRegistrarIO): McpRegistrar {
  const id = "codex";
  const label = "Codex CLI";
  const bin = () => io.which("codex");
  return {
    id,
    label,
    detect: bin,
    async isRegistered() {
      const codex = bin();
      if (!codex) return false;
      const r = await io.run(codex, ["mcp", "list"]);
      return r.code === 0 && r.stdout.includes("bismuth");
    },
    async register(spec) {
      const codex = bin();
      if (!codex) return { ok: false, warning: `${label} not found on PATH — skipped` };
      const args = ["mcp", "add", "bismuth"];
      for (const [k, v] of Object.entries(buildEnv(spec))) args.push("--env", `${k}=${v}`);
      args.push("--", spec.mcpBin);
      const r = await io.run(codex, args);
      if (r.code !== 0) {
        return { ok: false, warning: `codex mcp add failed: ${(r.stderr || r.stdout).trim() || `exit ${r.code}`}` };
      }
      writeLedgerEntry(io, id, { at: io.now(), method: "cli" });
      return { ok: true };
    },
    async unregister() {
      // Gate on our own ledger, not just "codex is on PATH": Codex's config is TOML, which we
      // never read (rule: never hand-edit TOML), so the ledger is the ONLY way to know whether a
      // "bismuth" entry in the user's config is one we created vs. something of their own that
      // happens to share the name — removing blind would risk clobbering the latter.
      if (!hasLedgerEntry(io, id)) return;
      const codex = bin();
      // No verified `codex mcp remove` in the research this was built from (only add/list/login
      // were confirmed) — attempt the conventional sibling verb best-effort (spawnBestEffort never
      // throws) regardless of the subprocess result.
      if (codex) await io.run(codex, ["mcp", "remove", "bismuth"]);
      clearLedgerEntry(io, id);
    },
  };
}

/** Cline. No --env on `cline mcp add` (verified from the compiled binary's own option table) — a
 *  two-step register: CLI add, then patch the env block into the file ourselves. No verified
 *  remove subcommand either, so unregister() edits the file directly. */
export function createClineRegistrar(io: RegistrarIO = defaultRegistrarIO): McpRegistrar {
  const id = "cline";
  const label = "Cline";
  const bin = () => io.which("cline");
  const configPath = () => join(io.homedir(), ".cline", "data", "settings", "cline_mcp_settings.json");
  const isOurs = () => ownsCommand(io.homedir());
  return {
    id,
    label,
    detect: bin,
    async isRegistered() {
      const parsed = parseJsonLenient(io.readFile(configPath()));
      if (!parsed) return false;
      return getPath(parsed, ["mcpServers", "bismuth"]) !== undefined;
    },
    async register(spec) {
      const cline = bin();
      if (!cline) return { ok: false, warning: `${label} not found on PATH — skipped` };
      const existingText = io.readFile(configPath());
      const parsedCheck = parseJsonLenient(existingText);
      if (parsedCheck === null) {
        return { ok: false, warning: `${label}: existing MCP config isn't valid JSON — skipped` };
      }
      const existingEntry = getPath(parsedCheck, ["mcpServers", "bismuth"]);
      if (existingEntry !== undefined && !isOurs()(existingEntry)) {
        return { ok: false, warning: `${label} already has a "bismuth" MCP entry Bismuth didn't create — skipped` };
      }
      const r = await io.run(cline, ["mcp", "add", "bismuth", "--transport", "stdio", "--yes", "--", spec.mcpBin]);
      if (r.code !== 0) {
        return { ok: false, warning: `cline mcp add failed: ${(r.stderr || r.stdout).trim() || `exit ${r.code}`}` };
      }
      const afterAdd = io.readFile(configPath());
      const patched = patchJsonMcpServerEnv(afterAdd, ["mcpServers"], "bismuth", buildEnv(spec));
      if (patched.text != null) io.writeFile(configPath(), patched.text);
      writeLedgerEntry(io, id, { at: io.now(), method: "cli", path: configPath() });
      return patched.text == null
        ? { ok: true, warning: `cline mcp add succeeded but its env block could not be patched in` }
        : { ok: true };
    },
    async unregister() {
      if (!hasLedgerEntry(io, id)) return;
      const existingText = io.readFile(configPath());
      const result = removeJsonMcpServer(existingText, ["mcpServers"], "bismuth", isOurs());
      if (result.removed && result.text != null) io.writeFile(configPath(), result.text);
      clearLedgerEntry(io, id);
    },
  };
}

/** OpenClaw. `mcp set` is a single-shot JSON payload (command+args+env all at once) — the
 *  cleanest of the five — stored under `mcp.servers.<name>`, NOT top-level `mcpServers`. */
export function createOpenClawRegistrar(io: RegistrarIO = defaultRegistrarIO): McpRegistrar {
  const id = "openclaw";
  const label = "OpenClaw";
  const bin = () => io.which("openclaw");
  const configPath = () => join(io.homedir(), ".openclaw", "openclaw.json");
  const isOurs = () => ownsCommand(io.homedir());
  return {
    id,
    label,
    detect: bin,
    async isRegistered() {
      const parsed = parseJsonLenient(io.readFile(configPath()));
      if (!parsed) return false;
      return getPath(parsed, ["mcp", "servers", "bismuth"]) !== undefined;
    },
    async register(spec) {
      const openclaw = bin();
      if (!openclaw) return { ok: false, warning: `${label} not found on PATH — skipped` };
      const existingText = io.readFile(configPath());
      const parsedCheck = parseJsonLenient(existingText);
      if (parsedCheck === null) {
        return { ok: false, warning: `${label}: existing config isn't valid JSON — skipped` };
      }
      const existingEntry = getPath(parsedCheck, ["mcp", "servers", "bismuth"]);
      if (existingEntry !== undefined && !isOurs()(existingEntry)) {
        return { ok: false, warning: `${label} already has a "bismuth" MCP entry Bismuth didn't create — skipped` };
      }
      const payload = JSON.stringify({ command: spec.mcpBin, args: [], env: buildEnv(spec) });
      const r = await io.run(openclaw, ["mcp", "set", "bismuth", payload]);
      if (r.code !== 0) {
        return { ok: false, warning: `openclaw mcp set failed: ${(r.stderr || r.stdout).trim() || `exit ${r.code}`}` };
      }
      writeLedgerEntry(io, id, { at: io.now(), method: "cli", path: configPath() });
      return { ok: true };
    },
    async unregister() {
      // Gate on our own ledger before calling the CLI's remove verb — `openclaw mcp unset` (like
      // `gemini`/`qwen mcp remove` below) removes by name unconditionally, with no ownership
      // check of its own, so we must not call it for an entry we never created ourselves.
      if (!hasLedgerEntry(io, id)) return;
      const openclaw = bin();
      if (openclaw) await io.run(openclaw, ["mcp", "unset", "bismuth"]);
      clearLedgerEntry(io, id);
    },
  };
}

/** Shared factory for the Gemini-CLI family (Gemini CLI + its Qwen Code fork): same `mcpServers`
 *  shape, config at `~/.<dotDir>/settings.json`, `mcp add/remove` CLI verbs. `supportsEnvFlag`
 *  distinguishes Gemini (verified `-e K=V` on `mcp add`) from Qwen (not shown in its own `mcp add`
 *  flag list, despite an otherwise-identical config shape) — Qwen gets the same two-step
 *  add-then-patch treatment as Cline rather than an assumed flag. */
function createGeminiFamilyRegistrar(
  id: string,
  label: string,
  binaryName: string,
  dotDir: string,
  supportsEnvFlag: boolean,
  io: RegistrarIO,
): McpRegistrar {
  const bin = () => io.which(binaryName);
  const configPath = () => join(io.homedir(), dotDir, "settings.json");
  const isOurs = () => ownsCommand(io.homedir());
  return {
    id,
    label,
    detect: bin,
    async isRegistered() {
      const parsed = parseJsonLenient(io.readFile(configPath()));
      if (!parsed) return false;
      return getPath(parsed, ["mcpServers", "bismuth"]) !== undefined;
    },
    async register(spec) {
      const cli = bin();
      if (!cli) return { ok: false, warning: `${label} not found on PATH — skipped` };
      const existingText = io.readFile(configPath());
      const parsedCheck = parseJsonLenient(existingText);
      if (parsedCheck === null) {
        return { ok: false, warning: `${label}: existing config isn't valid JSON — skipped` };
      }
      const existingEntry = getPath(parsedCheck, ["mcpServers", "bismuth"]);
      if (existingEntry !== undefined && !isOurs()(existingEntry)) {
        return { ok: false, warning: `${label} already has a "bismuth" MCP entry Bismuth didn't create — skipped` };
      }
      const env = buildEnv(spec);
      const args = ["mcp", "add", "bismuth", spec.mcpBin];
      if (supportsEnvFlag) for (const [k, v] of Object.entries(env)) args.push("-e", `${k}=${v}`);
      args.push("--scope", "user");
      const r = await io.run(cli, args);
      if (r.code !== 0) {
        return { ok: false, warning: `${binaryName} mcp add failed: ${(r.stderr || r.stdout).trim() || `exit ${r.code}`}` };
      }
      if (!supportsEnvFlag) {
        const afterAdd = io.readFile(configPath());
        const patched = patchJsonMcpServerEnv(afterAdd, ["mcpServers"], "bismuth", env);
        if (patched.text != null) io.writeFile(configPath(), patched.text);
      }
      writeLedgerEntry(io, id, { at: io.now(), method: "cli", path: configPath() });
      return { ok: true };
    },
    async unregister() {
      // Same ledger-gate rationale as OpenClaw above — `mcp remove <name>` has no ownership
      // concept of its own on either Gemini CLI or Qwen Code.
      if (!hasLedgerEntry(io, id)) return;
      const cli = bin();
      if (cli) await io.run(cli, ["mcp", "remove", "bismuth"]);
      clearLedgerEntry(io, id);
    },
  };
}

export function createGeminiRegistrar(io: RegistrarIO = defaultRegistrarIO): McpRegistrar {
  return createGeminiFamilyRegistrar("gemini", "Gemini CLI", "gemini", ".gemini", true, io);
}

export function createQwenRegistrar(io: RegistrarIO = defaultRegistrarIO): McpRegistrar {
  return createGeminiFamilyRegistrar("qwen", "Qwen Code", "qwen", ".qwen", false, io);
}

/** GitHub Copilot CLI. Verified `copilot mcp add <name> --env K=V -- <cmd>` (+ list/get/remove) —
 *  the cleanest of the batch-3 additions, config at ~/.copilot/mcp-config.json `mcpServers`. */
export function createCopilotRegistrar(io: RegistrarIO = defaultRegistrarIO): McpRegistrar {
  const id = "copilot";
  const label = "GitHub Copilot CLI";
  const bin = () => io.which("copilot");
  const configPath = () => join(io.homedir(), ".copilot", "mcp-config.json");
  const isOurs = () => ownsCommand(io.homedir());
  return {
    id,
    label,
    detect: bin,
    async isRegistered() {
      const parsed = parseJsonLenient(io.readFile(configPath()));
      if (!parsed) return false;
      return getPath(parsed, ["mcpServers", "bismuth"]) !== undefined;
    },
    async register(spec) {
      const copilot = bin();
      if (!copilot) return { ok: false, warning: `${label} not found on PATH — skipped` };
      const existingText = io.readFile(configPath());
      const parsedCheck = parseJsonLenient(existingText);
      if (parsedCheck === null) {
        return { ok: false, warning: `${label}: existing MCP config isn't valid JSON — skipped` };
      }
      const existingEntry = getPath(parsedCheck, ["mcpServers", "bismuth"]);
      if (existingEntry !== undefined && !isOurs()(existingEntry)) {
        return { ok: false, warning: `${label} already has a "bismuth" MCP entry Bismuth didn't create — skipped` };
      }
      const args = ["mcp", "add", "bismuth"];
      for (const [k, v] of Object.entries(buildEnv(spec))) args.push("--env", `${k}=${v}`);
      args.push("--", spec.mcpBin);
      const r = await io.run(copilot, args);
      if (r.code !== 0) {
        return { ok: false, warning: `copilot mcp add failed: ${(r.stderr || r.stdout).trim() || `exit ${r.code}`}` };
      }
      writeLedgerEntry(io, id, { at: io.now(), method: "cli", path: configPath() });
      return { ok: true };
    },
    async unregister() {
      if (!hasLedgerEntry(io, id)) return;
      const copilot = bin();
      if (copilot) await io.run(copilot, ["mcp", "remove", "bismuth"]);
      clearLedgerEntry(io, id);
    },
  };
}

/** Sourcegraph Amp. Verified `amp mcp add <name> --env K=V -- <cmd>` (+ list --json/remove) live
 *  in `--help`. Config at ~/.config/amp/settings.json, under the LITERAL (dotted) top-level key
 *  `"amp.mcpServers"` — NOT a nested `amp: {mcpServers}` object, so the key PATH here is a single
 *  one-element segment containing a dot, not two segments. */
export function createAmpRegistrar(io: RegistrarIO = defaultRegistrarIO): McpRegistrar {
  const id = "amp";
  const label = "Amp";
  const bin = () => io.which("amp");
  const configPath = () => join(io.homedir(), ".config", "amp", "settings.json");
  const KEY = "amp.mcpServers"; // one literal key, not ["amp", "mcpServers"]
  const isOurs = () => ownsCommand(io.homedir());
  return {
    id,
    label,
    detect: bin,
    async isRegistered() {
      const parsed = parseJsonLenient(io.readFile(configPath()));
      if (!parsed) return false;
      return getPath(parsed, [KEY, "bismuth"]) !== undefined;
    },
    async register(spec) {
      const amp = bin();
      if (!amp) return { ok: false, warning: `${label} not found on PATH — skipped` };
      const existingText = io.readFile(configPath());
      const parsedCheck = parseJsonLenient(existingText);
      if (parsedCheck === null) {
        return { ok: false, warning: `${label}: existing config isn't valid JSON — skipped` };
      }
      const existingEntry = getPath(parsedCheck, [KEY, "bismuth"]);
      if (existingEntry !== undefined && !isOurs()(existingEntry)) {
        return { ok: false, warning: `${label} already has a "bismuth" MCP entry Bismuth didn't create — skipped` };
      }
      const args = ["mcp", "add", "bismuth"];
      for (const [k, v] of Object.entries(buildEnv(spec))) args.push("--env", `${k}=${v}`);
      args.push("--", spec.mcpBin);
      const r = await io.run(amp, args);
      if (r.code !== 0) {
        return { ok: false, warning: `amp mcp add failed: ${(r.stderr || r.stdout).trim() || `exit ${r.code}`}` };
      }
      writeLedgerEntry(io, id, { at: io.now(), method: "cli", path: configPath() });
      return { ok: true };
    },
    async unregister() {
      if (!hasLedgerEntry(io, id)) return;
      const amp = bin();
      if (amp) await io.run(amp, ["mcp", "remove", "bismuth"]);
      clearLedgerEntry(io, id);
    },
  };
}

/** Factory AI Droid. Verified `droid mcp add <name> "<cmd>" --env K=V` (+ list/remove) against
 *  the official MCP configuration doc. Config at ~/.factory/mcp.json `mcpServers` (standard
 *  shape). Note the command is a single positional STRING, not a `-- cmd` split like the others. */
export function createDroidRegistrar(io: RegistrarIO = defaultRegistrarIO): McpRegistrar {
  const id = "droid";
  const label = "Droid";
  const bin = () => io.which("droid");
  const configPath = () => join(io.homedir(), ".factory", "mcp.json");
  const isOurs = () => ownsCommand(io.homedir());
  return {
    id,
    label,
    detect: bin,
    async isRegistered() {
      const parsed = parseJsonLenient(io.readFile(configPath()));
      if (!parsed) return false;
      return getPath(parsed, ["mcpServers", "bismuth"]) !== undefined;
    },
    async register(spec) {
      const droid = bin();
      if (!droid) return { ok: false, warning: `${label} not found on PATH — skipped` };
      const existingText = io.readFile(configPath());
      const parsedCheck = parseJsonLenient(existingText);
      if (parsedCheck === null) {
        return { ok: false, warning: `${label}: existing MCP config isn't valid JSON — skipped` };
      }
      const existingEntry = getPath(parsedCheck, ["mcpServers", "bismuth"]);
      if (existingEntry !== undefined && !isOurs()(existingEntry)) {
        return { ok: false, warning: `${label} already has a "bismuth" MCP entry Bismuth didn't create — skipped` };
      }
      const args = ["mcp", "add", "bismuth", spec.mcpBin];
      for (const [k, v] of Object.entries(buildEnv(spec))) args.push("--env", `${k}=${v}`);
      const r = await io.run(droid, args);
      if (r.code !== 0) {
        return { ok: false, warning: `droid mcp add failed: ${(r.stderr || r.stdout).trim() || `exit ${r.code}`}` };
      }
      writeLedgerEntry(io, id, { at: io.now(), method: "cli", path: configPath() });
      return { ok: true };
    },
    async unregister() {
      if (!hasLedgerEntry(io, id)) return;
      const droid = bin();
      if (droid) await io.run(droid, ["mcp", "remove", "bismuth"]);
      clearLedgerEntry(io, id);
    },
  };
}

/** Charm Crush. NO `crush mcp add` subcommand exists (confirmed absent from the CLI usage
 *  reference) — registration writes the WHOLE entry directly into ~/.config/crush/crush.json's
 *  `mcp.<name>` (verified verbatim shape from the project README): `{type, command, args, env}`.
 *  Never spawns `crush` at all — the binary only needs to be ON PATH for us to consider Crush
 *  "present enough to register with" (mirrors the "detected" gate every other registrar uses). */
export function createCrushRegistrar(io: RegistrarIO = defaultRegistrarIO): McpRegistrar {
  const id = "crush";
  const label = "Crush";
  const bin = () => io.which("crush");
  const configPath = () => join(io.homedir(), ".config", "crush", "crush.json");
  const isOurs = () => ownsCommand(io.homedir());
  return {
    id,
    label,
    detect: bin,
    async isRegistered() {
      const parsed = parseJsonLenient(io.readFile(configPath()));
      if (!parsed) return false;
      return getPath(parsed, ["mcp", "bismuth"]) !== undefined;
    },
    async register(spec) {
      if (!bin()) return { ok: false, warning: `${label} not found on PATH — skipped` };
      const existingText = io.readFile(configPath());
      const entry = { type: "stdio", command: spec.mcpBin, args: [], env: buildEnv(spec) };
      const result = upsertJsonMcpServer(existingText, ["mcp"], "bismuth", entry, isOurs());
      if (result.text == null) {
        return { ok: false, warning: result.warning ?? `${label}: could not update config` };
      }
      io.writeFile(configPath(), result.text);
      writeLedgerEntry(io, id, { at: io.now(), method: "config", path: configPath() });
      return { ok: true };
    },
    async unregister() {
      if (!hasLedgerEntry(io, id)) return;
      const existingText = io.readFile(configPath());
      const result = removeJsonMcpServer(existingText, ["mcp"], "bismuth", isOurs());
      if (result.removed && result.text != null) io.writeFile(configPath(), result.text);
      clearLedgerEntry(io, id);
    },
  };
}

/** Block/AAIF Goose. Same situation as Crush — no non-interactive `goose extension add`
 *  one-liner exists (only the interactive `goose configure` wizard) — registration writes
 *  directly into ~/.config/goose/config.yaml's `extensions:` LIST (array-of-objects keyed by a
 *  `name` field, not a name-keyed object like every JSON registrar above), via the YAML helpers. */
export function createGooseRegistrar(io: RegistrarIO = defaultRegistrarIO): McpRegistrar {
  const id = "goose";
  const label = "Goose";
  const bin = () => io.which("goose");
  const configPath = () => join(io.homedir(), ".config", "goose", "config.yaml");
  const isOurs = () => ownsEntryCommand(io.homedir(), (existing) => (existing as any)?.transport?.command);
  return {
    id,
    label,
    detect: bin,
    async isRegistered() {
      const text = io.readFile(configPath());
      if (!text) return false;
      try {
        const doc = parseDocument(text);
        if (doc.errors.length > 0) return false;
        const seq = doc.get("extensions") as any;
        if (!seq || typeof seq.items === "undefined") return false;
        return seq.items.some((it: any) => it?.get && it.get("name") === "bismuth");
      } catch {
        return false;
      }
    },
    async register(spec) {
      if (!bin()) return { ok: false, warning: `${label} not found on PATH — skipped` };
      const existingText = io.readFile(configPath());
      const entry = {
        name: "bismuth",
        enabled: true,
        transport: { type: "stdio", command: spec.mcpBin, args: [] },
        env: buildEnv(spec),
      };
      const result = upsertYamlExtension(existingText, "bismuth", entry, isOurs());
      if (result.text == null) {
        return { ok: false, warning: result.warning ?? `${label}: could not update config` };
      }
      io.writeFile(configPath(), result.text);
      writeLedgerEntry(io, id, { at: io.now(), method: "config", path: configPath() });
      return { ok: true };
    },
    async unregister() {
      if (!hasLedgerEntry(io, id)) return;
      const existingText = io.readFile(configPath());
      const result = removeYamlExtension(existingText, "bismuth", isOurs());
      if (result.removed && result.text != null) io.writeFile(configPath(), result.text);
      clearLedgerEntry(io, id);
    },
  };
}

/** Every registrar this build knows, in a stable order. A registrar's `id` MAY coincide with a
 *  chat-capable backend id in agentBackends/catalog.ts (e.g. "gemini"), but the two lists are
 *  deliberately independent — this module registers Bismuth's MCP server with a CLI regardless
 *  of whether Bismuth can also drive that CLI as a chat backend (see the header comment). */
export const MCP_REGISTRARS: readonly McpRegistrar[] = [
  createCodexRegistrar(),
  createClineRegistrar(),
  createOpenClawRegistrar(),
  createGeminiRegistrar(),
  createQwenRegistrar(),
  createCopilotRegistrar(),
  createAmpRegistrar(),
  createDroidRegistrar(),
  createCrushRegistrar(),
  createGooseRegistrar(),
];
