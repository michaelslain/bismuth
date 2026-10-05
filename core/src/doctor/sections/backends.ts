// Agent-backend section: reuses the read-only `bismuth backends` probe and flags only what a
// person can act on — a CLI that is installed but not answering, or no `claude` at all.
import { checkBackends, type BackendReport } from '../../agentBackends/doctor'
import type { DoctorSection, Finding } from '../types'

/** Pure: project probe reports into findings. Adapters and healthy backends yield nothing. */
export function backendFindings(reports: BackendReport[]): Finding[] {
    const out: Finding[] = []
    for (const r of reports) {
        if (r.adapterPackage) continue
        if (r.installed && r.problem) {
            out.push({
                id: `backends.${r.id}`,
                severity: 'warn',
                title: `${r.label} installed but not answering`,
                detail: r.problem,
            })
        } else if (r.id === 'claude' && !r.installed) {
            out.push({
                id: 'backends.claude',
                severity: 'warn',
                title: 'claude not found on PATH',
                detail: r.installHint,
            })
        }
    }
    return out
}

export const backendsSection: DoctorSection = {
    id: 'backends',
    title: 'agent backends',
    check: async () => backendFindings(await checkBackends()),
}
