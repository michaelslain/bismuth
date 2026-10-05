// Human rendering of a DoctorReport. The exact strings are the contract in the plan's Acceptance.
import type { DoctorReport, Severity } from './types'

const MARK: Record<Severity, string> = {
    error: '✗',
    warn: '!',
    info: '·',
    ok: '✓',
}

/** Widest padded id column; a longer id prints as-is and does not widen the other rows. */
export const ID_COLUMN_MAX = 32
/** How many items a collapsed finding's detail names before `+<n> more`. */
export const DETAIL_ITEMS_MAX = 10

/** One item per line, the first DETAIL_ITEMS_MAX, then `+<n> more`. */
export function itemLines(items: string[]): string {
    const shown = items.slice(0, DETAIL_ITEMS_MAX)
    if (items.length > shown.length)
        shown.push(`+${items.length - shown.length} more`)
    return shown.join('\n')
}

export function formatDoctorReport(report: DoctorReport): string {
    const lines: string[] = []
    if (report.findings.length === 0) {
        lines.push('bismuth doctor // all clear')
        if (!report.vault)
            lines.push('vault checks skipped // pass --vault <path>')
    } else {
        const n = report.findings.length
        lines.push(
            `bismuth doctor // ${n} findings // ${report.pending.destructive} need consent`,
        )
        const width = Math.min(
            ID_COLUMN_MAX,
            Math.max(...report.findings.map(f => f.id.length)),
        )
        for (const f of report.findings) {
            let line = `${MARK[f.severity]} ${f.id.padEnd(width)}  ${f.title}`
            if (f.repair) {
                line += `  -> ${f.repair.description} [${f.repair.risk}]`
                if (f.repair.status === 'applied') line += ' // fixed'
                else if (f.repair.status === 'failed')
                    line += ` // failed: ${f.repair.warnings?.[0] ?? 'unknown error'}`
            }
            lines.push(line)
        }
        const k = report.pending.safe + report.pending.destructive
        if (k > 0) lines.push(`run bismuth doctor --fix to apply ${k} repairs`)
    }
    for (const id of report.unknownIds) lines.push(`unknown id: ${id}`)
    return lines.join('\n')
}
