// core/src/settingsSerialize.ts
// The PURE half of GET /settings: the raw `.settings` text + the vault's custom themes in, exactly
// what the app store seeds from out. No Bun / node:fs / files.ts imports, so the in-process
// (iPad) backend can use it as-is; settings.ts's serializeSettingsForFrontend is the Bun wrapper.
import { parse } from 'yaml'
import { DEFAULTS } from './schema/settingsSchema'
import { settingsSchemaFor } from './schema/themedSettingsSchema'
import { legacyTokens, parseTokenMap } from './theme/designTokens'
import type { SchemaEntry } from './schema/types'
import type { DailyNoteConfig } from './dailyNote'

/** Parse `.settings` text tolerantly: a non-object or malformed document is `{}`, with
 *  `parseError` set only for malformed YAML (see ReadSettingsResult.parseError). */
export function parseSettingsText(raw: string): {
    data: Record<string, unknown>
    parseError?: string
} {
    try {
        const parsed = parse(raw)
        if (parsed && typeof parsed === 'object')
            return { data: parsed as Record<string, unknown> }
        return { data: {} }
    } catch (e) {
        return { data: {}, parseError: e instanceof Error ? e.message : String(e) }
    }
}

/**
 * Merge the settings.yaml file over DEFAULTS via a per-key typeof check, so a
 * corrupt/partial file degrades to defaults. The `properties` registry is
 * delivered separately (GET /schema) and excluded here.
 */
export function serializeSettingsFromText(
    raw: string | null,
    customThemeNames: readonly string[],
): Record<string, unknown> {
    const out = structuredClone(DEFAULTS) as Record<
        string,
        Record<string, unknown>
    >
    const data = raw === null ? {} : parseSettingsText(raw).data
    // appearance.theme may name a valid custom theme in <vault>/.themes — validate against the
    // schema widened by those names instead of the static four-built-in enum.
    const themedSchema = settingsSchemaFor(customThemeNames)
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
        const sectionEntry = themedSchema[
            section as keyof typeof themedSchema
        ] as SchemaEntry | undefined
        const sectionType = sectionEntry?.type
        const fields =
            sectionType &&
            typeof sectionType === 'object' &&
            sectionType.kind === 'object'
                ? sectionType.fields
                : undefined
        for (const key of Object.keys(target)) {
            if (section === 'appearance' && key === 'tokens') continue // folded below
            const v = (stored as Record<string, unknown>)[key]
            if (Array.isArray(target[key])) {
                // List-typed leaf (e.g. editor.wrapSelectionChars): typeof "object" matches both
                // arrays and plain objects, so a bare typeof check can't reject a malformed value —
                // validate structurally instead and fall back to the default otherwise.
                const listType = fields?.[key]?.type
                const item =
                    listType && typeof listType === 'object' && listType.kind === 'list'
                        ? listType.item
                        : undefined
                if (
                    item &&
                    typeof item === 'object' &&
                    item.kind === 'object' &&
                    Array.isArray(v)
                ) {
                    // A list of objects (chat.presets): keep each object item, reduced to its
                    // schema's string-valued fields — a missing or non-string field reads as "",
                    // a non-object item is dropped. A string-only check here silently reset
                    // every such list to its default on read.
                    target[key] = v
                        .filter(
                            (el): el is Record<string, unknown> =>
                                !!el && typeof el === 'object' && !Array.isArray(el),
                        )
                        .map(el =>
                            Object.fromEntries(
                                Object.keys(item.fields).map(f => [
                                    f,
                                    typeof el[f] === 'string' ? el[f] : '',
                                ]),
                            ),
                        )
                    continue
                }
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
    // appearance.tokens: legacy settings folded in, an explicit token winning over its legacy key.
    // Only keys present in the file appear (validated + normalized); nothing is rewritten on disk.
    out.appearance.tokens = {
        ...legacyTokens(data),
        ...parseTokenMap(
            (data.appearance as Record<string, unknown> | undefined)?.tokens,
        ).tokens,
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
export function readDailyNotesFrom(data: Record<string, unknown>): DailyNoteConfig[] {
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
export function readFolderIconsFrom(
    data: Record<string, unknown>,
): Record<string, string> {
    return readStringMapFrom<string>(data, 'folderIcons', (k, v) =>
        typeof v === 'string' && v.length > 0 ? [k, v] : null,
    )
}

/** Strip a trailing slash + collapse repeated slashes so a folder key matches the slash-free
 *  paths resolveVisibility compares against. A trailing slash is routine from shell/CLI tab-
 *  completion; without normalizing, such a key silently never enforces. Applied on both WRITE
 *  (setFolderVisibility) and READ (here) so keys already persisted with a slash still enforce. */
export function normalizeFolderKey(k: string): string {
    return k.replace(/\/+$/, '').replace(/\/{2,}/g, '/')
}

/** Pull a clean `{folderPath: "chat-only"|"hidden"}` map out of parsed settings data. */
export function readFolderVisibilityFrom(
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
