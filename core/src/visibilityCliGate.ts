// core/src/visibilityCliGate.ts
// The visibility gate for the `bismuth` CLI itself — the same binary is BOTH the vault owner's own
// hand (where visibility deliberately does NOT apply — see docs/vault/visibility.md's threat model)
// and, when Bismuth spawns an agent, that agent's hand too (where it must). Two trust boundaries,
// two entry points into this file:
//
//  - `gateCliArgs` — the MCP path (mcp/src/cli.ts spawns the CLI as a subprocess of the
//    `bismuth_cli` MCP tool). Channel comes from `BISMUTH_MCP_CHANNEL`; unset/unrecognized
//    defaults to "daemon" (every MCP session is SOME agent, so the safe default is the stricter
//    channel).
//  - `gateCliInvocation` — the CLI's OWN single dispatch point (cli/src/index.ts), so an agent that
//    runs `bismuth` directly in a shell — no MCP layer at all — is gated too. Channel comes from
//    `BISMUTH_AGENT_CHANNEL` first, else `BISMUTH_MCP_CHANNEL` (an MCP-spawned CLI gates as an
//    agent too); only when NEITHER is set does "unset" mean something different on purpose: it is
//    the OWNER's own hand (their interactive shell, a dev script, CI…), so it is allowed through
//    with NO gate at all. Every place Bismuth itself spawns an agent (core/src/chat.ts, the daemon
//    session, the codex/ACP chat drivers) stamps BISMUTH_AGENT_CHANNEL explicitly; an unstamped invocation is, by
//    construction, not one of those. Getting this backwards in either direction is the whole risk:
//    default it to "gate" and the owner is locked out of their own CLI; default it to "no gate" and
//    every agent is ungated.
//
// Scope notes (second pass): protected paths (`.settings`, `.daemon/processes`, the `.daemon` folder
// itself) are refused for EVERY non-always-safe command, restricted vault or not. HTTP-routed
// commands (api, chat, gcal, relay, update) are gated against EVERY running core's vault, because
// `call()` sends the owner token to whichever registered core it reaches. `bismuth api` is
// GET-only for agents (cli/src/commands/api.ts). Folder tokens are resolved through `..`, `//`,
// symlinks and case (`realpathLoose`) and skipped by argv position, never by value.
//
// The hole this half closes: `bismuth read Private/secret.md` (or, worse, `bismuth api GET
// '/file?path=Private/secret.md'`) returns a hidden note's contents verbatim when run as a Bash
// subprocess — a calling convention `disallowedTools: ["mcp__bismuth__bismuth_cli"]` cannot touch,
// because that SDK setting only blocks the MCP *tool*, not the same binary invoked as a plain
// subprocess, and Bash is deliberately never disallowed (the daemon needs `bismuth checkpoint`).
//
// Design notes (unchanged from this file's original spike — restated because they explain choices
// a "simplify this" pass might otherwise undo):
//  - FAIL-SAFE by default. An unset/garbled channel resolves to "daemon", the STRICTER of the two
//    (it also excludes `chat-only`) — except `BISMUTH_AGENT_CHANNEL` specifically, where absent
//    means "owner", per the threat model above. An unreadable vault, a bad settings file, or any
//    thrown error REFUSES rather than allows: this gate exists precisely for the cases where
//    something is off.
//  - OVER-INCLUSIVE on purpose. It refuses when a restricted path appears ANYWHERE in the argv, as a
//    substring, rather than trying to know which positional each CLI command treats as a path. A
//    false refusal costs an agent one tool call and says exactly why; a false ALLOW leaks a note.
//  - Commands that list or aggregate vault content (`tree`, `graph`, `search`, `rows`, `task`, …)
//    are NOT refused any more: they run, and filter THEIR OWN output per file through
//    core/src/visibilityFilter.ts (`agentDenyEntries` + `filterByPath` & co.), dropping restricted
//    notes at the list's source, before any count or summary. This gate's part for that tier is the
//    argv path scan only. Only commands that cannot be filtered per file (`api`, `serve`, `export`,
//    `checkpoint diff`, `chat`, `settings status-bar`, `update`, anything unclassified) still refuse
//    wholesale whenever anything is restricted — a per-file deny cannot stop an unscoped passthrough
//    from returning a hidden file's lines (docs/vault/visibility.md disables Grep/Glob outright for
//    exactly this reason).
//  - EVERY candidate root is gated, not one picked by precedence: `--dir`, `--vault` and
//    `BISMUTH_VAULT` (each distinct value) each get their own deny list and the first refusal wins.
//    Commands disagree on which flag they read, and the old `--dir ?? --vault ?? env` let
//    `read Private/secret.md --vault V --dir <empty>` check the empty dir and run on V. An agent
//    that knows its own cwd (the daemon's Bash tool never gets `BISMUTH_VAULT` in its env) passes
//    `--vault`/`--dir` explicitly, so env alone would be a no-op for exactly that shape.
//  - A root that is a SUBFOLDER of a vault (the root holds no `.settings`/`settings.yaml`, an
//    ancestor does) refuses: `folderVisibility` is read from `<root>/.settings` only, so addressing
//    the vault by a subfolder would silently drop every folder rule. `<vault>/.daemon/memory` is
//    exempt (memory notes ignore the folder cascade by design). Skipped for the always-safe tier.
//  - AGENT_PROTECTED_PATHS (`.settings`, `settings.yaml`, `.daemon/processes`) are off-limits to
//    path-taking commands even in a vault that restricts nothing: the first is the rule file, the
//    last is code the daemon spawns outside any sandbox. Mutating `settings`/`folder-visibility`
//    commands refuse when anything is restricted, for the same reason.
//  - Every argv candidate is also checked with `.md` appended (`base create Private/secret` writes
//    `Private/secret.md` after this gate saw the extensionless token), and for the path-scoped tier a
//    FOLDER token is refused when it is an ancestor of a restricted file or itself/its parent is a
//    restricted folder (`move "Vault Hidden" Pub`, `delete "Vault Hidden"`).
//  - Channel is the strictest of both env signals (see {@link gateChannel}).
import { existsSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { realpathLoose } from './realPath'
import { readRunRecords } from './runRegistry'
import {
    buildDenyPaths,
    findDeniedEntry,
    isVisibleToChat,
    isVisibleToDaemon,
    normalizeForCompare,
    resolveFolderVisibility,
    type DenyEntry,
    type VisibilityChannel,
} from './visibility'
import {
    LEGACY_SETTINGS_FILE,
    SETTINGS_FILE,
    readFolderVisibilityResult,
} from './settings'

/** Which channel this MCP server is serving, from `BISMUTH_MCP_CHANNEL`.
 *
 *  Defaults to "daemon" — the stricter channel — when unset or unrecognized, so a spawner that
 *  forgets to declare itself gets the safe answer rather than the permissive one. Bismuth's own
 *  spawners set it explicitly (the daemon session, and each chat driver that injects an MCP server). */
export function mcpChannel(
    env: Record<string, string | undefined> = process.env,
): VisibilityChannel {
    return env.BISMUTH_MCP_CHANNEL === 'chat' ? 'chat' : 'daemon'
}

/**
 * Who is invoking the CLI directly, from `BISMUTH_AGENT_CHANNEL`.
 *
 * ABSENT is not a default to the stricter channel — this is the one gate signal in this codebase
 * where "unset" must mean the OWNER'S OWN HAND, never an agent: the same `bismuth` binary is the
 * vault owner's interactive tool (their shell, dev scripts, CI, a plain terminal Claude Code
 * session), where visibility must not apply at all. Every place Bismuth itself SPAWNS an agent
 * stamps this var explicitly before that agent can reach a shell; an unstamped invocation is,
 * by construction, the owner's.
 *
 * A garbled non-empty value (typo, a future channel this build doesn't know) is NOT treated as
 * "absent" — it falls through to the stricter "daemon" channel rather than "owner", so a corrupted
 * signal fails safe instead of silently degrading to no gate at all.
 */
export function cliAgentChannel(
    env: Record<string, string | undefined> = process.env,
): VisibilityChannel | 'owner' {
    const raw = env.BISMUTH_AGENT_CHANNEL
    // EMPTY counts as absent, not as a garbled agent value. `export BISMUTH_AGENT_CHANNEL=` and shells
    // that propagate empty vars are ordinary in a human's environment, and Bismuth itself never writes
    // an empty value — it always stamps "chat" or "daemon" explicitly. So an empty value can only have
    // come from the OWNER's own shell, and treating it as an agent locked them out of their own CLI
    // (found by the acceptance run). Nothing is lost by being lenient here: this signal is an honesty
    // boundary, and an agent that could set the var to "" could equally `unset` it — the layer that
    // actually ENFORCES against a determined process is the OS sandbox wrapper, not this env var.
    if (raw === undefined || raw.trim() === '') return 'owner'
    return raw === 'chat' ? 'chat' : 'daemon'
}

/** True when this process is an agent's hand: Bismuth stamped it with an agent channel
 *  (`BISMUTH_AGENT_CHANNEL`, any value but owner) or the MCP server spawned it
 *  (`BISMUTH_MCP_CHANNEL`). One definition for every owner-only CLI guard. */
export function cliIsAgentHand(
    env: Record<string, string | undefined> = process.env,
): boolean {
    return cliAgentChannel(env) !== 'owner' || !!env.BISMUTH_MCP_CHANNEL
}

/**
 * The ONE channel derivation, strictest of both signals. `BISMUTH_AGENT_CHANNEL` (non-empty) and
 * `BISMUTH_MCP_CHANNEL` (set) each name a channel (`chat`, or `daemon` for anything else, garbled
 * included); with both set the result is `chat` only when BOTH say chat. Neither set returns
 * `fallback` — null for the CLI's own gate (the owner, ungated), 'daemon' for the MCP path (every
 * MCP session is SOME agent). Parity: the MCP gate and the CLI gate give the same answer for the
 * same env. `agentChannel` in visibilityFilter.ts is this same derivation.
 */
export function gateChannel(
    env: Record<string, string | undefined>,
    fallback: VisibilityChannel | null,
): VisibilityChannel | null {
    const own = cliAgentChannel(env)
    const viaMcp = env.BISMUTH_MCP_CHANNEL ? mcpChannel(env) : null
    if (own === 'owner') return viaMcp ?? fallback
    if (viaMcp === null) return own
    return own === 'chat' && viaMcp === 'chat' ? 'chat' : 'daemon'
}

/** The channel the CLI gates (and filters) as, or null for the owner's own hand (neither var set).
 *  See {@link gateChannel}. */
export function cliGateChannel(
    env: Record<string, string | undefined> = process.env,
): VisibilityChannel | null {
    return gateChannel(env, null)
}

/**
 * Command classification, as an ALLOWLIST with a refuse-by-default tail.
 *
 * This started as a denylist of "content-scanning commands" and that was the wrong shape. A
 * red-team pass found the misses immediately: `rows`, `card all|due|note`, `task list`,
 * `calendar`, `graph`, `tree`, and most sharply **`checkpoint diff`** — a git diff, i.e. the full
 * plaintext of every changed hidden note, on a command the daemon's PATH shim exists to make
 * reachable. A denylist is only ever as good as the author's imagination, and it silently fails
 * open for every command added to the CLI afterwards.
 *
 * So: four tiers, and anything unclassified REFUSES. Re-checked against the CLI's full `--help`
 * enumeration (every command group under cli/src/commands/) rather than the partial list this
 * gate started from — see the per-command reasoning below.
 */

/**
 * Tier A — cannot surface vault note content at all, so allowed even in a restricted vault.
 * Machine/app/daemon plumbing and settings writes. Keep this list boring and short: every addition
 * is a promise that the command can never echo a note's body.
 *
 * `page` is here deliberately: daemon inbox pages (core/src/daemonPages.ts, `<vault>/.daemon/pages`)
 * are the daemon/MCP's OWN authored notifications, not vault note content — `page list`'s body/title
 * fields are whatever the daemon wrote when it created the page, never a vault note pulled in by
 * reference.
 *
 * `folder-visibility` is deliberately NOT here either (it was): it rewrites the very rules this gate
 * enforces, so an agent could `folder-visibility "Vault Hidden" --clear` and read the folder next
 * call. It falls to the refuse tail (a group-level entry — it has no subcommands). `settings` is
 * here only for its read-only subcommands; the mutating ones are COMPOUND_OVERRIDES.
 *
 * `serve` is deliberately NOT here (it was in an earlier revision of this list): `bismuth serve`
 * spins up ANOTHER unauthenticated copy of the core HTTP API (`GET /file`, `POST /search`, `POST
 * /rows`, …, none of which check visibility on their own — see docs/vault/visibility.md), which an
 * agent could then `curl` from the very same shell — a strictly worse ambient-oracle bypass than
 * anything a `bismuth` subcommand returns directly. Nothing in chat.ts/session.ts ever shells out to
 * `bismuth serve` (grepped), so refusing it under a restricted vault does not brick any real flow.
 */
const ALWAYS_SAFE_COMMANDS = new Set([
    'backends',
    // `doctor` prints machine findings and applies repairs, never a note body. Its one vault-shaped
    // leak (finding ids carry note paths) and its destructive repairs are handled by the command
    // itself in agent mode (cli/src/commands/doctor.ts `doctorAgentOptions`), not by refusing here.
    'doctor',
    // `docs` reads Bismuth's own product docs (the same pages the ungated bismuth_docs_* MCP tools
    // serve), never vault content.
    'docs',
    'install',
    'uninstall',
    'app',
    'daemon',
    'agent-graph',
    'folder-icon',
    'settings',
    'backup',
    'page',
    // `memory` (remember/recall/forget) filters recall by each memory note's own visibility, and its
    // writes refuse to overwrite a hidden memory note by name (they protect themselves).
    'memory',
])

/** Tier B — takes an explicit path, and returns only that path's content. Allowed subject to the
 *  argv path check below, which is what makes them safe. */
const PATH_SCOPED_COMMANDS = new Set([
    'read',
    'write',
    'move',
    'delete',
    'restore',
    'mkdir',
    'prop',
    'render',
])

/** Tier B2 — lists, searches or aggregates vault content, so it cannot be judged from argv alone,
 *  but each command filters its OWN output through core/src/visibilityFilter.ts (restricted notes are
 *  dropped from the list BEFORE any count, group or summary). Allowed subject to the same argv path
 *  scan as Tier B, which still refuses an explicit restricted path.
 *
 *  Adding a command here is a promise that it calls `agentDenyEntries(vault)` and filters at the
 *  source; a command that does not belongs in the refuse tail instead. */
const FILTERED_COMMANDS = new Set([
    'tree',
    'templates',
    'graph',
    'search',
    'replace',
    'rows',
    'row',
    'base',
    'task',
    'card',
    'calendar',
    'gcal',
    'relay',
    'note',
    'daily',
])

/**
 * Compound-command overrides, checked before the group's first-token tier. Needed only where a
 * group's OWN subcommands disagree with each other on content risk — widening the whole group's
 * tier would be wrong in one direction or the other:
 *
 *  - `checkpoint diff` is a `git diff` — i.e. the full plaintext of every changed hidden note — so
 *    it stays in the refuse-by-default tail (bare `checkpoint`, or any subcommand this build
 *    doesn't recognize, is NOT in this map and so REFUSES, which is what we want).
 *  - `checkpoint advance`/`checkpoint ref` touch only a git-ref pointer (a SHA, or nothing) and
 *    print no note content — the daemon's own crons legitimately call these (Feature #51
 *    change-scoping), and refusing them would brick that in any restricted vault.
 */
const COMPOUND_OVERRIDES: Record<string, CommandTier> = {
    'checkpoint advance': 'always-safe',
    'checkpoint ref': 'always-safe',
    // The status bar preview can count notes by a `query` filter, which leaks counts of hidden notes.
    'settings status-bar': 'refuse-when-restricted',
    // Rewriting `.settings` rewrites the visibility rules themselves (`settings set folderVisibility
    // '{}'`). `settings get`/`schema`/`deny-list` stay always-safe. `unset` is not a subcommand
    // today; classified so a future one cannot arrive as an unlocked rule editor.
    'settings set': 'refuse-when-restricted',
    'settings unset': 'refuse-when-restricted',
    // Group-level: `folder-visibility` has no subcommands, so it is classified by `commandTier`'s
    // first-token fallthrough (it is in no allow set) and pinned here for the reader.
    'folder-visibility': 'refuse-when-restricted',
}

/**
 * Tier C is everything else, INCLUDING commands this build has never heard of — refused whenever
 * the vault restricts anything, because nothing filters their output per file: `api` (a passthrough
 * to ANY server route, including the exact `GET /file?path=…` ambient-oracle read this feature
 * exists to close — it must never be in another tier), `serve` (a second ungated core), `export`
 * (follows embeds and base sources through readers that were never audited), `checkpoint diff` (raw
 * git diff text), `chat` (transcripts have no single path), `settings status-bar` (runs shell
 * output), `update`, and whatever the CLI grows next.
 *
 * The groups that DO filter their own output moved to {@link FILTERED_COMMANDS}. `note` and `daily`
 * are there although `note new x.md --template Secret` / a configured daily template pull a
 * TEMPLATE's body in by NAME, which the argv scan cannot see: those two commands refuse a hidden
 * template themselves, which is what keeps them out of this tier.
 */
export type CommandTier =
    | 'always-safe'
    | 'path-scoped'
    | 'filtered'
    | 'refuse-when-restricted'

/** Pure: which tier this argv falls into. Checks a two-word compound override first (needed only
 *  for groups whose own subcommands disagree — see COMPOUND_OVERRIDES), then the group's first
 *  token, mirroring the CLI's own longest-match dispatch closely enough for classification purposes. */
export function commandTier(args: string[]): CommandTier {
    const first = (args[0] ?? '').toLowerCase()
    // No command at all (or a bare flag) is help output — harmless.
    if (!first || first.startsWith('-')) return 'always-safe'
    if (COMPOUND_OVERRIDES[first]) return COMPOUND_OVERRIDES[first]
    if (args.length >= 2) {
        const compound = `${first} ${(args[1] ?? '').toLowerCase()}`
        const override = COMPOUND_OVERRIDES[compound]
        if (override) return override
    }
    if (ALWAYS_SAFE_COMMANDS.has(first)) return 'always-safe'
    if (PATH_SCOPED_COMMANDS.has(first)) return 'path-scoped'
    if (FILTERED_COMMANDS.has(first)) return 'filtered'
    return 'refuse-when-restricted'
}

/** Named in the refuse-tier message so an agent knows which commands that tier means. */
const REFUSED_COMMAND_NAMES =
    '`api`, `serve`, `export`, `checkpoint diff`, `chat`, `settings status-bar`, `settings set`, `folder-visibility` and `update`'

export interface GateDecision {
    /** True when the CLI may run. */
    allowed: boolean
    /** Why not — returned to the model verbatim, so it stops rather than retrying variants. */
    reason?: string
}

/**
 * Reduce an argv token, and each deny path it is scanned against, to the same comparison form —
 * visibility.ts's `normalizeForCompare`, applied to the WHOLE token rather than to a path.
 *
 * All three spelling axes have to be folded here, not two. An earlier version of this function
 * folded only case and Unicode form, on the reasoning that a whole argv token is not a path and so
 * its `.`/`..` segments could not be resolved in place — with the segment axis left to the
 * per-token `findDeniedEntry` pass above. That reasoning is right for a token that IS a path and
 * wrong for one that merely CONTAINS one, and the gap was real:
 * `render --out exports/Private/./secret.md.html` returned `allowed: true`, because
 * `findDeniedEntry` cannot resolve a token whose path is a substring, and an unnormalized substring
 * scan cannot see through the `/./`. (`//` slipped the same way. The `..` spelling happened to be
 * caught, since `Private/../Private/secret.md` still contains `Private/secret.md` verbatim — which
 * is luck, not coverage.)
 *
 * Normalizing the whole token is safe because both sides of the scan get the identical treatment: a
 * path embedded in a longer string keeps its segment boundaries, so `exports/Private/./secret.md`
 * folds to `exports/private/secret.md` and still contains the folded needle.
 *
 * NOT purely over-inclusive, despite the rest of this gate being so. Resolving segments also
 * dissolves a restricted path that only survived in a token as a verbatim substring:
 * `read Private/secret.md/../other.md` used to refuse and now runs. It should run — that path
 * resolves to `Private/other.md` and cannot reach the hidden note (see normalizeForCompare's note
 * on why, and the tests pinning it). So this pass trades a handful of false refusals away rather
 * than adding to them; the over-inclusiveness that remains is the substring test itself, which
 * still refuses a token that merely CONTAINS a restricted path as a prefix.
 */
function foldForScan(s: string): string {
    return normalizeForCompare(s)
}

/** The path-shaped pieces of one argv token: the token itself, and — for `--flag=value` and
 *  `path=value` query fragments — whatever follows the first `=`. Each is handed to
 *  findDeniedEntry, which resolves `.`/`..` and both other spelling axes properly. */
function pathCandidates(arg: string): string[] {
    const out = new Set<string>()
    // Percent-encoding is decoded to a fixed point first: `/file?path=%2Esettings` is the rule
    // file to the server, so every spelling of it must reach the checks below.
    for (const a of [arg, safeDecode(arg)]) {
        out.add(a)
        const eq = a.indexOf('=')
        if (eq !== -1 && eq !== a.length - 1) {
            const tail = a.slice(eq + 1)
            out.add(tail)
            out.add(safeDecode(tail))
        }
    }
    return [...out]
}

/** Decode percent-encoding repeatedly until stable (a double-encoded `%252e` too). Malformed
 *  escapes keep the last decodable form instead of throwing. */
function safeDecode(s: string): string {
    let cur = s
    for (let i = 0; i < 10; i++) {
        let next: string
        try {
            next = decodeURIComponent(cur)
        } catch {
            break
        }
        if (next === cur) break
        cur = next
    }
    return cur
}

/**
 * Pure: decide whether `args` may run, given the restricted paths for this channel.
 *
 * `restricted` is the `{rel, abs}` list from `buildDenyPaths`. Two passes, because neither alone is
 * enough:
 *
 *  1. Each argv token (and the value half of a `--flag=value` / `path=value` pair) goes through
 *     `findDeniedEntry`, which resolves `.`/`..` segments, Unicode form and case the same way every
 *     other gate does. `bismuth read Private/../Private/secret.md` opens the file, so it must
 *     refuse.
 *  2. A SUBSTRING test against each token in both path forms, which catches a path embedded
 *     somewhere a whole-token check cannot see it — a longer query string, a quoted shell fragment,
 *     an export path derived from the note. Both sides go through `foldForScan`, which folds all
 *     three spelling axes and not just the two a substring test looks like it can honor; see that
 *     function for the `/./`-inside-a-longer-token hole that costs.
 */
export function decideCliGate(
    args: string[],
    restricted: DenyEntry[],
    opts: DecideOpts,
): GateDecision {
    const tier = commandTier(args)
    if (tier === 'always-safe') return { allowed: true }

    // Protected paths come BEFORE the nothing-restricted early return, for EVERY tier that is not
    // always-safe (so `export --out` and `api` too): a process definition is code the daemon runs
    // outside any sandbox, and `.settings` is the rule file, whether or not the vault restricts
    // anything yet.
    {
        const hit = protectedPathHit(args)
        if (hit !== undefined) {
            return {
                allowed: false,
                reason:
                    `Refused: "${hit}" holds this vault's rules or runnable definitions and is ` +
                    `off-limits to AI sessions. Ask the user to change it.`,
            }
        }
    }

    const anyRestricted = restricted.length > 0 || !!opts.folderRulesRestrict
    if (
        !anyRestricted &&
        (tier === 'refuse-when-restricted' || !opts.restrictedFolder)
    )
        return { allowed: true }

    if (tier === 'refuse-when-restricted') {
        return {
            allowed: false,
            reason:
                `Refused: \`bismuth ${args[0]}\` can return the contents of notes this vault marks off-limits ` +
                `to AI sessions, and it cannot be filtered per-file. ${restricted.length} note(s) are restricted. ` +
                `The commands that cannot be filtered are ${REFUSED_COMMAND_NAMES}; ` +
                `ask the user to unhide the notes, or read a specific visible file by path.`,
        }
    }

    // 'path-scoped' and 'filtered' share the argv path scan below; the filtered commands then
    // filter their own listings (see FILTERED_COMMANDS), so the gate only has to refuse a named path.
    const refusal = (entry: DenyEntry): GateDecision => ({
        allowed: false,
        reason:
            `Refused: "${entry.rel}" is marked off-limits to AI sessions by this vault's visibility ` +
            `settings. Do not try to reach it another way — tell the user it is hidden if they need to know.`,
    })

    for (const arg of args) {
        for (const candidate of pathCandidates(arg)) {
            const hit = findDeniedEntry(restricted, candidate)
            if (hit) return refusal(hit)
            // `calendar create X` / `base create X` append `.md` AFTER this gate saw the token.
            if (!candidate.toLowerCase().endsWith('.md')) {
                const twin = findDeniedEntry(restricted, `${candidate}.md`)
                if (twin) return refusal(twin)
            }
        }
    }

    const haystack = args.map(foldForScan)
    for (const entry of restricted) {
        for (const form of [entry.rel, entry.abs]) {
            const needle = foldForScan(form)
            if (!needle) continue
            if (haystack.some(a => a.includes(needle))) return refusal(entry)
        }
    }

    // Folder tokens, path-scoped only (the filtered tier filters its own listings): a FOLDER named
    // in argv is checked against the per-file entries, which never match a bare folder name.
    if (tier === 'path-scoped') {
        // Skip by argv POSITION, not by value: a value-keyed skip let `--memory "Vault Hidden"`
        // switch the folder check off for the real `Vault Hidden` token.
        const skipIdx = new Set<number>()
        args.forEach((a, i) => {
            if (a === '--vault' || a === '--dir' || a === '--memory')
                skipIdx.add(i + 1)
        })
        const entryRels = restricted.map(e => normalizeForCompare(e.rel))
        const ruleKeys = (opts.restrictingFolders ?? []).map(normalizeForCompare)
        for (let i = 0; i < args.length; i++) {
            const arg = args[i]
            if (skipIdx.has(i) || /^--(vault|dir|memory)=/.test(arg)) continue
            for (const raw of pathCandidates(arg)) {
                const folder = relFolderToken(raw, opts.vaultRoot)
                if (!folder) continue
                const key = normalizeForCompare(folder)
                const entryIdx = entryRels.findIndex(r =>
                    r.startsWith(`${key}/`),
                )
                if (entryIdx !== -1) return refusal(restricted[entryIdx])
                const parent = folder.includes('/')
                    ? folder.slice(0, folder.lastIndexOf('/'))
                    : ''
                // An ANCESTOR of a restricting rule key refuses too, even when the hidden folder
                // below it holds no files: `move Parent X` would orphan `Parent/Empty: hidden`, and
                // anything placed in `X/Empty` afterwards would be visible.
                if (
                    ruleKeys.some(k => k.startsWith(`${key}/`)) ||
                    (opts.restrictedFolder &&
                        (opts.restrictedFolder(folder) ||
                            (parent !== '' && opts.restrictedFolder(parent))))
                ) {
                    return {
                        allowed: false,
                        reason:
                            `Refused: "${folder}" is a folder marked off-limits to AI sessions by this vault's ` +
                            `visibility settings. Do not try to reach it another way — tell the user it is hidden if they need to know.`,
                    }
                }
            }
        }
    }
    return { allowed: true }
}

export interface DecideOpts {
    /** Is this vault-relative FOLDER itself restricted for the channel (own entry, else nearest
     *  ancestor)? Built by `resolveAndDecide` from `folderVisibility`. */
    restrictedFolder?: (dirRel: string) => boolean
    /** True when a folderVisibility rule restricts this channel even though no FILE does (an empty
     *  or absent hidden folder) — so the refuse tier still fires. */
    folderRulesRestrict?: boolean
    /** Every `folderVisibility` key that restricts this channel, so a folder token that is an
     *  ANCESTOR of one refuses (moving it would orphan the rule). */
    restrictingFolders?: string[]
    /** Absolute vault root that argv tokens resolve against. Required: there is no lexical
     *  fallback, because it cannot see symlinks or case and so would be the weaker check. */
    vaultRoot: string
}

/** Paths an AI session may never name, even in a vault that restricts nothing: the rule files and
 *  the daemon's process definitions (`command:` is spawned unsandboxed by the daemon). Compared in
 *  `normalizeForCompare` form, as `/`-bounded segments anywhere in a token. */
export const AGENT_PROTECTED_PATHS: readonly string[] = [
    '.settings',
    'settings.yaml',
    '.daemon/processes',
]

/** The first argv candidate that names a protected path (as written or with `.md` appended), or
 *  undefined. A leading vault-root prefix needs no stripping: the match is a `/`-bounded substring
 *  of the folded token, so `/abs/vault/.settings` and `.settings` both hit. */
export function protectedPathHit(args: string[]): string | undefined {
    for (const arg of args) {
        for (const candidate of pathCandidates(arg)) {
            const folded = `/${normalizeForCompare(candidate)}/`
            for (const p of AGENT_PROTECTED_PATHS) {
                if (folded.includes(`/${p}/`)) return candidate
            }
            // The `.daemon` folder ITSELF: moving or deleting it relocates the protected tree
            // (`move .daemon Stage`, then write Stage/processes/…, then move it back).
            if (folded.endsWith('/.daemon/')) return candidate
        }
    }
    return undefined
}

/** True when a `relative()` result climbs out of its root. `..x` is a folder NAMED `..x` inside the
 *  root, not a climb, so only `..` itself or a leading `../` segment counts. */
const climbsOut = (rel: string) => rel === '..' || rel.startsWith(`..${sep}`)

/** Reduce an argv value to a vault-relative folder-shaped token, or undefined when it cannot be one
 *  (a flag, empty, `.`, climbs out, or an absolute path outside the vault). Case is preserved —
 *  `folderVisibility` keys are looked up as written. */
function relFolderToken(raw: string, vaultRoot: string): string | undefined {
    if (raw.startsWith('-')) return undefined
    const root = realpathLoose(vaultRoot)
    // Collapses `//`, `..`, symlinks and the /tmp alias the same way the filesystem will.
    const abs = realpathLoose(resolve(root, raw))
    let rel = relative(root, abs)
    if (climbsOut(rel)) rel = relative(root.toLowerCase(), abs.toLowerCase())
    if (!rel || climbsOut(rel) || isAbsolute(rel)) return undefined
    // Keep the on-disk case: folderVisibility keys are looked up as written.
    return abs
        .slice(abs.length - rel.length)
        .split(sep)
        .join('/')
}

/** Value of a `--name <value>` or `--name=<value>` argv flag, whichever appears first, mirroring
 *  cli/src/args.ts's `flag()` (duplicated rather than imported: core must not depend on the cli
 *  workspace). Both spellings matter: missing `--vault=<v>` made the gate see no vault at all. */
function argFlag(args: string[], name: string): string | undefined {
    const bare = `--${name}`
    const prefix = `${bare}=`
    for (let i = 0; i < args.length; i++) {
        const a = args[i]
        if (a === bare) {
            if (i + 1 < args.length) return args[i + 1]
        } else if (a.startsWith(prefix)) return a.slice(prefix.length)
    }
    return undefined
}

const HTTP_COMMANDS = new Set(['api', 'chat', 'gcal', 'relay', 'update'])

/** EVERY dir this invocation might target, distinct: `--dir` (checkpoint's generic-repo flag),
 *  `--vault` (`requireVault`, every other file-based command) and `BISMUTH_VAULT`. Which one a
 *  command actually reads is command-specific, so the gate checks all of them rather than picking
 *  the first — picking `--dir` first let `read Private/secret.md --vault V --dir <empty>` check the
 *  empty dir and run on V. A `--dir` that isn't the vault root (the memory repo case) still works:
 *  every file's OWN frontmatter `visibility:` is read regardless of which root buildDenyPaths walked
 *  from, and a refuse-tier command refuses on ANY restricted file. */
function candidateRoots(
    args: string[],
    env: Record<string, string | undefined>,
): string[] {
    const all = [argFlag(args, 'dir'), argFlag(args, 'vault'), env.BISMUTH_VAULT]
    // HTTP-routed groups reach whichever registered core `call()` resolves, with the owner token —
    // so every running core's vault is gated, not only the one argv/env names.
    if (HTTP_COMMANDS.has((args[0] ?? '').toLowerCase()))
        for (const r of readRunRecords()) {
            // A registered core whose vault is gone holds nothing to protect (a core survives
            // `rm -rf`, pids get reused); skipping it keeps a stale record from locking out every
            // HTTP-routed command. A vault that EXISTS but is unreadable still fails closed.
            if (existsSync(r.vault)) all.push(r.vault)
        }
    return [...new Set(all.filter((v): v is string => !!v))]
}

function realOrResolved(p: string): string {
    try {
        return realpathSync(p)
    } catch {
        return resolve(p)
    }
}

const hasSettingsFile = (dir: string) =>
    existsSync(resolve(dir, SETTINGS_FILE)) ||
    existsSync(resolve(dir, LEGACY_SETTINGS_FILE))

/** The vault that strictly contains `root` while `root` itself holds no settings file, or undefined.
 *  `buildDenyPaths(root)` reads `folderVisibility` from `<root>/.settings` only, so addressing a
 *  vault by a subfolder silently drops every folder rule. Memory notes ignore the folder cascade by
 *  design, so `<vault>/.daemon/memory` (and below) is exempt. */
function enclosingVault(root: string): string | undefined {
    const real = realOrResolved(root)
    if (hasSettingsFile(real)) return undefined
    let cur = real
    for (;;) {
        const up = dirname(cur)
        if (up === cur) return undefined
        cur = up
        if (!hasSettingsFile(cur)) continue
        const memory = resolve(cur, '.daemon', 'memory')
        if (real === memory || real.startsWith(memory + sep)) return undefined
        return cur
    }
}

/** Shared resolve-then-decide core for both entry points below. Never throws — any failure REFUSES,
 *  because a gate that opens when it malfunctions is not a gate. Returns `{allowed: true}`
 *  immediately when no vault is configured: with no vault there is nothing to protect, and refusing
 *  every call would break the docs/help commands that need no vault at all. Every candidate root is
 *  decided; the first refusal wins. */
async function resolveAndDecide(
    args: string[],
    env: Record<string, string | undefined>,
    channel: VisibilityChannel,
): Promise<GateDecision> {
    const roots = candidateRoots(args, env)
    if (roots.length === 0) return { allowed: true }
    try {
        const alwaysSafe = commandTier(args) === 'always-safe'
        for (const root of roots) {
            if (!alwaysSafe) {
                const vault = enclosingVault(root)
                if (vault !== undefined) {
                    return {
                        allowed: false,
                        reason:
                            `Refused: "${root}" is inside the vault "${vault}" — pass the vault root ` +
                            `as --vault so its folder rules apply.`,
                    }
                }
            }
            const restricted = await buildDenyPaths(root, channel)
            const res = await readFolderVisibilityResult(root)
            if (!res.ok) throw new Error(res.reason)
            const visible =
                channel === 'chat' ? isVisibleToChat : isVisibleToDaemon
            const decision = decideCliGate(args, restricted, {
                vaultRoot: realOrResolved(root),
                folderRulesRestrict: Object.values(res.map).some(
                    v => !visible(v),
                ),
                restrictingFolders: Object.entries(res.map)
                    .filter(([, v]) => !visible(v))
                    .map(([k]) => k),
                restrictedFolder: dirRel =>
                    !visible(resolveFolderVisibility(dirRel, res.map)),
            })
            if (!decision.allowed) return decision
        }
        return { allowed: true }
    } catch (e) {
        return {
            allowed: false,
            reason:
                `Refused: could not resolve this vault's visibility settings, so the ` +
                `bismuth CLI is unavailable to this session (${e instanceof Error ? e.message : String(e)}).`,
        }
    }
}

/**
 * The MCP-path gate: resolve the vault's restricted set for `BISMUTH_MCP_CHANNEL`, then decide.
 * Used by mcp/src/cli.ts, at the chokepoint every `bismuth_cli`/`remember`/`recall`/`forget` call
 * spawns the CLI through.
 */
export async function gateCliArgs(
    args: string[],
    env: Record<string, string | undefined> = process.env,
): Promise<GateDecision> {
    return resolveAndDecide(args, env, gateChannel(env, 'daemon') ?? 'daemon')
}

/**
 * The CLI's OWN gate — hooked at cli/src/index.ts's single dispatch point, so it runs before every
 * command regardless of how the CLI was invoked (Bash subprocess, a script, anything). Channel
 * comes from {@link cliGateChannel}: `BISMUTH_AGENT_CHANNEL`, else `BISMUTH_MCP_CHANNEL` (an
 * MCP-spawned CLI is an agent's hand). Neither var means the OWNER's own hand — the one place in
 * this file where "unset" allows through with NO gate at all, rather than defaulting to the
 * stricter channel.
 */
export async function gateCliInvocation(
    args: string[],
    env: Record<string, string | undefined> = process.env,
): Promise<GateDecision> {
    const channel = cliGateChannel(env)
    if (channel === null) return { allowed: true }
    return resolveAndDecide(args, env, channel)
}
