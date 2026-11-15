// Obsidian `.obsidian/*.json` → Bismuth `.settings` keys. Pure: the CLI step reads the config
// and writes the result with setSettingInFile / setFolderIcon.
import type { ObsidianConfig, ReportItem, ReportSection } from './types'

export type MappedSetting = { path: string[]; value: unknown }
export type MappedFolderIcon = { folder: string; icon: string }
export type MappedSettings = {
    settings: MappedSetting[]
    folderIcons: MappedFolderIcon[]
    items: ReportItem[]
}

// The tokens core/src/templates.ts formatDate understands (docs/templates/syntax.md).
export const FORMAT_TOKENS = new Set([
    'YYYY', 'YY', 'MMMM', 'MMM', 'MM', 'M', 'DD', 'D', 'dddd', 'ddd',
    'HH', 'H', 'hh', 'h', 'mm', 'm', 'ss', 's', 'A', 'a',
])

const ICONIZE_ID = 'obsidian-icon-folder'

const isString = (v: unknown): v is string => typeof v === 'string'

/** True when a letter run splits greedily (longest token first) into supported tokens only. */
function splitsIntoTokens(run: string): boolean {
    let i = 0
    while (i < run.length) {
        let hit = 0
        for (let n = Math.min(4, run.length - i); n > 0; n--) {
            if (FORMAT_TOKENS.has(run.slice(i, i + n))) {
                hit = n
                break
            }
        }
        if (!hit) return false
        i += hit
    }
    return true
}

/** Bad letter runs in a Moment format, or [] when every letter run is made of Bismuth tokens. */
function unsupportedRuns(format: string): string[] {
    const bad: string[] = []
    for (const run of format.match(/[A-Za-z]+/g) ?? []) {
        if (!splitsIntoTokens(run)) bad.push(run)
    }
    return bad
}

/** An Iconize icon name as a Bismuth icon (Lucide name or emoji), or null. */
function bismuthIcon(name: string): string | null {
    const n = name.trim()
    if (!n) return null
    // emoji or any non-ASCII glyph passes through
    if (/[^\x00-\x7f]/.test(n)) return n
    // Iconize prefixes each pack: `Lu` is Lucide, the pack Bismuth shows
    const lu = /^Lu([A-Z][A-Za-z0-9]*)$/.exec(n)
    if (lu) return lu[1]
    return null
}

export function mapSettings(config: ObsidianConfig): MappedSettings {
    const settings: MappedSetting[] = []
    const folderIcons: MappedFolderIcon[] = []
    const items: ReportItem[] = []
    const add = (section: ReportSection, path: string, detail: string) =>
        items.push({ section, area: 'settings', path, detail })

    if (!config.present) {
        add('defaults', '', 'no .obsidian folder: settings defaults apply')
        return { settings, folderIcons, items }
    }

    const app = config.app
    if (app) {
        const file = '.obsidian/app.json'
        const att = app.attachmentFolderPath
        if (isString(att)) {
            if (att === '/') settings.push({ path: ['attachments', 'folder'], value: '' })
            else if (att === './') settings.push({ path: ['attachments', 'folder'], value: '.' })
            else if (att.startsWith('./')) {
                add(
                    'lossy',
                    file,
                    `attachmentFolderPath "${att}" (a subfolder next to each note) has no Bismuth equivalent: new attachments use the default folder`,
                )
            } else if (att.replace(/\/+$/, '') !== '') {
                settings.push({
                    path: ['attachments', 'folder'],
                    value: att.replace(/\/+$/, ''),
                })
            }
        }
        const flags: Array<[string, string]> = [
            ['livePreview', 'livePreview'],
            ['showLineNumber', 'lineNumbers'],
            ['spellcheck', 'spellcheck'],
        ]
        for (const [from, to] of flags) {
            if (typeof app[from] === 'boolean') {
                settings.push({ path: ['editor', to], value: app[from] })
            }
        }
        const filters = app.userIgnoreFilters
        if (Array.isArray(filters) && filters.length > 0) {
            add(
                'lossy',
                file,
                `userIgnoreFilters ${JSON.stringify(filters)} has no Bismuth setting: those paths still show in the tree and search`,
            )
        }
        for (const key of ['newFileLocation', 'useMarkdownLinks', 'alwaysUpdateLinks']) {
            if (app[key] !== undefined) {
                add(
                    'lossy',
                    file,
                    `${key} (${JSON.stringify(app[key])}) has no Bismuth setting`,
                )
            }
        }
    }

    const tpl = config.templates
    if (tpl && isString(tpl.folder) && tpl.folder.replace(/\/+$/, '') !== '') {
        settings.push({
            path: ['templates', 'folder'],
            value: tpl.folder.replace(/\/+$/, ''),
        })
    }

    const daily = config.dailyNotes
    if (daily) {
        const file = '.obsidian/daily-notes.json'
        let format = isString(daily.format) && daily.format.trim() ? daily.format : 'YYYY-MM-DD'
        const bad = unsupportedRuns(format)
        let fileName: string
        if (bad.length > 0) {
            fileName = '{{date}}'
            add(
                'lossy',
                file,
                `format "${format}" uses tokens Bismuth lacks (${bad.join(', ')}): file name falls back to {{date}} (YYYY-MM-DD)`,
            )
        } else {
            if (format.includes('/')) {
                add(
                    'lossy',
                    file,
                    `format "${format}" has slashes (nested folders): flattened to "${format.replace(/\//g, '-')}"`,
                )
                format = format.replace(/\//g, '-')
            }
            fileName = `{{date:${format}}}`
        }
        const item: Record<string, string> = {
            id: 'daily',
            label: 'Daily',
            icon: 'calendar',
            folder: isString(daily.folder) ? daily.folder.replace(/\/+$/, '') : '',
            fileName,
        }
        if (isString(daily.template) && daily.template.trim()) {
            const t = daily.template.trim()
            item.template = t.endsWith('.md') ? t : `${t}.md`
        }
        settings.push({ path: ['dailyNotes'], value: [item] })
    }

    if (config.appearance) {
        const file = '.obsidian/appearance.json'
        add('lossy', file, 'appearance.json (theme, fonts, accent colour) is not mapped: Bismuth keeps its own theme')
        const snippets = config.appearance.enabledCssSnippets
        if (Array.isArray(snippets) && snippets.length > 0) {
            add('lossy', file, `CSS snippets ${JSON.stringify(snippets)} do not carry over`)
        }
    }

    const iconData = config.pluginData[ICONIZE_ID]
    if (iconData && typeof iconData === 'object' && !Array.isArray(iconData)) {
        for (const [folder, icon] of Object.entries(iconData as Record<string, unknown>)) {
            if (folder === 'settings') continue // Iconize's own options, not a folder
            const name = isString(icon)
                ? icon
                : icon && typeof icon === 'object' && isString((icon as { iconName?: unknown }).iconName)
                  ? (icon as { iconName: string }).iconName
                  : null
            if (name === null) {
                add('lossy', folder, `folder icon for "${folder}" has no readable icon name: "${folder}" gets no icon`)
                continue
            }
            const mapped = bismuthIcon(name)
            if (mapped) folderIcons.push({ folder, icon: mapped })
            else {
                add(
                    'lossy',
                    folder,
                    `folder icon "${name}" is not a Lucide icon or emoji Bismuth can show: "${folder}" gets no icon`,
                )
            }
        }
    }

    return { settings, folderIcons, items }
}
