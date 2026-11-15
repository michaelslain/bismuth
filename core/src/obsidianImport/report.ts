// The conversion report: a deterministic markdown rendering of every step's items. Pure.
import type { ReportArea, ReportItem, ReportSection } from './types'

const SECTIONS: Array<{ section: ReportSection; title: string }> = [
    { section: 'decide', title: 'Needs a decision' },
    { section: 'converted', title: 'Converted' },
    { section: 'lossy', title: 'Lossy' },
    { section: 'defaults', title: 'Defaults taken' },
    { section: 'left', title: 'Left as is' },
]

const byKey = (a: ReportItem, b: ReportItem) =>
    a.area.localeCompare(b.area) ||
    a.path.localeCompare(b.path) ||
    a.detail.localeCompare(b.detail)

function group(items: ReportItem[], headings = true): string[] {
    if (!items.length) return ['none']
    if (!headings) return [...items].sort(byKey).map(it => `- ${it.path || '(vault)'}: ${it.detail}`)
    const lines: string[] = []
    let area: ReportArea | null = null
    for (const it of [...items].sort(byKey)) {
        if (it.area !== area) {
            if (area !== null) lines.push('')
            lines.push(`### ${it.area}`, '')
            area = it.area
        }
        lines.push(`- ${it.path || '(vault)'}: ${it.detail}`)
    }
    return lines
}

/** Validation items live under `## Validation`; a failed check (section `decide`) is also listed
 *  under `## Needs a decision`, because it is the reader's work. */
export function renderReport(r: {
    source: string
    out: string
    inventory: Array<{ label: string; count: number | string }>
    items: ReportItem[]
}): string {
    const out: string[] = [
        '# Obsidian import report',
        '',
        `Source vault: ${r.source.split('/').filter(Boolean).pop() ?? r.source}`,
        '',
    ]
    for (const { section, title } of SECTIONS) {
        const items = r.items.filter(
            i => i.section === section && (i.area !== 'validation' || section === 'decide'),
        )
        out.push(`## ${title}`, '', ...group(items), '')
    }
    out.push('## Validation', '', ...group(r.items.filter(i => i.area === 'validation'), false), '')
    out.push('## Inventory', '')
    out.push(...(r.inventory.length ? r.inventory.map(i => `- ${i.label}: ${i.count}`) : ['none']), '')
    return out.join('\n')
}
