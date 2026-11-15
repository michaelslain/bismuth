// What the source vault holds, counted for the report's Inventory section. Pure.
import { fenceInfoPerLine } from './textFences'
import type { ImportContext, VaultText } from './types'

const TASK_BULLET = /^\s*[-*+]\s\[.\]/
const TASK_NUMBERED = /^\s*\d+[.)]\s\[.\]/

export function inventory(
    files: VaultText,
    ctx: ImportContext,
): Array<{ label: string; count: number | string }> {
    let notes = 0
    let tasks = 0
    let numbered = 0
    const fences = new Map<string, number>()
    for (const [path, text] of files) {
        if (!path.endsWith('.md')) continue
        notes++
        const lines = text.split('\n')
        const info = fenceInfoPerLine(lines)
        lines.forEach((line, i) => {
            const f = info[i]
            if (f !== null) {
                if (i === 0 || info[i - 1] === null) {
                    const lang = f.trim().split(/\s+/)[0].toLowerCase()
                    if (['tasks', 'base', 'dataview', 'dataviewjs'].includes(lang))
                        fences.set(lang, (fences.get(lang) ?? 0) + 1)
                }
                return
            }
            if (TASK_BULLET.test(line)) tasks++
            else if (TASK_NUMBERED.test(line)) numbered++
        })
    }
    const ext = (e: string) => ctx.allPaths.filter(p => p.endsWith(e)).length
    const rows: Array<{ label: string; count: number | string }> = [
        { label: 'notes', count: notes },
        { label: 'bases', count: ext('.base') },
        { label: 'canvases', count: ext('.canvas') },
        { label: 'other files', count: ctx.allPaths.filter(p => !p.endsWith('.md') && !p.endsWith('.base') && !p.endsWith('.canvas')).length },
        { label: 'checkbox tasks', count: tasks },
        { label: 'numbered checkbox tasks', count: numbered },
    ]
    for (const lang of ['tasks', 'base', 'dataview', 'dataviewjs'])
        rows.push({ label: `${lang} blocks`, count: fences.get(lang) ?? 0 })
    rows.push({ label: 'community plugins', count: ctx.config.plugins.length })
    return rows
}
