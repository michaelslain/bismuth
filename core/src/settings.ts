// core/src/settings.ts
// Lifecycle for the single vault `settings.yaml`. Backend-only (Bun fs OK).
// Reads/writes ride the existing files.ts path-traversal guard; the property
// registry is parsed by the shared pure schema engine so frontmatter and
// settings validation share one source of truth.
import { join } from 'node:path'
import {
    existsSync,
    renameSync,
    copyFileSync,
    statSync,
    rmSync,
    readFileSync,
} from 'node:fs'
import {
    parse,
    parseDocument,
    Document,
    YAMLMap,
    isMap,
    isNode,
    isPair,
    isScalar,
    isSeq,
} from 'yaml'
import { readNote, writeNote } from './files'
import { loadRegistry, BUILTIN_PROPERTIES } from './schema/registry'
import { SETTINGS_SCHEMA, DEFAULTS } from './schema/settingsSchema'
import { listCustomThemes } from './theme/themeFiles'
import {
    normalizeFolderKey,
    parseSettingsText,
    readDailyNotesFrom,
    readFolderVisibilityFrom,
    serializeSettingsFromText,
} from './settingsSerialize'
import type { Schema, SchemaEntry } from './schema/types'
import type { DailyNoteConfig } from './dailyNote'
import type { SrsConfig } from './srs/scheduler'

/** The vault's settings live in a single hidden file `.settings` (YAML), at the vault root. */
export const SETTINGS_FILE = '.settings'
/** Legacy location (vault root) — migrated into `.settings` on first open. */
export const LEGACY_SETTINGS_FILE = 'settings.yaml'

export interface ReadSettingsResult {
    raw: string
    data: Record<string, unknown>
    /**
     * Set when the file EXISTS but its YAML did not parse — `data` is then `{}` for the same reason a
     * missing file yields `{}`, and the two cases are indistinguishable from `data` alone.
     *
     * Almost every reader is right to ignore this: the app must boot, and the editor must open the
     * file to be fixed, even when a stray character has broken it. It exists for the one reader whose
     * `{}` is not a harmless fallback — the visibility walk, where an empty `folderVisibility` map is
     * the difference between "this folder is hidden from agents" and "nothing here is hidden".
     */
    parseError?: string
}

/**
 * One-time relocation of older settings layouts into the single `.settings` file. Handles two
 * legacy shapes: a vault-root `settings.yaml`, and the interim `.settings/settings.yaml` folder
 * from an earlier build of this branch. Idempotent (no-op once a `.settings` FILE exists). Uses
 * filesystem renames so user comments/values are preserved verbatim. Best-effort throughout.
 */
export function migrateSettingsLocation(vault: string): void {
    const next = join(vault, SETTINGS_FILE) // ".settings" (a file)
    // Already migrated — a `.settings` FILE exists. (Guard: an interim `.settings/` DIR also makes
    // existsSync true, so require isFile before bailing.)
    try {
        if (existsSync(next) && statSync(next).isFile()) return
    } catch {
        /* fall through */
    }

    // Interim layout: `.settings/settings.yaml` (a DIR). Collapse it to the `.settings` file via a
    // temp name (a file and a dir can't share the name `.settings`), then drop the empty dir.
    const interim = join(vault, '.settings', 'settings.yaml')
    if (existsSync(interim)) {
        try {
            const tmp = join(vault, '.settings.migrating')
            renameSync(interim, tmp)
            rmSync(join(vault, '.settings'), { recursive: true, force: true })
            renameSync(tmp, next)
            return
        } catch {
            /* fall through to the legacy-root path */
        }
    }

    // Legacy layout: a vault-root `settings.yaml` → `.settings`.
    const legacy = join(vault, LEGACY_SETTINGS_FILE)
    if (existsSync(legacy) && !existsSync(next)) {
        try {
            renameSync(legacy, next)
        } catch {
            // rename can fail (a lock, an odd filesystem state). Fall back to a COPY so `.settings`
            // exists with the user's real settings — reconcile reads only SETTINGS_FILE, so without
            // this a failed move silently resets the vault to defaults. Legacy left as a backup.
            try {
                copyFileSync(legacy, next)
            } catch {
                /* give up — reconcile seeds defaults */
            }
        }
    }
}

/**
 * Per-vault mutex for settings file mutations. Prevents concurrent POST /set-setting
 * requests from clobbering each other via TOCTOU race. Keys are vault paths;
 * values are promise chains that serialize all access to that vault's settings.yaml.
 */
const settingsMutexes = new Map<string, Promise<void>>()

/** Run a function serially within a per-vault mutex. */
async function withSettingsMutex<T>(
    vault: string,
    fn: () => Promise<T>,
): Promise<T> {
    // Chain this operation after any pending operations on this vault
    const existing = settingsMutexes.get(vault) ?? Promise.resolve()
    let result!: T
    let error: Error | undefined

    const next = existing.then(async () => {
        try {
            result = await fn()
        } catch (e) {
            error = e as Error
        }
    })

    settingsMutexes.set(vault, next)

    // Wait for this operation to complete
    await next
    if (error) throw error
    return result
}

/** Read settings.yaml. Returns null if absent; tolerant of malformed YAML (data → {}, and
 *  `parseError` set so a reader that must not treat corrupt as empty can tell — see
 *  {@link ReadSettingsResult.parseError} and {@link readFolderVisibilityResult}). */
export async function readSettings(
    vault: string,
): Promise<ReadSettingsResult | null> {
    const full = join(vault, SETTINGS_FILE)
    if (!(await Bun.file(full).exists())) return null
    const raw = await readNote(vault, SETTINGS_FILE)
    const { data, parseError } = parseSettingsText(raw)
    return { raw, data, ...(parseError === undefined ? {} : { parseError }) }
}

/**
 * Synchronously read just `daemon.enabled` from the vault's `.settings` file. Needed on the
 * NARROW boot window before the async {@link loadAppConfig} resolves: the tree gates the
 * `.daemon` folder and the graph gates the 3rd brain on this flag, so the FIRST cached /tree +
 * /graph build must already see the real value — otherwise `.daemon` (and the 3rd brain) pop in a
 * beat late once the async load lands. Mirrors the sync identity.md read in daemonIdentityName.
 * Degrades to the schema default (false) on a missing/corrupt/partial file; never throws.
 */
export function readDaemonEnabledSync(vault: string): boolean {
    const fallback =
        (DEFAULTS as { daemon?: { enabled?: boolean } }).daemon?.enabled ===
        true
    try {
        const full = join(vault, SETTINGS_FILE)
        if (!existsSync(full)) return fallback
        const parsed = parse(readFileSync(full, 'utf8')) as Record<
            string,
            unknown
        > | null
        const daemon =
            parsed && typeof parsed === 'object' ? parsed.daemon : undefined
        if (
            daemon &&
            typeof daemon === 'object' &&
            typeof (daemon as Record<string, unknown>).enabled === 'boolean'
        ) {
            return (daemon as { enabled: boolean }).enabled
        }
    } catch {
        // missing/corrupt/unreadable → fall through to the schema default
    }
    return fallback
}

/**
 * The `mcp.registerWith` list: which OTHER agent CLIs the user opted into registering Bismuth's
 * MCP server with (Claude Code always registers; see core/src/bismuthInstall.ts). Naming a CLI
 * there is the consent, so boot acts on it — a setting that only recorded the choice would silently
 * ignore a user who added one and restarted.
 *
 * Tolerant by design: a missing/corrupt file, a non-list value, or non-string entries all yield the
 * safe empty list rather than throwing. Unknown ids are harmless — they simply match no registrar.
 */
export async function readMcpRegisterWith(vault: string): Promise<string[]> {
    try {
        const res = await readSettings(vault)
        const mcp = res?.data?.mcp as { registerWith?: unknown } | undefined
        const list = mcp?.registerWith
        if (!Array.isArray(list)) return []
        return list.filter(
            (v): v is string => typeof v === 'string' && v.trim() !== '',
        )
    } catch {
        return []
    }
}

/**
 * The `codex.*` opt-ins (core/src/agentBackends/agentsMd.ts + codexHooks.ts): whether Bismuth may
 * write a managed AGENTS.md block and/or a project-scoped `.codex/hooks.json` into this vault.
 * Naming precedent: `readMcpRegisterWith` above — writing into a file the user may hand-edit is
 * opt-in, so a missing/corrupt file or a non-boolean value all degrade to "off" rather than "on".
 */
export interface CodexOptIns {
    writeAgentsMd: boolean
    installRelayHooks: boolean
}

export async function readCodexOptIns(vault: string): Promise<CodexOptIns> {
    try {
        const res = await readSettings(vault)
        const codex = res?.data?.codex as
            { writeAgentsMd?: unknown; installRelayHooks?: unknown } | undefined
        return {
            writeAgentsMd: codex?.writeAgentsMd === true,
            installRelayHooks: codex?.installRelayHooks === true,
        }
    } catch {
        return { writeAgentsMd: false, installRelayHooks: false }
    }
}

/** Parse the `properties:` section of settings.yaml into a validation Schema,
 *  merged over the built-in properties (tags/aliases/cssclasses). */
export async function getVaultSchema(vault: string): Promise<Schema> {
    const res = await readSettings(vault)
    if (!res) return { ...BUILTIN_PROPERTIES }
    return { ...BUILTIN_PROPERTIES, ...loadRegistry(res.data.properties) }
}

/** What a brand-new vault's `.settings` holds: no keys at all. `.settings` is SPARSE — it carries
 *  only what the user changed, and every absent key reads as its schema default (every reader
 *  merges over DEFAULTS: serializeSettingsForFrontend, readDaemonEnabledSync, the daemon's
 *  vaultSettings.ts, …). A value equal to its default is still allowed and is never pruned once
 *  written by hand — only a whole materialized dump is, see stripMaterializedDefaults. */
export const SETTINGS_SEED = `# Only the settings you change live here; every key left out uses its default.
# Ctrl-Space lists every key with its doc and default value.
`

/** On first launch, write the sparse seed file. No-op if present. */
export async function initializeSettings(vault: string): Promise<void> {
    const full = join(vault, SETTINGS_FILE)
    if (await Bun.file(full).exists()) return
    await writeNote(vault, SETTINGS_FILE, SETTINGS_SEED)
}

function objectFields(entry: SchemaEntry): Schema | undefined {
    return typeof entry.type === 'object' && entry.type.kind === 'object'
        ? entry.type.fields
        : undefined
}

function isTokenEntry(entry: SchemaEntry): boolean {
    return typeof entry.type === 'object' && entry.type.kind === 'token'
}

function schemaLeafCount(schema: Schema): number {
    let n = 0
    for (const entry of Object.values(schema) as SchemaEntry[]) {
        if (isTokenEntry(entry)) continue // sparse overrides: no default, never part of a dump
        const fields = objectFields(entry)
        n += fields ? schemaLeafCount(fields) : 1
    }
    return n
}

/** True if `node` or anything inside it carries a comment — such a pair is the user's, not a seed. */
function hasComment(node: unknown): boolean {
    if (!isNode(node)) return false
    if (node.commentBefore || node.comment) return true
    if (isMap(node) || isSeq(node))
        return node.items.some(item =>
            isPair(item)
                ? hasComment(item.key) || hasComment(item.value)
                : hasComment(item),
        )
    return false
}

/** Paths of every schema leaf present in `map` whose value deep-equals its schema default. */
function defaultLeafPaths(
    map: YAMLMap,
    schema: Schema,
    path: string[],
    out: string[][],
): string[][] {
    for (const [key, entry] of Object.entries(schema) as [
        string,
        SchemaEntry,
    ][]) {
        const pair = findPair(map, key)
        if (!pair || isTokenEntry(entry)) continue
        const fields = objectFields(entry)
        if (fields) {
            if (isMap(pair.value))
                defaultLeafPaths(
                    pair.value as YAMLMap,
                    fields,
                    [...path, key],
                    out,
                )
            continue
        }
        const value = isNode(pair.value) ? pair.value.toJSON() : pair.value
        if (Bun.deepEquals(value, entry.default ?? null))
            out.push([...path, key])
    }
    return out
}

/** Drop every comment-free empty map left under `map` once its leaves were stripped. */
function dropEmptySections(map: YAMLMap): void {
    for (const pair of [...map.items]) {
        if (!isMap(pair.value)) continue
        dropEmptySections(pair.value as YAMLMap)
        if (
            (pair.value as YAMLMap).items.length === 0 &&
            !hasComment(pair.key) &&
            !hasComment(pair.value)
        )
            map.items.splice(map.items.indexOf(pair), 1)
    }
}

// A file is a MATERIALIZED dump — the full-defaults file every vault was seeded with before
// `.settings` went sparse, then kept topped up by the old fillMissing — when at least this share of
// all schema leaves sit in it at exactly their default. A hand-written override file never comes
// close, so this fires once per vault: after the strip the file holds only real overrides.
const MATERIALIZED_DUMP_RATIO = 0.5

/**
 * One-time cleanup for a pre-sparse `.settings`: when the file is a materialized dump, delete every
 * leaf still at its schema default, then every section left empty. A pair carrying a comment is
 * kept (the comment is the user's), as are unknown keys and every non-default value. Returns true
 * if anything was removed. A sparse file is never touched, so a default value the user writes by
 * hand stays put.
 */
function stripMaterializedDefaults(doc: Document): boolean {
    const root = doc.contents as YAMLMap
    const paths = defaultLeafPaths(root, SETTINGS_SCHEMA, [], [])
    if (
        paths.length <
        schemaLeafCount(SETTINGS_SCHEMA) * MATERIALIZED_DUMP_RATIO
    )
        return false
    let mutated = false
    for (const path of paths) {
        const parent =
            path.length > 1 ? doc.getIn(path.slice(0, -1), true) : root
        if (!isMap(parent)) continue
        const pair = findPair(parent as YAMLMap, path[path.length - 1])
        if (!pair || hasComment(pair.key) || hasComment(pair.value)) continue
        ;(parent as YAMLMap).items.splice(
            (parent as YAMLMap).items.indexOf(pair),
            1,
        )
        mutated = true
    }
    if (mutated) {
        dropEmptySections(root)
        // the blank line that separated a stripped first section rides on the new first key
        const first = root.items[0]
        if (first && isScalar(first.key) && !first.key.commentBefore)
            first.key.spaceBefore = false
    }
    return mutated
}

// The 12 pre-ASCII-redesign theme names (6 bases × dark/`-light`), still-valid-looking
// strings that `resolveTheme()` silently falls back to `ink` for but that a saved
// `.settings` file keeps verbatim. Drives migrateLegacyAppearance below.
const LEGACY_THEME_BASES = [
    'oxide-duotone',
    'gunmetal-teal',
    'rose-gold',
    'indigo-oxide',
    'forest-oxide',
    'full-sheen',
]
const LEGACY_THEMES = new Set<string>([
    ...LEGACY_THEME_BASES,
    ...LEGACY_THEME_BASES.map(n => `${n}-light`),
])
/**
 * One-time migration for a `.settings` file saved under the pre-ASCII-redesign theme
 * system + type scale. `appearance.theme` already degrades to a schema default at READ
 * time (serializeSettingsForFrontend: an unknown enum value never overlays DEFAULTS) —
 * but the FILE keeps the stale value, and the redesign's new type-scale numbers (font
 * sizes, mono scale, sidebar width, line height) are all still schema-VALID, so they'd
 * keep winning over the new defaults forever without an explicit rewrite. The redesign
 * is a clean break, so those keys are reset outright rather than best-effort translated.
 *
 * Trigger: `appearance.theme` is one of the 12 legacy names. (This used to also trigger
 * on a legacy serif/system `appearance.editorFont` value and rewrite it to a Monaspace
 * variant — that branch is gone now that `editorFont` itself is retired: RETIRED_KEYS /
 * pruneRetiredKeys below deletes the key outright, for EVERY saved value, not just the
 * old serif/system ones. Translating it into `uiFont` here would silently override an
 * explicit `uiFont` the same file already sets, and "Lora" is a valid choice again
 * anyway — just on `proseFont`, which is never written by this migration and resolves
 * from its own schema default like any other absent key.)
 */
function migrateLegacyAppearance(doc: Document): boolean {
    const appearance = doc.getIn(['appearance'])
    if (!isMap(appearance)) return false
    const theme = doc.getIn(['appearance', 'theme'])
    const legacyTheme =
        typeof theme === 'string' && LEGACY_THEMES.has(theme)
            ? theme
            : undefined
    if (!legacyTheme) return false

    doc.setIn(
        ['appearance', 'theme'],
        legacyTheme.endsWith('-light') ? 'paper' : 'ink',
    )
    // The redesign's clean type-scale break: reset regardless of the saved value.
    const RESET_PATHS: Array<[string, string]> = [
        ['appearance', 'editorFontSize'],
        ['appearance', 'uiFontSize'],
        ['appearance', 'tabFontSize'],
        ['appearance', 'iconSize'],
        ['appearance', 'monoScale'],
        ['appearance', 'sidebarWidth'],
        ['editor', 'lineHeight'],
    ]
    // `.settings` is sparse, so "reset to default" is "remove the key".
    for (const [section, key] of RESET_PATHS) {
        const parent = doc.getIn([section], true)
        if (isMap(parent)) (parent as YAMLMap).delete(key)
    }
    const editor = doc.getIn(['editor'], true)
    if (isMap(editor) && !editor.items.length && !hasComment(editor))
        doc.deleteIn(['editor']) // lineHeight was its only key — leave no `editor: {}` behind
    return true
}

// Schema keys removed from SETTINGS_SCHEMA that a persisted `.settings` may still carry from an
// older Bismuth. Each entry is a full path (section, ..., leaf key); pruneRetiredKeys below deletes
// whichever of these are still present on reconcile, so a retired key doesn't linger forever once
// nothing reads it. `appearance.editorFont` is deleted outright here, for every saved value —
// never translated into `uiFont`, since the two have always defaulted to the same thing and every
// shipped value was already a Monaspace variant (see migrateLegacyAppearance's doc comment above).
// `appearance.paletteInputFontSize` went when the search fields took their results' type size
// (ui/SearchBar.module.css's densities change padding, never text size — DESIGN.md).
const RETIRED_KEYS: readonly (readonly string[])[] = [
    ['editor', 'defaultMode'],
    ['appearance', 'editorFont'],
    ['appearance', 'paletteInputFontSize'],
    // `daemon.home` and `daemon.autoUpdate` left the schema in 4270a076 (the daemon's machine home is
    // fixed at ~/.bismuth/daemon, and updates moved to `update.autoUpdate`) but were never listed
    // here, so they survived in every old `.settings` as unknown keys. NOT `update.autoUpdate`,
    // which is live.
    ['daemon', 'home'],
    ['daemon', 'autoUpdate'],
    // `appearance.tabFontSize` fed a `--tab-font-size` var that no stylesheet ever read; tab labels
    // are `--fs-ui` like the rest of the chrome.
    ['appearance', 'tabFontSize'],
]

/** The pair for `key` in `map`, or undefined. */
function findPair(map: YAMLMap, key: string) {
    return map.items.find(p => isScalar(p.key) && p.key.value === key)
}

/**
 * Carry a comment onto whatever now sits at `index` in `parent` after a key was
 * deleted from it — the item that shifted into the removed slot, or, if the removed
 * key was the section's last, the section key itself (found via `sectionPath`).
 * Shared by `renameKeys` and `pruneRetiredKeys` so both handle the "last key in a
 * section" edge the same way.
 */
function carryComment(
    doc: Document,
    parent: YAMLMap,
    sectionPath: readonly string[],
    index: number,
    comment: string,
) {
    const carrier = parent.items[index]
    if (carrier && isScalar(carrier.key)) {
        carrier.key.commentBefore = carrier.key.commentBefore
            ? `${comment}\n${carrier.key.commentBefore}`
            : comment
        return
    }
    if (!sectionPath.length) return
    const grandparent = doc.getIn(sectionPath.slice(0, -1), true)
    const sectionPair = isMap(grandparent)
        ? findPair(grandparent as YAMLMap, sectionPath[sectionPath.length - 1])
        : undefined
    if (sectionPair && isScalar(sectionPair.key)) {
        sectionPair.key.commentBefore = sectionPair.key.commentBefore
            ? `${comment}\n${sectionPair.key.commentBefore}`
            : comment
    }
}

// Schema keys renamed since an older Bismuth. Each entry names the OLD full path (section, ...,
// leaf key) and the new leaf key (renames are always within the same section). renameKeys below
// runs FIRST in reconcileSettings, so the strip and the migrations after it see the key under its
// current name.
const RENAMED_KEYS: readonly { from: readonly string[]; to: string }[] = [
    { from: ['appearance', 'sidebarIconFontSize'], to: 'iconSize' },
    { from: ['appearance', 'toolbarIconSize'], to: 'iconSize' },
]

/**
 * Rename any RENAMED_KEYS pair still present under its old name, in place. When only the old key
 * exists, the key scalar itself is renamed — which keeps the value, the position and the
 * `commentBefore` untouched. When BOTH the old and new key are present, the new key's value wins
 * (never overwritten) and the old pair is deleted, carrying its comment onto whichever pair
 * shifts into its slot — the same approach `pruneRetiredKeys` uses below. Returns true if
 * anything was renamed or removed.
 */
function renameKeys(doc: Document): boolean {
    let mutated = false
    for (const { from, to } of RENAMED_KEYS) {
        const sectionPath = from.slice(0, -1)
        const oldKey = from[from.length - 1]
        const parent = sectionPath.length
            ? doc.getIn(sectionPath, true)
            : doc.contents
        if (!isMap(parent)) continue
        const oldPair = findPair(parent as YAMLMap, oldKey)
        if (!oldPair) continue
        const newPair = findPair(parent as YAMLMap, to)
        if (newPair) {
            const comment = [
                isScalar(oldPair.key) ? oldPair.key.commentBefore : undefined,
                isScalar(oldPair.value) ? oldPair.value.comment : undefined,
            ]
                .filter(Boolean)
                .join('\n')
            const index = (parent as YAMLMap).items.indexOf(oldPair)
            ;(parent as YAMLMap).delete(oldKey)
            if (comment)
                carryComment(doc, parent as YAMLMap, sectionPath, index, comment)
        } else if (isScalar(oldPair.key)) {
            oldPair.key.value = to
        }
        mutated = true
    }
    return mutated
}

// Schema keys that moved to a DIFFERENT section since an older Bismuth (renameKeys handles moves
// within one section). Each entry is the OLD and NEW full path. moveKeys runs early for the same
// reason renameKeys does. The cursor trio was terminal-only until the app's cursors were
// unified onto one definition, when it became app-wide under `appearance`.
const MOVED_KEYS: readonly { from: readonly string[]; to: readonly string[] }[] = [
    { from: ['terminal', 'cursorWidth'], to: ['appearance', 'cursorWidth'] },
    { from: ['terminal', 'cursorGlideMs'], to: ['appearance', 'cursorGlideMs'] },
    {
        from: ['terminal', 'cursorBlinkSeconds'],
        to: ['appearance', 'cursorBlinkSeconds'],
    },
]

/**
 * Move any MOVED_KEYS pair still at its old path to its new one. The value node travels as-is
 * (inline comment included) and the key's `commentBefore` rides along onto the new key. When the
 * new path already holds a value, that value wins and the old pair is just deleted, its comment
 * carried onto whatever shifts into its slot — the same rule renameKeys follows. Returns true if
 * anything moved or was removed.
 */
function moveKeys(doc: Document): boolean {
    let mutated = false
    for (const { from, to } of MOVED_KEYS) {
        const fromSection = from.slice(0, -1)
        const oldKey = from[from.length - 1]
        const parent = fromSection.length
            ? doc.getIn(fromSection, true)
            : doc.contents
        if (!isMap(parent)) continue
        const oldPair = findPair(parent as YAMLMap, oldKey)
        if (!oldPair) continue
        const index = (parent as YAMLMap).items.indexOf(oldPair)
        const keyComment = isScalar(oldPair.key)
            ? oldPair.key.commentBefore
            : undefined
        ;(parent as YAMLMap).delete(oldKey)
        mutated = true
        if (doc.hasIn(to)) {
            const comment = [
                keyComment,
                isScalar(oldPair.value) ? oldPair.value.comment : undefined,
            ]
                .filter(Boolean)
                .join('\n')
            if (comment)
                carryComment(doc, parent as YAMLMap, fromSection, index, comment)
            continue
        }
        const toSection = to.slice(0, -1)
        const target = doc.getIn(toSection, true)
        if (isMap(target)) {
            const pair = doc.createPair(to[to.length - 1], oldPair.value)
            if (keyComment && isScalar(pair.key))
                pair.key.commentBefore = keyComment
            ;(target as YAMLMap).items.push(pair)
        } else {
            doc.setIn(to, oldPair.value)
            if (keyComment)
                carryComment(doc, parent as YAMLMap, fromSection, index, keyComment)
        }
    }
    return mutated
}

/**
 * Delete any RETIRED_KEYS pair still present in `doc`. A hand-written comment sitting directly
 * above a removed key is not dropped with it: it is carried onto the key that now takes its place
 * in the section, or — if the removed key was the section's last — onto the section itself, so it
 * still survives the rewrite (reconcile's "unknown keys are never touched" doesn't apply here,
 * since a retired key is a KNOWN key this era's schema deliberately no longer has). Returns true if
 * anything was removed.
 */
function pruneRetiredKeys(doc: Document): boolean {
    let mutated = false
    for (const path of RETIRED_KEYS) {
        const sectionPath = path.slice(0, -1)
        const key = path[path.length - 1]
        const parent = sectionPath.length
            ? doc.getIn(sectionPath, true)
            : doc.contents
        if (!isMap(parent)) continue
        const pair = findPair(parent as YAMLMap, key)
        if (!pair) continue
        const comment = [
            isScalar(pair.key) ? pair.key.commentBefore : undefined,
            isScalar(pair.value) ? pair.value.comment : undefined,
        ]
            .filter(Boolean)
            .join('\n')
        const index = (parent as YAMLMap).items.indexOf(pair)
        ;(parent as YAMLMap).delete(key)
        if (comment)
            carryComment(doc, parent as YAMLMap, sectionPath, index, comment)
        mutated = true
    }
    return mutated
}

/**
 * The dotted paths of RETIRED_KEYS still present in `<vault>/.settings` — what the next
 * `reconcileSettings` would delete. Read-only and never throws: a missing, directory-shaped or
 * unparseable file reports nothing, the same files reconcile itself leaves alone.
 */
export function retiredKeysPresent(vault: string): string[] {
    let doc: Document
    try {
        doc = parseDocument(readFileSync(join(vault, SETTINGS_FILE), 'utf8'))
    } catch {
        return []
    }
    if (doc.errors.length || !isMap(doc.contents)) return []
    return RETIRED_KEYS.filter(path => {
        const parent = path.length > 1 ? doc.getIn(path.slice(0, -1), true) : doc.contents
        return isMap(parent) && !!findPair(parent as YAMLMap, path[path.length - 1])
    }).map(path => path.join('.'))
}

/**
 * Daemon-config migration hook. Historically normalized the obsolete `daemon.home`
 * default and adopted an installed daemon on first reconcile. Both are gone now: the
 * daemon is bundled and its machine-identity home is fixed at ~/.bismuth/daemon (no
 * longer settings-configurable), and adoption/enable is driven by the first-run intro.
 * Retained as a no-op so the reconcile call site stays stable for any future daemon
 * migration. Always returns false (no doc change).
 */
function migrateDaemonConfig(_doc: Document): boolean {
    return false
}

/**
 * On open: migrate renamed/moved/retired keys and, once, strip a pre-sparse materialized dump down
 * to its real overrides — preserving comments, key order, user values and unknown keys. Missing
 * keys are NEVER filled in: `.settings` is sparse and every absent key reads as its schema default.
 * Absent file → write the sparse seed. Corrupt/empty file → left untouched. Writes only when
 * something actually changed, so a settled file produces no spurious write / SSE churn.
 *
 * Returns whether it actually wrote `.settings` — callers that self-write-mark this path
 * (server.ts's boot call) use it to unmark/not-rearm the mark on a no-op run, so a real external
 * `.settings` edit landing in that window isn't mistaken for this call's own (nonexistent) echo.
 */
export async function reconcileSettings(vault: string): Promise<boolean> {
    migrateSettingsLocation(vault) // move a legacy root settings.yaml into .settings/ (idempotent)
    const full = join(vault, SETTINGS_FILE)
    if (!(await Bun.file(full).exists())) {
        await initializeSettings(vault)
        return true
    }
    const raw = await readNote(vault, SETTINGS_FILE)
    let doc: Document
    try {
        doc = parseDocument(raw)
        if (doc.errors.length) return false // corrupt — leave the file for the user to fix
    } catch {
        return false
    }
    if (!isMap(doc.contents)) return false // empty/scalar/corrupt — leave alone
    const renamed = renameKeys(doc) // first, so everything after sees current key names
    const moved = moveKeys(doc) // same ordering constraint as renameKeys
    const migrated = migrateDaemonConfig(doc)
    const migratedAppearance = migrateLegacyAppearance(doc)
    const pruned = pruneRetiredKeys(doc)
    const stripped = stripMaterializedDefaults(doc) // last: counts the migrated values as they now are
    if (
        renamed ||
        moved ||
        migrated ||
        migratedAppearance ||
        pruned ||
        stripped
    ) {
        await writeNote(
            vault,
            SETTINGS_FILE,
            doc.toString({ flowCollectionPadding: false }),
        )
        return true
    }
    return false
}

/**
 * Merge a single value at `path` into settings.yaml in place, preserving every
 * other key, all comments, and key order. Reconciles first so the file exists and
 * its keys are current. This is the backend's single write path for settings, so a
 * frontend toggle can never clobber comments or the `properties:` registry.
 *
 * Guarded by a per-vault mutex to prevent concurrent requests from clobbering
 * each other via TOCTOU race during read-modify-write.
 */
export async function setSettingInFile(
    vault: string,
    path: string[],
    value: unknown,
): Promise<void> {
    if (!path.length) return
    await withSettingsMutex(vault, async () => {
        await reconcileSettings(vault) // ensure the file exists + its keys are current
        const raw = await readNote(vault, SETTINGS_FILE)
        const doc = parseDocument(raw)
        if (doc.errors.length) return // corrupt — never clobber existing content
        doc.setIn(path, value)
        await writeNote(
            vault,
            SETTINGS_FILE,
            doc.toString({ flowCollectionPadding: false }),
        )
    })
}

/**
 * Merge the settings.yaml file over DEFAULTS via a per-key typeof check, so a
 * corrupt/partial file degrades to defaults. The `properties` registry is
 * delivered separately (GET /schema) and excluded here. The pure merge lives in
 * settingsSerialize.ts (shared with the in-process iPad backend); this is its Bun wrapper.
 */
export async function serializeSettingsForFrontend(
    vault: string,
): Promise<Record<string, unknown>> {
    const res = await readSettings(vault)
    return serializeSettingsFromText(
        res?.raw ?? null,
        (await listCustomThemes(vault)).filter(t => t.theme).map(t => t.name),
    )
}

/** Read the per-folder visibility map from settings.yaml. Absent file / section / corrupt YAML →
 *  {}. For the ENFORCEMENT read, which must not treat a corrupt file as an empty map, use
 *  {@link readFolderVisibilityResult}. */
export async function readFolderVisibility(
    vault: string,
): Promise<Record<string, 'chat-only' | 'hidden'>> {
    const res = await readSettings(vault)
    if (!res) return {}
    return readFolderVisibilityFrom(res.data)
}

/** Either the folder-visibility map, or the reason it could not be determined. */
export type FolderVisibilityResult =
    | { ok: true; map: Record<string, 'chat-only' | 'hidden'> }
    | { ok: false; reason: string }

/**
 * The folder-visibility map for a reader that must distinguish "no folders are restricted" from
 * "this file does not say what is restricted".
 *
 * An ABSENT `.settings` is `ok` with an empty map — a vault that has never been configured restricts
 * nothing, and that is a fact, not a gap. A `.settings` that exists but does not parse is NOT ok:
 * its `folderVisibility:` block may well have named the folder the user is relying on, and
 * {@link readFolderVisibility}'s `{}` is byte-identical to the answer for a vault that hides
 * nothing. An unreadable-but-present file propagates its read error to the caller, as before.
 *
 * Also fails closed on a `folderVisibility` that is present but malformed: a non-map, or any value
 * other than `chat-only`/`hidden`/`all` (a typo like `hiden` used to be dropped, leaving the folder
 * visible). `all` is valid and restricts nothing, so it is dropped from the map.
 */
export async function readFolderVisibilityResult(
    vault: string,
): Promise<FolderVisibilityResult> {
    const res = await readSettings(vault)
    if (!res) return { ok: true, map: {} }
    if (res.parseError !== undefined) {
        return {
            ok: false,
            reason: `${SETTINGS_FILE} is not valid YAML (${res.parseError})`,
        }
    }
    const raw = res.data.folderVisibility
    if (raw === undefined || raw === null) return { ok: true, map: {} }
    if (typeof raw !== 'object' || Array.isArray(raw)) {
        return {
            ok: false,
            reason: `${SETTINGS_FILE} folderVisibility must be a map of folder → chat-only|hidden`,
        }
    }
    for (const v of Object.values(raw as Record<string, unknown>)) {
        if (v !== 'chat-only' && v !== 'hidden' && v !== 'all') {
            return {
                ok: false,
                // Never quote the key: it is a hidden folder's name, and this reason reaches agents.
                reason: `${SETTINGS_FILE} a folderVisibility entry is not chat-only, hidden or all`,
            }
        }
    }
    return { ok: true, map: readFolderVisibilityFrom(res.data) }
}

/** Read the dailyNotes config from settings.yaml. Absent file → seeded default. */
export async function readDailyNotes(
    vault: string,
): Promise<DailyNoteConfig[]> {
    const res = await readSettings(vault)
    return readDailyNotesFrom(res?.data ?? {})
}

/**
 * Shared read-modify-write skeleton behind setFolderIcon and setFolderVisibility: mutex-guard,
 * ensure a settings.yaml exists, parse it, ensure a top-level YAMLMap node at `mapKey`, then set
 * `entryKey` to `nextValue` or delete it when `nextValue` is undefined.
 *
 * Returns whether the change persisted — false when the file is unparseable or corrupt, in which
 * case it is left untouched rather than clobbered.
 */
async function mutateSettingsStringMap(
    vault: string,
    mapKey: string,
    entryKey: string,
    nextValue: string | undefined,
): Promise<boolean> {
    return withSettingsMutex(vault, async () => {
        await initializeSettings(vault) // no-op if present; guarantees a file to edit
        const raw = await readNote(vault, SETTINGS_FILE)
        let doc: Document
        try {
            doc = parseDocument(raw)
        } catch {
            return false // unparseable — never clobber existing content
        }
        if (doc.errors.length) return false // corrupt — leave the file for the user to fix
        if (!doc.contents || !(doc.contents instanceof YAMLMap)) {
            doc.contents = new YAMLMap()
        }
        let map = doc.getIn([mapKey])
        if (!(map instanceof YAMLMap)) {
            map = new YAMLMap()
            doc.setIn([mapKey], map)
        }
        if (nextValue !== undefined) {
            ;(map as YAMLMap).set(entryKey, nextValue)
        } else {
            ;(map as YAMLMap).delete(entryKey)
            // sparse: an emptied map is its default ({}), so the key goes too
            if (!(map as YAMLMap).items.length && !hasComment(map))
                doc.deleteIn([mapKey])
        }
        await writeNote(
            vault,
            SETTINGS_FILE,
            doc.toString({ flowCollectionPadding: false }),
        )
        return true
    })
}

/**
 * Set or clear a folder's icon and persist settings.yaml in place.
 * A non-empty icon sets folderIcons[path]; an empty/missing icon deletes it.
 * Initializes a fresh settings.yaml first if none exists, then edits only the
 * folderIcons node via the YAML CST so the rest of the file is preserved.
 *
 * Guarded by a per-vault mutex to prevent concurrent requests from clobbering
 * each other via TOCTOU race during read-modify-write.
 */
export async function setFolderIcon(
    vault: string,
    path: string,
    icon: string | null | undefined,
): Promise<void> {
    await mutateSettingsStringMap(
        vault,
        'folderIcons',
        path,
        icon && icon.length > 0 ? icon : undefined,
    )
}

/**
 * Set or clear a folder's AI visibility and persist settings.yaml in place.
 * A recognized value ("chat-only"/"hidden") sets folderVisibility[path]; anything
 * else (including "all"/null/undefined) deletes it — same shape as setFolderIcon,
 * restricted to the two-literal union.
 */
export async function setFolderVisibility(
    vault: string,
    path: string,
    visibility: 'chat-only' | 'hidden' | null | undefined,
): Promise<boolean> {
    // Normalize the key so a trailing-slash path (shell/CLI tab-completion) actually enforces.
    const key = normalizeFolderKey(path)
    // Returns whether the change PERSISTED — a corrupt .settings is left untouched and returns
    // false, so the caller (POST /folder-visibility) can refuse instead of optimistically claiming
    // a "hidden" state that was never written (a false badge/enforcement desync).
    return mutateSettingsStringMap(
        vault,
        'folderVisibility',
        key,
        visibility === 'chat-only' || visibility === 'hidden'
            ? visibility
            : undefined,
    )
}

// The typed, file-merged-over-defaults config the backend reads at runtime (layout
// forces, file-watch debounce, SRS scheduler, …). Same merge as the frontend feed,
// just named + typed for backend consumers. Only the sections the backend actually
// reads are typed here; the full shape is the schema-derived DEFAULTS. The `srs`
// section is an identity match for SrsConfig (see scheduler.ts).
export interface AppConfig {
    server: { fileWatchDebounceMs: number; sseHeartbeatMs: number }
    daemon: { enabled: boolean; inboxRetentionDays: number }
    templates?: { folder: string }
    srs: SrsConfig
    googleCalendar?: {
        enabled: boolean
        calendarId: string
        basePath: string
        conflictPolicy: 'lastWriteWins' | 'googleWins' | 'bismuthWins'
        syncIntervalMinutes: number
        timeZone: string
    }
    // Other schema sections (graph, appearance, ui, …) are present at runtime but
    // not read by the backend; expose them loosely so callers can reach them.
    [section: string]: unknown
}

/** Load the backend runtime config (settings.yaml merged over DEFAULTS). */
export async function loadAppConfig(vault: string): Promise<AppConfig> {
    return (await serializeSettingsForFrontend(vault)) as unknown as AppConfig
}
