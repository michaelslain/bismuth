// Report-only scan for Obsidian syntax no step converts. Pure; never edits a file.
// docs/guides/converting-obsidian-to-bismuth/other-syntax.md is the format reference.
import { findFences, fenceInfoPerLine } from './textFences'
import type { ImportContext, ReportArea, ReportItem, ReportSection, VaultText } from './types'

const HANDLED_PLUGINS = new Set([
    'obsidian-tasks-plugin',
    'obsidian-spaced-repetition',
    'dataview',
    'templater-obsidian',
    'obsidian-excalidraw-plugin',
    'obsidian-icon-folder',
])
// Bismuth's callout types and aliases (app/src/editor/callout.ts).
const CALLOUTS = new Set(
    'note tip success question warning failure danger bug example quote abstract todo important info hint check done help faq caution fail error cite summary tldr'.split(
        ' ',
    ),
)
const SIMPLE_DATAVIEW = /^(LIST|TABLE)\b(?:(?!\bWHERE\b)[^\n])*?\bFROM\s+(?:#[^\s]+|"[^"]+")$/i

const quote = (s: string) => `"${s.trim()}"`

/** The vault folders that hold templates: Templater's `templates_folder` and the core Templates
 *  plugin's `folder`, without leading or trailing slashes. */
function templateFoldersOf(ctx: ImportContext): string[] {
    const templater = ctx.config.pluginData['templater-obsidian'] as Record<string, unknown> | undefined
    return [templater?.templates_folder, ctx.config.templates?.folder]
        .filter((f): f is string => typeof f === 'string' && f.trim() !== '')
        .map(f => f.trim().replace(/^\/+|\/+$/g, ''))
}

function inFolder(path: string, folders: string[]): boolean {
    return folders.some(f => path.startsWith(f + '/'))
}

export function scanUnconverted(files: VaultText, ctx: ImportContext): ReportItem[] {
    const items: ReportItem[] = []
    const push = (section: ReportSection, area: ReportArea, path: string, detail: string) =>
        items.push({ section, area, path, detail })
    const all = new Set(ctx.allPaths)
    const companions: string[] = []
    const templatesFolders = templateFoldersOf(ctx)

    for (const p of ctx.allPaths) {
        if (p.endsWith('.canvas'))
            push('decide', 'drawings', p, `canvas is not shown in Bismuth; export an image of it from Obsidian and embed it, or redraw it as a drawing: ${quote(p)}`)
    }

    for (const [path, text] of files) {
        if (!path.endsWith('.md')) continue
        if (path.endsWith('.excalidraw.md'))
            push('decide', 'drawings', path, `Excalidraw drawing shows as raw text; export an image from Obsidian (or turn on the plugin's auto-export) and embed it: ${quote(path)}`)
        const companion = /^(.+\.[A-Za-z0-9]+)\.md$/.exec(path)
        if (companion && !companion[1].endsWith('.md') && all.has(companion[1])) companions.push(path)

        const lines = text.split('\n')
        const inFence = fenceInfoPerLine(lines)

        for (const f of findFences(lines)) {
            const first = quote(f.body.find(l => l.trim()) ?? '')
            const lang = f.info.split(/\s/)[0].toLowerCase()
            if (lang === 'dataview') {
                const q = f.body.join(' ').trim().replace(/\s+/g, ' ')
                if (SIMPLE_DATAVIEW.test(q))
                    push('left', 'queries', path, `simple dataview query left as a code block: ${first}`)
                else push('decide', 'queries', path, `dataview query is not live in Bismuth: ${first}`)
            } else if (lang === 'dataviewjs')
                push('decide', 'queries', path, `dataviewjs block does not run in Bismuth: ${first}`)
            else if (lang === 'mermaid')
                push('left', 'syntax', path, `mermaid diagram shows as code: ${first}`)
        }

        lines.forEach((line, i) => {
            const code = inFence[i] !== null
            if (!code) {
                for (const m of line.matchAll(/`(=[^`\n]+)`/g))
                    push('decide', 'queries', path, `inline dataview expression: ${quote('`' + m[1] + '`')}`)
                for (const m of line.matchAll(/!\[\[([^\]|]+\.canvas)(?:\|[^\]]*)?\]\]/g))
                    push('decide', 'drawings', path, `canvas embed: ${quote(m[0])}`)
                const c = /^\s*(?:>\s*)+\[!([^\]\s]+)\]/.exec(line)
                if (c && !CALLOUTS.has(c[1].toLowerCase()))
                    push('left', 'syntax', path, `custom callout type renders as note: ${quote(line)}`)
            }
        })

        const seen = new Set<string>()
        const tags: string[] = []
        for (const m of text.matchAll(/<%[\s\S]*?%>/g)) {
            const startLine = text.slice(0, m.index).split('\n').length - 1
            if (inFence[startLine] !== null) continue
            const first = m[0].split('\n')[0]
            if (seen.has(m.index + first)) continue
            seen.add(m.index + first)
            tags.push(first)
        }
        // A file in the Templater templates folder is a template: its code is meant to stay code
        // until Templater runs it, so the file gets one `left` line. Anywhere else, each tag is
        // text Obsidian expanded and Bismuth shows raw, which a person has to decide about.
        if (tags.length && inFolder(path, templatesFolders))
            push('left', 'syntax', path, `Templater template, its ${tags.length} tag(s) stay as code: ${quote(tags[0])}`)
        else for (const t of tags) push('decide', 'syntax', path, `templater code is not expanded: ${quote(t)}`)
    }

    if (companions.length) {
        const first = companions.slice(0, 5).join(', ')
        push(
            'defaults',
            'syntax',
            '',
            `${companions.length} notes named <file>.<ext>.md sit beside their image or PDF and become its companion note, which holds its tags and properties: ${first}${companions.length > 5 ? ', …' : ''}`,
        )
    }

    for (const id of ctx.config.plugins)
        if (!HANDLED_PLUGINS.has(id))
            push('decide', 'plugins', '', `plugin ${id}: its syntax and data were left as is`)
    return items
}
