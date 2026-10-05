// The doctor engine: run every section, apply eligible repairs, build one sorted report.
// A section that throws never takes the run down — it becomes `<id>.check-failed` and the others go on.
import type {
    DoctorContext,
    DoctorOptions,
    DoctorReport,
    DoctorSection,
    Finding,
    FindingReport,
    Severity,
} from './types'
import { DEFAULT_SECTIONS } from './sections'

const SEVERITY_RANK: Record<Severity, number> = {
    error: 0,
    warn: 1,
    info: 2,
    ok: 3,
}

type Stamped = Finding & { section: string }

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

async function checkSection(
    s: DoctorSection,
    ctx: DoctorContext,
): Promise<Stamped[]> {
    let found: Finding[]
    try {
        found = await s.check(ctx)
    } catch (e) {
        found = [
            {
                id: `${s.id}.check-failed`,
                severity: 'error',
                title: `${s.title} check failed`,
                detail: message(e),
            },
        ]
    }
    return found.map(f => ({ ...f, section: s.id }))
}

export async function runDoctor(
    ctx: DoctorContext,
    opts: DoctorOptions = {},
    sections: DoctorSection[] = DEFAULT_SECTIONS,
): Promise<DoctorReport> {
    const chosen = sections.filter(
        s =>
            (!opts.sections || opts.sections.includes(s.id)) &&
            (!s.needsVault || ctx.vault),
    )
    const stamped = (
        await Promise.all(chosen.map(s => checkSection(s, ctx)))
    ).flat()
    stamped.sort(
        (a, b) =>
            Number(b.repair?.risk === 'destructive') -
                Number(a.repair?.risk === 'destructive') ||
            SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
            (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )

    let fixed = 0
    let failed = 0
    const pending = { safe: 0, destructive: 0 }
    const findings: FindingReport[] = []
    const repaired = new Set<string>()
    for (const f of stamped) {
        const report: FindingReport = {
            id: f.id,
            section: f.section,
            severity: f.severity,
            title: f.title,
            ...(f.detail !== undefined ? { detail: f.detail } : {}),
        }
        if (f.repair) {
            const r = f.repair
            report.repair = { risk: r.risk, description: r.description }
            const eligible =
                opts.fix &&
                (!opts.only || opts.only.includes(f.id)) &&
                (!opts.risks || opts.risks.includes(r.risk))
            if (eligible) {
                let warnings: string[]
                try {
                    warnings = await r.apply()
                } catch (e) {
                    warnings = [message(e)]
                }
                if (warnings.length === 0) {
                    report.repair.status = 'applied'
                    fixed++
                    repaired.add(f.id)
                } else {
                    report.repair.status = 'failed'
                    report.repair.warnings = warnings
                    failed++
                }
            } else if (opts.fix) {
                report.repair.status = 'skipped'
            }
            if (
                report.repair.status !== 'applied' &&
                report.repair.status !== 'failed'
            )
                pending[r.risk]++
        }
        findings.push(report)
    }

    const known = new Set(stamped.map(f => f.id))
    return {
        ok: !findings.some(
            f =>
                (f.severity === 'error' || f.severity === 'warn') &&
                !repaired.has(f.id),
        ),
        vault: ctx.vault ?? null,
        findings,
        fixed,
        failed,
        pending,
        unknownIds: (opts.only ?? []).filter(id => !known.has(id)),
    }
}
