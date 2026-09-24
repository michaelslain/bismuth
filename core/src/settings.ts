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
import { parse, parseDocument, Document, YAMLMap, isMap, isScalar } from 'yaml'
import { readNote, writeNote } from './files'
import { loadRegistry, BUILTIN_PROPERTIES } from './schema/registry'
import { SETTINGS_SCHEMA, DEFAULTS } from './schema/settingsSchema'
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
    let data: Record<string, unknown> = {}
    let parseError: string | undefined
    try {
        const parsed = parse(raw)
        if (parsed && typeof parsed === 'object')
            data = parsed as Record<string, unknown>
    } catch (e) {
        data = {} // corrupt file degrades to empty — callers fall back to defaults
        parseError = e instanceof Error ? e.message : String(e)
    }
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

/** Build a YAMLMap from a Schema, materializing defaults. No comments — settings
 *  are discovered via the editor's Ctrl-Space autocomplete, not inline docs. */
function schemaToMap(doc: Document, schema: Schema): YAMLMap {
    const map = new YAMLMap()
    for (const [key, entry] of Object.entries(schema) as [
        string,
        SchemaEntry,
    ][]) {
        let valueNode
        if (typeof entry.type === 'object' && entry.type.kind === 'object') {
            valueNode = schemaToMap(doc, entry.type.fields)
        } else {
            valueNode = doc.createNode(entry.default ?? null)
        }
        map.items.push(doc.createPair(key, valueNode))
    }
    return map
}

/** On first launch, write a clean (comment-free) settings.yaml from SETTINGS_SCHEMA. No-op if present. */
export async function initializeSettings(vault: string): Promise<void> {
    const full = join(vault, SETTINGS_FILE)
    if (await Bun.file(full).exists()) return
    const doc = new Document()
    doc.contents = schemaToMap(doc, SETTINGS_SCHEMA)
    await writeNote(
        vault,
        SETTINGS_FILE,
        doc.toString({ flowCollectionPadding: false }),
    )
}

/** Insert default nodes for any schema path missing from `map`. Returns true if mutated.
 *  Recurses into object-typed entries; preserves existing values, comments, and any
 *  keys not present in the schema (unknown keys are never touched). */
function fillMissing(doc: Document, map: YAMLMap, schema: Schema): boolean {
    let mutated = false
    for (const [key, entry] of Object.entries(schema) as [
        string,
        SchemaEntry,
    ][]) {
        const isObj =
            typeof entry.type === 'object' && entry.type.kind === 'object'
        if (!map.has(key)) {
            if (isObj) {
                const child = new YAMLMap()
                fillMissing(
                    doc,
                    child,
                    (entry.type as { kind: 'object'; fields: Schema }).fields,
                )
                map.set(key, child)
            } else {
                map.set(key, doc.createNode(entry.default ?? null))
            }
            mutated = true
        } else if (isObj) {
            const child = map.get(key, true)
            if (isMap(child)) {
                mutated =
                    fillMissing(
                        doc,
                        child as YAMLMap,
                        (entry.type as { kind: 'object'; fields: Schema })
                            .fields,
                    ) || mutated
            }
        }
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
        ['appearance', 'toolbarIconSize'],
        ['appearance', 'paletteInputFontSize'],
        ['appearance', 'monoScale'],
        ['appearance', 'sidebarWidth'],
        ['editor', 'lineHeight'],
    ]
    const defaults = DEFAULTS as Record<
        string,
        Record<string, unknown> | undefined
    >
    for (const [section, key] of RESET_PATHS) {
        const def = defaults[section]?.[key]
        if (def !== undefined) doc.setIn([section, key], def)
    }
    return true
}

// Schema keys removed from SETTINGS_SCHEMA that a persisted `.settings` may still carry from an
// older Bismuth. Each entry is a full path (section, ..., leaf key); pruneRetiredKeys below deletes
// whichever of these are still present on reconcile, so a retired key doesn't linger forever once
// nothing reads it. `appearance.editorFont` is deleted outright here, for every saved value —
// never translated into `uiFont`, since the two have always defaulted to the same thing and every
// shipped value was already a Monaspace variant (see migrateLegacyAppearance's doc comment above).
const RETIRED_KEYS: readonly (readonly string[])[] = [
    ['editor', 'defaultMode'],
    ['appearance', 'editorFont'],
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
// runs FIRST in reconcileSettings — before fillMissing — because fillMissing would otherwise see
// the new key missing and seed it from the schema default, discarding the user's old value.
const RENAMED_KEYS: readonly { from: readonly string[]; to: string }[] = [
    { from: ['appearance', 'sidebarIconFontSize'], to: 'toolbarIconSize' },
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

/**
 * Delete any RETIRED_KEYS pair still present in `doc`. A hand-written comment sitting directly
 * above a removed key is not dropped with it: it is carried onto the key that now takes its place
 * in the section, or — if the removed key was the section's last — onto the section itself, so it
 * still survives the rewrite (`fillMissing`'s "unknown keys are never touched" doesn't apply here,
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
 * On open: add any missing schema defaults to settings.yaml, preserving comments,
 * key order, user values, and unknown keys. Absent file → write full defaults.
 * Corrupt/empty file → left untouched. Writes only when something actually changed,
 * so an already-complete file produces no spurious write / SSE churn. Driven entirely
 * by SETTINGS_SCHEMA, so adding or removing a schema entry self-reconciles next open.
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
    const renamed = renameKeys(doc) // must run BEFORE fillMissing, or it seeds the new key's default
    const filled = fillMissing(doc, doc.contents as YAMLMap, SETTINGS_SCHEMA)
    const migrated = migrateDaemonConfig(doc)
    const migratedAppearance = migrateLegacyAppearance(doc)
    const pruned = pruneRetiredKeys(doc)
    if (renamed || filled || migrated || migratedAppearance || pruned) {
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
 * is fully shaped. This is the backend's single write path for settings, so a
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
        await reconcileSettings(vault) // ensure the file exists + is shaped
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
 * delivered separately (GET /schema) and excluded here.
 */
export async function serializeSettingsForFrontend(
    vault: string,
): Promise<Record<string, unknown>> {
    const out = structuredClone(DEFAULTS) as Record<
        string,
        Record<string, unknown>
    >
    const res = await readSettings(vault)
    const data = res?.data ?? {}
    for (const section of Object.keys(out)) {
        // folderIcons is a free-form map, not a fixed key set — pass the whole stored
        // map through (the per-key typeof overlay below only handles known leaves).
        if (section === 'folderIcons') {
            ;(out as Record<string, unknown>).folderIcons =
                readFolderIconsFrom(data)
            continue
        }
        if (section === 'folderVisibility') {
            ;(out as Record<string, unknown>).folderVisibility =
                readFolderVisibilityFrom(data)
            continue
        }
        if (section === 'toolbar' || section === 'tabBar') {
            // Both are button lists with the same item shape — read the user's array as-is (the generic
            // per-index overlay below would leave a removed button's slot as the DEFAULT's item at that
            // index, duplicating it: the [+][💬][💬]-when-terminal-removed bug).
            ;(out as Record<string, unknown>)[section] = readButtonListFrom(
                data,
                section,
            )
            continue
        }
        if (section === 'dailyNotes') {
            ;(out as Record<string, unknown>).dailyNotes =
                readDailyNotesFrom(data)
            continue
        }
        const stored = data[section]
        if (!stored || typeof stored !== 'object') continue
        const target = out[section]
        // Each top-level section is an object-typed SchemaEntry; its leaf fields live
        // under `type.fields`, so resolve the per-key schema from there (not off the
        // section entry directly) for the min/max/enum clamps to fire.
        const sectionEntry = SETTINGS_SCHEMA[
            section as keyof typeof SETTINGS_SCHEMA
        ] as SchemaEntry | undefined
        const sectionType = sectionEntry?.type
        const fields =
            sectionType &&
            typeof sectionType === 'object' &&
            sectionType.kind === 'object'
                ? sectionType.fields
                : undefined
        for (const key of Object.keys(target)) {
            const v = (stored as Record<string, unknown>)[key]
            if (Array.isArray(target[key])) {
                // List-typed leaf (e.g. editor.wrapSelectionChars): typeof "object" matches both
                // arrays and plain objects, so a bare typeof check can't reject a malformed value —
                // validate structurally instead and fall back to the default otherwise.
                if (Array.isArray(v) && v.every(el => typeof el === 'string'))
                    target[key] = v
                continue
            }
            if (typeof v !== typeof target[key]) continue
            const keySchema = fields?.[key]
            if (
                keySchema?.min !== undefined &&
                typeof v === 'number' &&
                v < keySchema.min
            )
                continue
            if (
                keySchema?.max !== undefined &&
                typeof v === 'number' &&
                v > keySchema.max
            )
                continue
            const keyType = keySchema?.type
            if (
                keyType &&
                typeof keyType === 'object' &&
                keyType.kind === 'enum' &&
                !keyType.values.includes(v as string)
            )
                continue
            target[key] = v
        }
    }
    delete (out as Record<string, unknown>).properties
    return out
}

/** Shared skeleton for the array-typed settings deserializers (`toolbar`/`tabBar`/`dailyNotes`):
 *  a missing/non-array value falls back to a fresh clone of the seeded default; otherwise each
 *  object item is passed through `mapItem` (non-objects dropped) and kept when it returns a value. */
function readListFrom<T>(
    data: Record<string, unknown>,
    key: string,
    mapItem: (o: Record<string, unknown>) => T | null,
): T[] {
    const raw = data[key]
    if (!Array.isArray(raw))
        return structuredClone((DEFAULTS as any)[key]) as T[]
    const out: T[] = []
    for (const item of raw) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue
        const entry = mapItem(item as Record<string, unknown>)
        if (entry) out.push(entry)
    }
    return out
}

/** A serialized toolbar button: a single `command` OR a `commands` list, plus icon. */
type ToolbarItem = {
    command?: string
    commands?: string[]
    icon: string
    tooltip?: string
}

/** Pull a clean toolbar list out of parsed settings data. Each item must be an
 *  object with a non-empty string `icon` and either a non-empty string `command`
 *  or a non-empty `commands` list of non-empty strings (the latter wins when both
 *  are present, mirroring the runtime). Malformed items are dropped. An explicit
 *  array (even empty) is honored; a missing/non-array value falls back to the
 *  seeded defaults. */
/** Read a button-list section (`toolbar` OR `tabBar` — identical item shape) from parsed
 *  settings, honoring the user's array as-is (a shorter list is NOT index-padded with the
 *  default — that padding was the [+][💬][💬] bug where removing one button left the default's
 *  trailing button duplicated). A missing/non-array value falls back to the seeded default. */
function readButtonListFrom(
    data: Record<string, unknown>,
    section: 'toolbar' | 'tabBar',
): ToolbarItem[] {
    return readListFrom<ToolbarItem>(data, section, o => {
        if (typeof o.icon !== 'string' || o.icon.length === 0) return null
        const commands = Array.isArray(o.commands)
            ? o.commands.filter(
                  (c): c is string => typeof c === 'string' && c.length > 0,
              )
            : []
        const hasCommand = typeof o.command === 'string' && o.command.length > 0
        if (commands.length === 0 && !hasCommand) return null
        const entry: ToolbarItem =
            commands.length > 0
                ? { commands, icon: o.icon }
                : { command: o.command as string, icon: o.icon }
        if (typeof o.tooltip === 'string' && o.tooltip.length > 0)
            entry.tooltip = o.tooltip
        return entry
    })
}

/** Pull a clean dailyNotes list out of parsed settings data. Each item needs a
 *  non-empty string `id` and `fileName`; other fields default (label→id,
 *  icon→CalendarDays, folder/template→""). Malformed items are dropped; an explicit
 *  empty array is honored; a missing/non-array value falls back to the seeded default.
 *  Mirrors readToolbarFrom. */
function readDailyNotesFrom(data: Record<string, unknown>): DailyNoteConfig[] {
    const str = (v: unknown) => (typeof v === 'string' ? v : '')
    return readListFrom<DailyNoteConfig>(data, 'dailyNotes', o => {
        if (typeof o.id !== 'string' || o.id.length === 0) return null
        if (typeof o.fileName !== 'string' || o.fileName.length === 0)
            return null
        return {
            id: o.id,
            label: str(o.label) || o.id,
            icon: str(o.icon) || 'CalendarDays',
            folder: str(o.folder),
            fileName: o.fileName,
            template: str(o.template),
        }
    })
}

/** Shared skeleton for the string-map settings deserializers (`folderIcons`/`folderVisibility`):
 *  a non-array object value is walked entry-by-entry through `accept`, which returns the
 *  `[key, value]` pair to keep (allowing key normalization) or `null` to drop it; anything else → {}. */
function readStringMapFrom<V extends string>(
    data: Record<string, unknown>,
    key: string,
    accept: (k: string, v: unknown) => [string, V] | null,
): Record<string, V> {
    const raw = data[key]
    const out: Record<string, V> = {}
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
            const entry = accept(k, v)
            if (entry) out[entry[0]] = entry[1]
        }
    }
    return out
}

/** Pull a clean `{folderPath: iconName}` string map out of parsed settings data. */
function readFolderIconsFrom(
    data: Record<string, unknown>,
): Record<string, string> {
    return readStringMapFrom<string>(data, 'folderIcons', (k, v) =>
        typeof v === 'string' && v.length > 0 ? [k, v] : null,
    )
}

/** Read the per-folder icon map from settings.yaml. Absent file / section → {}. */
export async function readFolderIcons(
    vault: string,
): Promise<Record<string, string>> {
    const res = await readSettings(vault)
    if (!res) return {}
    return readFolderIconsFrom(res.data)
}

/** Pull a clean `{folderPath: "chat-only"|"hidden"}` map out of parsed settings data. */
/** Strip a trailing slash + collapse repeated slashes so a folder key matches the slash-free
 *  paths resolveVisibility compares against. A trailing slash is routine from shell/CLI tab-
 *  completion; without normalizing, such a key silently never enforces. Applied on both WRITE
 *  (setFolderVisibility) and READ (here) so keys already persisted with a slash still enforce. */
function normalizeFolderKey(k: string): string {
    return k.replace(/\/+$/, '').replace(/\/{2,}/g, '/')
}

function readFolderVisibilityFrom(
    data: Record<string, unknown>,
): Record<string, 'chat-only' | 'hidden'> {
    return readStringMapFrom<'chat-only' | 'hidden'>(
        data,
        'folderVisibility',
        (k, v) =>
            v === 'chat-only' || v === 'hidden'
                ? [normalizeFolderKey(k), v]
                : null,
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
