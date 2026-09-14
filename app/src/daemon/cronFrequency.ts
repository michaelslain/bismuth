// app/src/daemon/cronFrequency.ts
// Moved verbatim from app/src/DaemonList.tsx (Task 5 — DaemonList itself is deleted): converts a
// 5-part cron expression to a short human-readable frequency string, e.g. "*/5 * * * *" → "every
// 5m". Pure, no Solid imports — see cronFrequency.test.ts.
export default function cronFrequency(expr: string): string {
    if (!expr) return ''
    const parts = expr.trim().split(/\s+/)
    if (parts.length < 5) return expr
    const [min, hour, dom, , dow] = parts

    // Every N minutes: */N * * * *
    if (min.startsWith('*/') && hour === '*' && dom === '*' && dow === '*') {
        const n = parseInt(min.slice(2))
        return n === 1 ? 'every min' : `every ${n}m`
    }
    // Every minute: * * * * *
    if (min === '*' && hour === '*' && dom === '*' && dow === '*')
        return 'every min'
    // Every N hours: 0 */N * * *
    if (min === '0' && hour.startsWith('*/') && dom === '*' && dow === '*') {
        const n = parseInt(hour.slice(2))
        return n === 1 ? 'hourly' : `every ${n}h`
    }
    // Hourly: 0 * * * *
    if (min === '0' && hour === '*' && dom === '*' && dow === '*')
        return 'hourly'
    // Every N days: M H */N * *
    if (dom.startsWith('*/') && dow === '*') {
        const n = parseInt(dom.slice(2))
        return n === 1 ? 'daily' : `every ${n}d`
    }
    // Daily: 0 H * * *  or  H H * * *
    if (
        dom === '*' &&
        dow === '*' &&
        !hour.includes('*') &&
        !hour.includes('/') &&
        !min.includes('*') &&
        !min.includes('/')
    )
        return 'daily'
    // Weekly: specific day of week
    if (dow !== '*' && !dow.includes('*') && !dow.includes('/')) return 'weekly'
    // Monthly: specific day of month
    if (dom !== '*' && !dom.includes('*') && !dom.includes('/') && dow === '*')
        return 'monthly'
    return expr
}
