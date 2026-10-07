// The launch-time doctor toast: when destructive repairs are waiting (boot already applied every
// safe one), ask the owner once. Pure of JSX — it imports toastStore, not Toast.tsx, so a headless
// test can drive it. Deps are injected so the test never touches the network.
import type { DoctorReport } from '../../core/src/doctor/types'
import { plural } from './plural'
import { dismissToast, pushToast, updateToast } from './ui/toastStore'

export type DoctorToastDeps = {
    getDoctor: () => Promise<DoctorReport>
    fixDoctor: (ids: string[]) => Promise<DoctorReport>
}

const SHOWN = 2 // titles named in the toast before the rest collapse to "+n more"
const ASK_TTL = 20_000
const DONE_TTL = 5_000

/** `doctor // 2 repairs need your ok: a, b` — more than two collapse to `a, b +2 more`. */
export function doctorToastMessage(titles: string[]): string {
    const n = titles.length
    const head = `doctor // ${plural(n, 'repair needs', 'repairs need')} your ok: `
    const named = titles.slice(0, SHOWN).join(', ')
    return n > SHOWN ? `${head}${named} +${n - SHOWN} more` : head + named
}

/** Show the consent toast once. Never throws: an erroring `/doctor` (mobile, an old core) just means
 *  no toast. */
export async function showDoctorToast(deps: DoctorToastDeps): Promise<void> {
    let report: DoctorReport
    try {
        report = await deps.getDoctor()
    } catch {
        return
    }
    const waiting = report.findings.filter(
        f => f.repair?.risk === 'destructive' && !f.repair.status,
    )
    if (waiting.length === 0) return
    const ids = waiting.map(f => f.id)
    const askId = pushToast(
        doctorToastMessage(waiting.map(f => f.title)),
        {
            label: 'fix',
            onClick: () => {
                // The toast host dismisses a toast the moment its action returns, which for this async
                // action is before the repair finishes, so a progress toast takes over and is updated in
                // place with the result.
                dismissToast(askId)
                const progress = pushToast('doctor // fixing', undefined, 0)
                deps.fixDoctor(ids).then(
                    r =>
                        updateToast(
                            progress,
                            `doctor // fixed ${r.fixed} of ${ids.length}`,
                            DONE_TTL,
                        ),
                    () =>
                        updateToast(progress, 'doctor // fix failed', DONE_TTL),
                )
            },
        },
        ASK_TTL,
    )
}
