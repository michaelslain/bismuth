// One busy guard + failure toast for the calendar's async settings actions (CalendarSettings.save,
// every GcalSyncPanel action). While an action runs a second call is refused; a throw becomes a
// `<failure>: <message>` toast; the busy flag always comes back down. Resolves true only when `fn`
// finished, so a caller can close a modal on success and stay open on failure.
import { pushToast } from '../toastStore'

export type BusyState = { get: () => boolean; set: (v: boolean) => void }

export async function withBusy(
    busy: BusyState,
    failure: string,
    fn: () => Promise<void>,
): Promise<boolean> {
    if (busy.get()) return false
    busy.set(true)
    try {
        await fn()
        return true
    } catch (e) {
        pushToast(`${failure}: ${(e as Error).message}`)
        return false
    } finally {
        busy.set(false)
    }
}
