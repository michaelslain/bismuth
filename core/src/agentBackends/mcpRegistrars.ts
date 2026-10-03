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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { parseDocument } from 'yaml'
import { whichBinary } from '../claudeWhich'
import { spawnWithTimeout } from './spawnWithTimeout'

/** What the caller wants registered: our compiled MCP binary + the env it needs to find the docs
 *  tree / cli binary / (optionally) a specific vault. Mirrors the env vars bismuthInstall.ts's
 *  registerMcp() already passes to `claude mcp add` for the machine-wide install case. */
export interface BismuthMcpSpec {
    mcpBin: string
    docsDir?: string
    cliBin: string
    vaultRoot?: string
    memoryDir?: string
}

export interface McpRegistrar {
    id: string
    label: string
    /** Resolved binary on PATH, or null. */
    detect(): string | null
    isRegistered(): Promise<boolean>
    register(spec: BismuthMcpSpec): Promise<{ ok: boolean; warning?: string }>
    unregister(): Promise<void>
}

// --- Injectable effectful seam (mirrors bismuthInstall.ts's InstallIO) -----------------------

export interface RegistrarIO {
    which(bin: string): string | null
    /** Spawn `bin args…`, stdin ignored, killed after `timeoutMs`. Never throws — a spawn failure
     *  surfaces as `{code: -1, stderr: <message>}`. */
    run(
        bin: string,
        args: string[],
        timeoutMs?: number,
    ): Promise<{ code: number; stdout: string; stderr: string }>
    readFile(path: string): string | null
    writeFile(path: string, content: string): void
    homedir(): string
    now(): string
}

const DEFAULT_TIMEOUT_MS = 15_000

async function spawnBestEffort(
    bin: string,
    args: string[],
    timeoutMs: number,
): Promise<{ code: number; stdout: string; stderr: string }> {
    const r = await spawnWithTimeout([bin, ...args], timeoutMs, {
        env: process.env,
    })
    return {
        code: r.code ?? -1,
        stdout: r.stdout,
        stderr: r.error ?? r.stderr,
    }
}

/** The real, default IO — does the actual spawn + fs work. */
export const defaultRegistrarIO: RegistrarIO = {
    which: bin => whichBinary(bin),
    run: (bin, args, timeoutMs = DEFAULT_TIMEOUT_MS) =>
        spawnBestEffort(bin, args, timeoutMs),
    readFile: path => {
        try {
            return existsSync(path) ? readFileSync(path, 'utf8') : null
        } catch {
            return null
        }
    },
    writeFile: (path, content) => {
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, content)
    },
    homedir: () => homedir(),
    now: () => new Date().toISOString(),
}

// --- Env the MCP server needs ------------------------------------------------------------------

function buildEnv(spec: BismuthMcpSpec): Record<string, string> {
    const env: Record<string, string> = { BISMUTH_CLI: spec.cliBin }
    if (spec.docsDir) env.BISMUTH_DOCS_DIR = spec.docsDir
    if (spec.vaultRoot) env.BISMUTH_VAULT = spec.vaultRoot
    if (spec.memoryDir) env.BISMUTH_MEMORY_DIR = spec.memoryDir
    return env
}

// --- Pure JSON helpers (unit-testable with plain strings, no fs/subprocess) -------------------

/** Parse JSON leniently: `null` text (file absent) → `{}` (an empty config is fine to build on);
 *  unparseable text → `null`, distinct from "empty", so callers can warn instead of clobbering. */
function parseJsonLenient(text: string | null): Record<string, unknown> | null {
    if (text == null) return {}
    try {
        const v = JSON.parse(text)
        return v && typeof v === 'object' && !Array.isArray(v)
            ? (v as Record<string, unknown>)
            : {}
    } catch {
        return null
    }
}

function getPath(obj: Record<string, unknown>, path: string[]): unknown {
    let cur: unknown = obj
    for (const k of path) {
        if (!cur || typeof cur !== 'object') return undefined
        cur = (cur as Record<string, unknown>)[k]
    }
    return cur
}

/** Parse `text` and walk to `keyPath[name]`. `parsed` is null when the text is not valid JSON;
 *  `container` is the object at `keyPath` (undefined when absent or not an object); `entry` is
 *  `container[name]`. The one parse-then-walk every JSON registrar helper shares. */
function readEntry(
    text: string | null,
    keyPath: string[],
    name: string,
): {
    parsed: Record<string, unknown> | null
    container?: Record<string, unknown>
    entry?: unknown
} {
    const parsed = parseJsonLenient(text)
    if (parsed === null) return { parsed }
    const c = getPath(parsed, keyPath)
    if (!c || typeof c !== 'object') return { parsed }
    const container = c as Record<string, unknown>
    return { parsed, container, entry: container[name] }
}

/** `--env K=V` (or `-e K=V`) once per variable — the flag form Codex, Copilot, Amp, Droid and
 *  Gemini all take on `mcp add`. */
function envFlagArgs(env: Record<string, string>, flag: string): string[] {
    return Object.entries(env).flatMap(([k, v]) => [flag, `${k}=${v}`])
}

/** Best-effort indent detection so a rewritten file doesn't reformat the user's whole config;
 *  defaults to 2 spaces for a brand-new file. */
function detectIndent(text: string | null): string {
    if (!text) return '  '
    const m = text.match(/\n([ \t]+)\S/)
    return m ? m[1] : '  '
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
    const { parsed, entry } = readEntry(existingText, keyPath, name)
    if (!parsed || !entry || typeof entry !== 'object') return { text: null }
    ;(entry as Record<string, unknown>).env = env
    return {
        text: JSON.stringify(parsed, null, detectIndent(existingText)) + '\n',
    }
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
    if (existingText == null) return { text: existingText, removed: false }
    const { parsed, container, entry } = readEntry(existingText, keyPath, name)
    if (!parsed || !container || entry === undefined || !isOurs(entry))
        return { text: existingText, removed: false }
    delete container[name]
    return {
        text: JSON.stringify(parsed, null, detectIndent(existingText)) + '\n',
        removed: true,
    }
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
    const parsed = parseJsonLenient(existingText)
    if (parsed === null)
        return {
            text: null,
            warning: "existing MCP config isn't valid JSON — skipped",
        }
    let cur: Record<string, unknown> = parsed
    for (const k of keyPath) {
        const next = cur[k]
        if (!next || typeof next !== 'object' || Array.isArray(next))
            cur[k] = {}
        cur = cur[k] as Record<string, unknown>
    }
    const existing = cur[name]
    if (existing !== undefined && !isOurs(existing)) {
        return {
            text: null,
            warning: `a "${name}" MCP entry already exists and wasn't created by Bismuth — skipped`,
        }
    }
    cur[name] = entry
    return {
        text: JSON.stringify(parsed, null, detectIndent(existingText)) + '\n',
    }
}

/** Ownership check generalized over where in an entry the `command` field lives — every JSON
 *  registrar keeps it at the top level (`entry.command`), but Goose nests it under
 *  `entry.transport.command`. True when it points into `<home>/.bismuth` — i.e. something we
 *  (a past run of this installer) wrote, not the user's own unrelated config. */
function ownsEntryCommand(
    home: string,
    extractCommand: (existing: unknown) => unknown,
): (existing: unknown) => boolean {
    const prefix = join(home, '.bismuth')
    return existing => {
        if (!existing || typeof existing !== 'object') return false
        const command = extractCommand(existing)
        return typeof command === 'string' && command.startsWith(prefix)
    }
}

/** True when an existing MCP-server JSON entry's `command` points into `<home>/.bismuth` — i.e.
 *  something we (a past run of this installer) wrote, not the user's own unrelated config. */
function ownsCommand(home: string): (existing: unknown) => boolean {
    return ownsEntryCommand(
        home,
        existing => (existing as Record<string, unknown>).command,
    )
}

// --- YAML helpers (Goose's config.yaml `extensions:` LIST — array-of-objects, not a name-keyed
// object, so it needs its own merge shape distinct from the JSON dict helpers above) -----------

/** Get (or lazily create) the `extensions` YAMLSeq node on a parsed Document. */
function extensionsSeq(doc: ReturnType<typeof parseDocument>): any {
    let seq = doc.get('extensions')
    if (!seq || typeof (seq as any).items === 'undefined') {
        doc.set('extensions', [])
        seq = doc.get('extensions')
    }
    return seq
}

/** Parse a YAML config and find its `extensions:` list. Null when the text isn't valid YAML;
 *  `seq` is undefined when there is no list yet. */
function loadYamlExtensions(
    text: string,
): { doc: ReturnType<typeof parseDocument>; seq?: any } | null {
    let doc: ReturnType<typeof parseDocument>
    try {
        doc = parseDocument(text)
    } catch {
        return null
    }
    if (doc.errors.length > 0) return null
    const seq = doc.get('extensions') as any
    return {
        doc,
        seq: seq && typeof seq.items !== 'undefined' ? seq : undefined,
    }
}

/** Index of the list item whose `name` field is `name`, or -1. */
function findExtensionIndex(seq: any, name: string): number {
    return seq.items.findIndex((it: any) => it?.get && it.get('name') === name)
}

function stringifyYamlDoc(doc: ReturnType<typeof parseDocument>): string {
    let out = doc.toString({ flowCollectionPadding: false })
    if (!out.endsWith('\n')) out += '\n'
    return out
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
    const loaded = loadYamlExtensions(existingText ?? '')
    if (!loaded)
        return {
            text: null,
            warning: "existing config isn't valid YAML — skipped",
        }
    const { doc } = loaded
    const seq = extensionsSeq(doc)
    const idx = findExtensionIndex(seq, name)
    if (idx >= 0) {
        // NOTE: seq.get(idx) returns the raw Map NODE for a non-scalar item (only scalars get
        // unwrapped) — .toJSON() is what actually converts it to a plain JS object isOurs() can
        // introspect; passing the node itself would make every `?.` chain in isOurs() silently
        // resolve to undefined.
        const existingJson = seq.items[idx].toJSON()
        if (!isOurs(existingJson)) {
            return {
                text: null,
                warning: `a "${name}" extension already exists and wasn't created by Bismuth — skipped`,
            }
        }
        seq.set(idx, doc.createNode(entry))
    } else {
        seq.add(doc.createNode(entry))
    }
    return { text: stringifyYamlDoc(doc) }
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
    if (existingText == null) return { text: existingText, removed: false }
    const loaded = loadYamlExtensions(existingText)
    if (!loaded?.seq) return { text: existingText, removed: false }
    const { doc, seq } = loaded
    const idx = findExtensionIndex(seq, name)
    if (idx < 0) return { text: existingText, removed: false }
    const existingJson = seq.items[idx].toJSON()
    if (!isOurs(existingJson)) return { text: existingText, removed: false }
    seq.delete(idx)
    return { text: stringifyYamlDoc(doc), removed: true }
}

// --- Registrations ledger (~/.bismuth/.mcp-registrations.json) --------------------------------

export interface McpLedgerEntry {
    at: string
    method: 'cli' | 'config'
    path?: string
}

function ledgerPath(io: RegistrarIO): string {
    return join(io.homedir(), '.bismuth', '.mcp-registrations.json')
}

function readLedger(io: RegistrarIO): Record<string, McpLedgerEntry> {
    const text = io.readFile(ledgerPath(io))
    if (!text) return {}
    try {
        const v = JSON.parse(text)
        return v && typeof v === 'object'
            ? (v as Record<string, McpLedgerEntry>)
            : {}
    } catch {
        return {}
    }
}

function writeLedgerEntry(
    io: RegistrarIO,
    id: string,
    entry: McpLedgerEntry,
): void {
    const ledger = readLedger(io)
    ledger[id] = entry
    io.writeFile(ledgerPath(io), JSON.stringify(ledger, null, 2) + '\n')
}

function clearLedgerEntry(io: RegistrarIO, id: string): void {
    const ledger = readLedger(io)
    if (!(id in ledger)) return
    delete ledger[id]
    io.writeFile(ledgerPath(io), JSON.stringify(ledger, null, 2) + '\n')
}

/** Did WE register this id, per our own ledger? This is the authoritative "did Bismuth do this"
 *  signal `unregister()` gates on — most importantly for Codex, where the config is TOML we never
 *  read, so there is no other way to avoid removing a "bismuth"-named entry the user created
 *  themselves for something unrelated to this installer. */
function hasLedgerEntry(io: RegistrarIO, id: string): boolean {
    return id in readLedger(io)
}

// --- Per-CLI registrars -------------------------------------------------------------------------

/** OpenAI Codex CLI. TOML config — never hand-edited; every op goes through `codex mcp …`. */
export function createCodexRegistrar(
    io: RegistrarIO = defaultRegistrarIO,
): McpRegistrar {
    const id = 'codex'
    const label = 'Codex CLI'
    const bin = () => io.which('codex')
    return {
        id,
        label,
        detect: bin,
        async isRegistered() {
            const codex = bin()
            if (!codex) return false
            const r = await io.run(codex, ['mcp', 'list'])
            // Match a server NAMED bismuth: the first column of a row, never a substring (a
            // `bismuth-notes` server, or any path under ~/.bismuth, must not read as registered).
            return (
                r.code === 0 &&
                r.stdout
                    .split('\n')
                    .some(line => line.trim().split(/\s+/)[0] === 'bismuth')
            )
        },
        async register(spec) {
            const codex = bin()
            if (!codex)
                return {
                    ok: false,
                    warning: `${label} not found on PATH — skipped`,
                }
            const args = [
                'mcp',
                'add',
                'bismuth',
                ...envFlagArgs(buildEnv(spec), '--env'),
                '--',
                spec.mcpBin,
            ]
            const r = await io.run(codex, args)
            if (r.code !== 0) {
                return {
                    ok: false,
                    warning: `codex mcp add failed: ${(r.stderr || r.stdout).trim() || `exit ${r.code}`}`,
                }
            }
            writeLedgerEntry(io, id, { at: io.now(), method: 'cli' })
            return { ok: true }
        },
        async unregister() {
            // Gate on our own ledger, not just "codex is on PATH": Codex's config is TOML, which we
            // never read (rule: never hand-edit TOML), so the ledger is the ONLY way to know whether a
            // "bismuth" entry in the user's config is one we created vs. something of their own that
            // happens to share the name — removing blind would risk clobbering the latter.
            if (!hasLedgerEntry(io, id)) return
            const codex = bin()
            // No verified `codex mcp remove` in the research this was built from (only add/list/login
            // were confirmed) — attempt the conventional sibling verb best-effort (spawnBestEffort never
            // throws) regardless of the subprocess result.
            if (codex) await io.run(codex, ['mcp', 'remove', 'bismuth'])
            clearLedgerEntry(io, id)
        },
    }
}

/** Everything the `mcp add`-style registrars (Cline, OpenClaw, Gemini, Qwen, Copilot, Amp, Droid)
 *  share: resolve the binary, read + leniently parse the config, refuse a foreign `bismuth` entry,
 *  run the add argv, optionally post-process (`postAdd`), write the ledger — and, to unregister,
 *  either the CLI's remove verb or a direct edit of the config file. What differs per CLI is
 *  passed in rather than hardcoded. */
type McpAddConfig = {
    id: string
    label: string
    binaryName: string
    configPathParts: string[]
    /** Where the name-keyed server entries live (Amp's is one literal dotted segment, not two). */
    mcpServersPath: string[]
    /** Noun in the "isn't valid JSON" warning ("MCP config", "config"). */
    configNoun: string
    /** The CLI verb that adds, used only in the failure warning (`mcp add` / OpenClaw's `mcp set`). */
    addVerb?: string
    buildAddArgs: (
        spec: BismuthMcpSpec,
        env: Record<string, string>,
    ) => string[]
    /** Runs after a successful add; a returned string becomes the register() warning. */
    postAdd?: (ctx: {
        io: RegistrarIO
        env: Record<string, string>
        configPath: string
        keyPath: string[]
        binaryName: string
    }) => string | undefined
    /** How unregister() removes the entry: the CLI's verb (default `remove`) or by editing the
     *  config file, for a CLI with no scriptable removal. */
    removal?: 'edit-file' | { verb: string }
}

/** `postAdd` for a CLI whose `mcp add` has no env flag: patch just the env block onto the entry
 *  the CLI wrote. */
const patchEnvAfterAdd: NonNullable<McpAddConfig['postAdd']> = ({
    io,
    env,
    configPath,
    keyPath,
    binaryName,
}) => {
    const patched = patchJsonMcpServerEnv(
        io.readFile(configPath),
        keyPath,
        'bismuth',
        env,
    )
    if (patched.text != null) {
        io.writeFile(configPath, patched.text)
        return undefined
    }
    return `${binaryName} mcp add succeeded but its env block could not be patched in`
}

function createMcpAddRegistrar(
    cfg: McpAddConfig,
    io: RegistrarIO,
): McpRegistrar {
    const { id, label, binaryName, mcpServersPath } = cfg
    const bin = () => io.which(binaryName)
    const configPath = () => join(io.homedir(), ...cfg.configPathParts)
    const isOurs = () => ownsCommand(io.homedir())
    return {
        id,
        label,
        detect: bin,
        async isRegistered() {
            const { entry } = readEntry(
                io.readFile(configPath()),
                mcpServersPath,
                'bismuth',
            )
            return entry !== undefined
        },
        async register(spec) {
            const cli = bin()
            if (!cli)
                return {
                    ok: false,
                    warning: `${label} not found on PATH — skipped`,
                }
            const { parsed, entry } = readEntry(
                io.readFile(configPath()),
                mcpServersPath,
                'bismuth',
            )
            if (parsed === null) {
                return {
                    ok: false,
                    warning: `${label}: existing ${cfg.configNoun} isn't valid JSON — skipped`,
                }
            }
            if (entry !== undefined && !isOurs()(entry)) {
                return {
                    ok: false,
                    warning: `${label} already has a "bismuth" MCP entry Bismuth didn't create — skipped`,
                }
            }
            const env = buildEnv(spec)
            const r = await io.run(cli, cfg.buildAddArgs(spec, env))
            if (r.code !== 0) {
                return {
                    ok: false,
                    warning: `${binaryName} mcp ${cfg.addVerb ?? 'add'} failed: ${(r.stderr || r.stdout).trim() || `exit ${r.code}`}`,
                }
            }
            const warning = cfg.postAdd?.({
                io,
                env,
                configPath: configPath(),
                keyPath: mcpServersPath,
                binaryName,
            })
            writeLedgerEntry(io, id, {
                at: io.now(),
                method: 'cli',
                path: configPath(),
            })
            return warning ? { ok: true, warning } : { ok: true }
        },
        async unregister() {
            // Gate on our own ledger: neither the CLIs' remove verbs nor a blind file edit know whether
            // a "bismuth" entry is ours, so never touch one we did not register.
            if (!hasLedgerEntry(io, id)) return
            if (cfg.removal === 'edit-file') {
                const result = removeJsonMcpServer(
                    io.readFile(configPath()),
                    mcpServersPath,
                    'bismuth',
                    isOurs(),
                )
                if (result.removed && result.text != null)
                    io.writeFile(configPath(), result.text)
            } else {
                const cli = bin()
                if (cli)
                    await io.run(cli, [
                        'mcp',
                        cfg.removal?.verb ?? 'remove',
                        'bismuth',
                    ])
            }
            clearLedgerEntry(io, id)
        },
    }
}

/** Cline. No --env on `cline mcp add` (verified from the compiled binary's own option table) — a
 *  two-step register: CLI add, then patch the env block into the file ourselves. No verified
 *  remove subcommand either, so unregister() edits the file directly. */
export function createClineRegistrar(
    io: RegistrarIO = defaultRegistrarIO,
): McpRegistrar {
    return createMcpAddRegistrar(
        {
            id: 'cline',
            label: 'Cline',
            binaryName: 'cline',
            configPathParts: [
                '.cline',
                'data',
                'settings',
                'cline_mcp_settings.json',
            ],
            mcpServersPath: ['mcpServers'],
            configNoun: 'MCP config',
            buildAddArgs: spec => [
                'mcp',
                'add',
                'bismuth',
                '--transport',
                'stdio',
                '--yes',
                '--',
                spec.mcpBin,
            ],
            postAdd: patchEnvAfterAdd,
            removal: 'edit-file',
        },
        io,
    )
}

/** OpenClaw. `mcp set` is a single-shot JSON payload (command+args+env all at once) — the
 *  cleanest of the five — stored under `mcp.servers.<name>`, NOT top-level `mcpServers`.
 *  `openclaw mcp unset` is its removal verb. */
export function createOpenClawRegistrar(
    io: RegistrarIO = defaultRegistrarIO,
): McpRegistrar {
    return createMcpAddRegistrar(
        {
            id: 'openclaw',
            label: 'OpenClaw',
            binaryName: 'openclaw',
            configPathParts: ['.openclaw', 'openclaw.json'],
            mcpServersPath: ['mcp', 'servers'],
            configNoun: 'config',
            addVerb: 'set',
            buildAddArgs: (spec, env) => [
                'mcp',
                'set',
                'bismuth',
                JSON.stringify({ command: spec.mcpBin, args: [], env }),
            ],
            removal: { verb: 'unset' },
        },
        io,
    )
}

/** The Gemini-CLI family (Gemini CLI + its Qwen Code fork): same `mcpServers` shape, config at
 *  `~/.<dotDir>/settings.json`, `mcp add/remove` CLI verbs. `supportsEnvFlag` distinguishes Gemini
 *  (verified `-e K=V` on `mcp add`) from Qwen (not shown in its own `mcp add` flag list, despite an
 *  otherwise-identical config shape) — Qwen gets the same two-step add-then-patch treatment as
 *  Cline rather than an assumed flag. */
function createGeminiFamilyRegistrar(
    id: string,
    label: string,
    binaryName: string,
    dotDir: string,
    supportsEnvFlag: boolean,
    io: RegistrarIO,
): McpRegistrar {
    return createMcpAddRegistrar(
        {
            id,
            label,
            binaryName,
            configPathParts: [dotDir, 'settings.json'],
            mcpServersPath: ['mcpServers'],
            configNoun: 'config',
            buildAddArgs: (spec, env) => [
                'mcp',
                'add',
                'bismuth',
                spec.mcpBin,
                ...(supportsEnvFlag ? envFlagArgs(env, '-e') : []),
                '--scope',
                'user',
            ],
            postAdd: supportsEnvFlag ? undefined : patchEnvAfterAdd,
        },
        io,
    )
}

export function createGeminiRegistrar(
    io: RegistrarIO = defaultRegistrarIO,
): McpRegistrar {
    return createGeminiFamilyRegistrar(
        'gemini',
        'Gemini CLI',
        'gemini',
        '.gemini',
        true,
        io,
    )
}

export function createQwenRegistrar(
    io: RegistrarIO = defaultRegistrarIO,
): McpRegistrar {
    return createGeminiFamilyRegistrar(
        'qwen',
        'Qwen Code',
        'qwen',
        '.qwen',
        false,
        io,
    )
}

/** GitHub Copilot CLI. Verified `copilot mcp add <name> --env K=V -- <cmd>` (+ list/get/remove) —
 *  the cleanest of the batch-3 additions, config at ~/.copilot/mcp-config.json `mcpServers`. */
export function createCopilotRegistrar(
    io: RegistrarIO = defaultRegistrarIO,
): McpRegistrar {
    return createMcpAddRegistrar(
        {
            id: 'copilot',
            label: 'GitHub Copilot CLI',
            binaryName: 'copilot',
            configPathParts: ['.copilot', 'mcp-config.json'],
            mcpServersPath: ['mcpServers'],
            configNoun: 'MCP config',
            buildAddArgs: (spec, env) => [
                'mcp',
                'add',
                'bismuth',
                ...envFlagArgs(env, '--env'),
                '--',
                spec.mcpBin,
            ],
        },
        io,
    )
}

/** Sourcegraph Amp. Verified `amp mcp add <name> --env K=V -- <cmd>` (+ list --json/remove) live
 *  in `--help`. Config at ~/.config/amp/settings.json, under the LITERAL (dotted) top-level key
 *  `"amp.mcpServers"` — NOT a nested `amp: {mcpServers}` object, so the key PATH here is a single
 *  one-element segment containing a dot, not two segments. */
export function createAmpRegistrar(
    io: RegistrarIO = defaultRegistrarIO,
): McpRegistrar {
    return createMcpAddRegistrar(
        {
            id: 'amp',
            label: 'Amp',
            binaryName: 'amp',
            configPathParts: ['.config', 'amp', 'settings.json'],
            mcpServersPath: ['amp.mcpServers'], // one literal key, not ["amp", "mcpServers"]
            configNoun: 'config',
            buildAddArgs: (spec, env) => [
                'mcp',
                'add',
                'bismuth',
                ...envFlagArgs(env, '--env'),
                '--',
                spec.mcpBin,
            ],
        },
        io,
    )
}

/** Factory AI Droid. Verified `droid mcp add <name> "<cmd>" --env K=V` (+ list/remove) against
 *  the official MCP configuration doc. Config at ~/.factory/mcp.json `mcpServers` (standard
 *  shape). Note the command is a single positional STRING, not a `-- cmd` split like the others. */
export function createDroidRegistrar(
    io: RegistrarIO = defaultRegistrarIO,
): McpRegistrar {
    return createMcpAddRegistrar(
        {
            id: 'droid',
            label: 'Droid',
            binaryName: 'droid',
            configPathParts: ['.factory', 'mcp.json'],
            mcpServersPath: ['mcpServers'],
            configNoun: 'MCP config',
            buildAddArgs: (spec, env) => [
                'mcp',
                'add',
                'bismuth',
                spec.mcpBin,
                ...envFlagArgs(env, '--env'),
            ],
        },
        io,
    )
}

/** Charm Crush. NO `crush mcp add` subcommand exists (confirmed absent from the CLI usage
 *  reference) — registration writes the WHOLE entry directly into ~/.config/crush/crush.json's
 *  `mcp.<name>` (verified verbatim shape from the project README): `{type, command, args, env}`.
 *  Never spawns `crush` at all — the binary only needs to be ON PATH for us to consider Crush
 *  "present enough to register with" (mirrors the "detected" gate every other registrar uses). */
export function createCrushRegistrar(
    io: RegistrarIO = defaultRegistrarIO,
): McpRegistrar {
    const id = 'crush'
    const label = 'Crush'
    const bin = () => io.which('crush')
    const configPath = () =>
        join(io.homedir(), '.config', 'crush', 'crush.json')
    const isOurs = () => ownsCommand(io.homedir())
    return {
        id,
        label,
        detect: bin,
        async isRegistered() {
            return (
                readEntry(io.readFile(configPath()), ['mcp'], 'bismuth')
                    .entry !== undefined
            )
        },
        async register(spec) {
            if (!bin())
                return {
                    ok: false,
                    warning: `${label} not found on PATH — skipped`,
                }
            const existingText = io.readFile(configPath())
            const entry = {
                type: 'stdio',
                command: spec.mcpBin,
                args: [],
                env: buildEnv(spec),
            }
            const result = upsertJsonMcpServer(
                existingText,
                ['mcp'],
                'bismuth',
                entry,
                isOurs(),
            )
            if (result.text == null) {
                return {
                    ok: false,
                    warning:
                        result.warning ?? `${label}: could not update config`,
                }
            }
            io.writeFile(configPath(), result.text)
            writeLedgerEntry(io, id, {
                at: io.now(),
                method: 'config',
                path: configPath(),
            })
            return { ok: true }
        },
        async unregister() {
            if (!hasLedgerEntry(io, id)) return
            const existingText = io.readFile(configPath())
            const result = removeJsonMcpServer(
                existingText,
                ['mcp'],
                'bismuth',
                isOurs(),
            )
            if (result.removed && result.text != null)
                io.writeFile(configPath(), result.text)
            clearLedgerEntry(io, id)
        },
    }
}

/** Block/AAIF Goose. Same situation as Crush — no non-interactive `goose extension add`
 *  one-liner exists (only the interactive `goose configure` wizard) — registration writes
 *  directly into ~/.config/goose/config.yaml's `extensions:` LIST (array-of-objects keyed by a
 *  `name` field, not a name-keyed object like every JSON registrar above), via the YAML helpers. */
export function createGooseRegistrar(
    io: RegistrarIO = defaultRegistrarIO,
): McpRegistrar {
    const id = 'goose'
    const label = 'Goose'
    const bin = () => io.which('goose')
    const configPath = () =>
        join(io.homedir(), '.config', 'goose', 'config.yaml')
    const isOurs = () =>
        ownsEntryCommand(
            io.homedir(),
            existing => (existing as any)?.transport?.command,
        )
    return {
        id,
        label,
        detect: bin,
        async isRegistered() {
            const text = io.readFile(configPath())
            if (!text) return false
            const loaded = loadYamlExtensions(text)
            return (
                !!loaded?.seq && findExtensionIndex(loaded.seq, 'bismuth') >= 0
            )
        },
        async register(spec) {
            if (!bin())
                return {
                    ok: false,
                    warning: `${label} not found on PATH — skipped`,
                }
            const existingText = io.readFile(configPath())
            const entry = {
                name: 'bismuth',
                enabled: true,
                transport: { type: 'stdio', command: spec.mcpBin, args: [] },
                env: buildEnv(spec),
            }
            const result = upsertYamlExtension(
                existingText,
                'bismuth',
                entry,
                isOurs(),
            )
            if (result.text == null) {
                return {
                    ok: false,
                    warning:
                        result.warning ?? `${label}: could not update config`,
                }
            }
            io.writeFile(configPath(), result.text)
            writeLedgerEntry(io, id, {
                at: io.now(),
                method: 'config',
                path: configPath(),
            })
            return { ok: true }
        },
        async unregister() {
            if (!hasLedgerEntry(io, id)) return
            const existingText = io.readFile(configPath())
            const result = removeYamlExtension(
                existingText,
                'bismuth',
                isOurs(),
            )
            if (result.removed && result.text != null)
                io.writeFile(configPath(), result.text)
            clearLedgerEntry(io, id)
        },
    }
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
]
