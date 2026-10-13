// app/src/preview/pdfMarkdownJobs.ts
// The PDF bar's "convert to markdown" button, minus the button: start the core job
// (POST /convert/pdf-markdown), poll it until it settles, and report through a toast. Module-level
// so a conversion outlives its tab: close the PDF mid-run and the toast still arrives, with an
// `open` action for the new note. While the PDF's preview is still mounted, the note also opens.
// A running conversion can be cancelled (POST /convert/pdf-markdown/cancel); its poll then ends
// with a `cancelled converting` toast.
import { createSignal } from 'solid-js'
import { api } from '../api'
import { pushToast } from '../ui/ToastHost'
import { openNote } from '../ui/openNote'

const POLL_MS = 1500

const [running, setRunning] = createSignal<ReadonlySet<string>>(new Set())
/** PDF paths whose preview is on screen, counted (a PDF can sit in two panes). */
const mounted = new Map<string, number>()
/** Ends a poll's wait early, by PDF path, so a cancel reads back at once. */
const wake = new Map<string, () => void>()

function setBusy(path: string, on: boolean): void {
    setRunning(prev => {
        const next = new Set(prev)
        if (on) next.add(path)
        else next.delete(path)
        return next
    })
}

const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1)

/** True while `path` is converting. */
export function isConverting(path: string): boolean {
    return running().has(path)
}

async function poll(path: string): Promise<void> {
    setBusy(path, true)
    try {
        for (;;) {
            const job = await api.pdfMarkdownStatus(path)
            if (job.state === 'running') {
                await new Promise<void>(r => {
                    const t = setTimeout(r, POLL_MS)
                    wake.set(path, () => {
                        clearTimeout(t)
                        r()
                    })
                })
                wake.delete(path)
                continue
            }
            if (job.state === 'done') {
                pushToast(`converted to ${baseName(job.note)}`, {
                    action: { label: 'open', onClick: () => openNote(job.note) },
                })
                if (mounted.has(path)) openNote(job.note)
            } else if (job.state === 'cancelled') {
                pushToast(`cancelled converting ${baseName(path)}`)
            } else if (job.state === 'error') {
                pushToast(`couldn't convert ${baseName(path)}: ${job.message}`, {
                    tone: 'danger',
                    ttl: 12_000,
                })
            }
            return
        }
    } catch (e) {
        pushToast(`couldn't convert ${baseName(path)}: ${(e as Error).message}`, {
            tone: 'danger',
        })
    } finally {
        setBusy(path, false)
    }
}

/** Convert `path` to `<name>.md` beside it. An existing note opens instead, with a toast that
 *  offers to rewrite it. */
export async function convertPdf(path: string, replace = false): Promise<void> {
    if (isConverting(path)) return
    try {
        const start = await api.startPdfMarkdown(path, replace)
        if (start.state === 'exists') {
            openNote(start.note)
            pushToast(`${baseName(start.note)} already exists`, {
                action: { label: 'rewrite', onClick: () => void convertPdf(path, true) },
            })
            return
        }
    } catch (e) {
        pushToast(`couldn't convert ${baseName(path)}: ${(e as Error).message}`, {
            tone: 'danger',
        })
        return
    }
    await poll(path)
}

/** Stop converting `path`; no note is written. The running poll reads `cancelled` and says so. */
export async function cancelConversion(path: string): Promise<void> {
    try {
        await api.cancelPdfMarkdown(path)
    } catch (e) {
        pushToast(`couldn't cancel converting ${baseName(path)}: ${(e as Error).message}`, {
            tone: 'danger',
        })
        return
    }
    wake.get(path)?.()
}

/** A PDF preview mounted: pick up a conversion already running (started before a reload, from
 *  another pane) so the button shows it. Returns the unmount. */
export function watchPdf(path: string): () => void {
    mounted.set(path, (mounted.get(path) ?? 0) + 1)
    if (!isConverting(path))
        api.pdfMarkdownStatus(path)
            .then(job => {
                if (job.state === 'running') void poll(path)
            })
            .catch(() => {})
    return () => {
        const n = (mounted.get(path) ?? 1) - 1
        if (n > 0) mounted.set(path, n)
        else mounted.delete(path)
    }
}
