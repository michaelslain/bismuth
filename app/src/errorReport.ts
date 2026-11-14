// app/src/errorReport.ts
// Catches the errors the window throws and nothing handles — `error` events and unhandled promise
// rejections — and reports each to core (`POST /app-errors`, core/src/appErrors.ts), which appends
// it to the log `bismuth errors` reads. Each distinct error also raises one toast, so a thrown
// update reads as something that broke instead of nothing happening.
//
// Pure: no framework imports. The sender and the toast are injected (index.tsx wires them), which
// keeps this importable from a headless test and keeps api.ts out of the entry chunk.

export type AppErrorReport = {
    kind: 'error' | 'rejection'
    message: string
    stack?: string
    /** `file:line:col` of the throw, when the browser reported one. */
    source?: string
}

/** Browser noise that arrives as an `error` event but is not a fault: ResizeObserver's loop
 *  warning fires whenever an observer's callback resizes what it observes within one frame. */
const IGNORED: RegExp[] = [/^ResizeObserver loop/]

/** How many distinct errors one launch reports before it stops: a window failing in many
 *  different ways at once has said enough, and the log and the screen stay readable. */
export const MAX_DISTINCT = 20

const TOAST_MESSAGE_CHARS = 120

function describe(value: unknown): { message: string; stack?: string } {
    if (value instanceof Error) {
        const message = value.message
            ? `${value.name}: ${value.message}`
            : value.name || 'Error'
        return { message, stack: value.stack || undefined }
    }
    if (typeof value === 'string') return { message: value }
    if (value === undefined) return { message: 'undefined' }
    try {
        const json = JSON.stringify(value)
        if (json !== undefined) return { message: json }
    } catch {}
    return { message: String(value) }
}

function ignored(message: string): boolean {
    return IGNORED.some(re => re.test(message))
}

/** The report for a window `error` event, or null when it is noise. */
export function reportFromErrorEvent(ev: {
    message?: string
    filename?: string
    lineno?: number
    colno?: number
    error?: unknown
}): AppErrorReport | null {
    const fromError = ev.error !== undefined && ev.error !== null
    const d = fromError ? describe(ev.error) : { message: ev.message || 'Unknown error' }
    // The event's own message is the browser's rendering ("Uncaught TypeError: …"); the error
    // object's is the same text without the prefix, so prefer it, and fall back to the event's.
    const message = d.message || ev.message || 'Unknown error'
    if (ignored(message) || (ev.message && ignored(ev.message))) return null
    const report: AppErrorReport = { kind: 'error', message }
    if ('stack' in d && d.stack) report.stack = d.stack
    if (ev.filename)
        report.source = `${ev.filename}:${ev.lineno ?? 0}:${ev.colno ?? 0}`
    return report
}

/** The report for an unhandled rejection's `reason`, or null when it is noise. */
export function reportFromRejection(reason: unknown): AppErrorReport | null {
    const d = describe(reason)
    if (ignored(d.message)) return null
    const report: AppErrorReport = { kind: 'rejection', message: d.message }
    if (d.stack) report.stack = d.stack
    return report
}

/** Identity of an error for de-duplication: the same throw from the same place is one error. */
export function errorKey(r: AppErrorReport): string {
    const frame =
        r.stack
            ?.split('\n')
            .map(l => l.trim())
            .find(l => l.startsWith('at ') || l.includes('@')) ??
        r.source ??
        ''
    return `${r.kind}\n${r.message}\n${frame}`
}

/** The toast line for a reported error. `recorded` is false when the report did not reach the
 *  log (no backend, or one that has no log, such as the iPad's in-process backend). */
export function toastText(r: AppErrorReport, recorded: boolean): string {
    const msg =
        r.message.length > TOAST_MESSAGE_CHARS
            ? r.message.slice(0, TOAST_MESSAGE_CHARS - 1) + '…'
            : r.message
    return recorded
        ? `error // ${msg} // recorded, see bismuth errors`
        : `error // ${msg}`
}

export type ErrorReporterDeps = {
    send: (r: AppErrorReport) => Promise<unknown>
    notify: (text: string) => void
    maxDistinct?: number
}

/** Reports each distinct error once per launch: sends it, then toasts it. Never throws. */
export function createErrorReporter(deps: ErrorReporterDeps) {
    const seen = new Set<string>()
    const max = deps.maxDistinct ?? MAX_DISTINCT
    return {
        async report(r: AppErrorReport | null): Promise<void> {
            if (!r) return
            const key = errorKey(r)
            if (seen.has(key) || seen.size >= max) return
            seen.add(key)
            let recorded = false
            try {
                await deps.send(r)
                recorded = true
            } catch {}
            try {
                deps.notify(toastText(r, recorded))
            } catch {}
        },
    }
}

type ListenerTarget = {
    addEventListener(type: string, fn: (ev: any) => void): void
    removeEventListener(type: string, fn: (ev: any) => void): void
}

/** Listen on `target` (the window) for uncaught errors and unhandled rejections. Returns the
 *  uninstall function. */
export function installErrorReporter(
    target: ListenerTarget,
    reporter: ReturnType<typeof createErrorReporter>,
): () => void {
    const onError = (ev: any) => void reporter.report(reportFromErrorEvent(ev))
    const onRejection = (ev: any) =>
        void reporter.report(reportFromRejection(ev?.reason))
    target.addEventListener('error', onError)
    target.addEventListener('unhandledrejection', onRejection)
    return () => {
        target.removeEventListener('error', onError)
        target.removeEventListener('unhandledrejection', onRejection)
    }
}
