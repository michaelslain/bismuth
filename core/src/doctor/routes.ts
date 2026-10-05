// The doctor's HTTP surface, kept pure so it is testable without booting the server (a real boot
// would run the real doctor against the real home). server.ts wires these into its READ routes,
// owner-gated; localBackend answers 501.
import { runDoctor } from './run'
import { defaultContext } from './context'
import { DEFAULT_SECTIONS } from './sections'
import type { DoctorContext, DoctorOptions, DoctorReport } from './types'

export interface DoctorRouteDeps {
    run: typeof runDoctor
    context: (opts: { vault?: string }) => DoctorContext
}

const realDeps: DoctorRouteDeps = { run: runDoctor, context: defaultContext }

/**
 * Body of `POST /doctor/fix` → engine options. `{ only?: string[] }`; an absent `only` means every
 * pending repair, both risks. A MALFORMED `only` returns undefined (the route answers 400) rather
 * than being dropped, because dropping it would widen "fix these two" into "fix everything".
 */
export function doctorFixOptions(body: unknown): DoctorOptions | undefined {
    if (body === null || body === undefined) return { fix: true }
    if (typeof body !== 'object' || Array.isArray(body)) return undefined
    const only = (body as { only?: unknown }).only
    if (only === undefined) return { fix: true }
    if (!Array.isArray(only) || !only.every(x => typeof x === 'string'))
        return undefined
    return { fix: true, only: only as string[] }
}

/** `GET /doctor`: a dry run over this server's vault. */
export function doctorDryRun(
    vault: string,
    deps: DoctorRouteDeps = realDeps,
): Promise<DoctorReport> {
    return deps.run(deps.context({ vault }), {})
}

/** `POST /doctor/fix`: apply `opts` (from doctorFixOptions) over this server's vault. */
export function doctorApply(
    vault: string,
    opts: DoctorOptions,
    deps: DoctorRouteDeps = realDeps,
): Promise<DoctorReport> {
    return deps.run(deps.context({ vault }), opts)
}

/**
 * Boot's options: safe repairs only, and every section but `vault`. Boot already runs the vault's
 * own migrations (task migration, settings reconcile) itself, so a doctor vault pass racing them
 * would contend on the git index lock, rewrite files twice and ignore BISMUTH_NO_TASK_MIGRATE.
 */
export function bootDoctorOptions(): DoctorOptions {
    return {
        fix: true,
        risks: ['safe'],
        sections: DEFAULT_SECTIONS.map(s => s.id).filter(id => id !== 'vault'),
    }
}

/**
 * Boot's repair pass: safe repairs only, destructive ones stay pending for the owner's toast.
 * Never throws. Returns the log lines (so the caller owns the console and tests can read them).
 */
export async function bootDoctor(
    vault: string | undefined,
    deps: DoctorRouteDeps = realDeps,
): Promise<string[]> {
    try {
        const report = await deps.run(
            deps.context({ vault }),
            bootDoctorOptions(),
        )
        const lines = [
            `bismuth doctor: fixed ${report.fixed}, ${report.pending.destructive} waiting for consent`,
        ]
        for (const f of report.findings)
            if (f.repair?.status === 'failed')
                lines.push(
                    `bismuth doctor: ${f.id} failed: ${f.repair.warnings?.[0] ?? 'unknown error'}`,
                )
        return lines
    } catch (e) {
        return [
            `bismuth doctor failed: ${e instanceof Error ? e.message : String(e)}`,
        ]
    }
}
