export type DetectAiActiveDeps = {
    /** The active note's path, or null when there is no note to check. */
    path: string | null
    read: (p: string) => Promise<string>
    pushToast: (message: string, action?: undefined, ttl?: number) => number
    updateToast: (id: number, message: string) => void
    dismissToast: (id: number) => void
}

// Estimate how AI-generated the active page reads — fully local + offline (transformers.js
// in the webview; see ai/aiDetect.ts). The detector + its model are dynamically imported so
// they stay out of the boot bundle and the ~34MB model only downloads on first use. NOTE:
// the score is a rough hint, not proof, and the model is unvalidated on Claude-class text —
// the toast intentionally shows just the number (per product choice).
export async function detectAiActive(deps: DetectAiActiveDeps): Promise<void> {
    const { path, read, pushToast, updateToast, dismissToast } = deps
    if (!path) {
        pushToast('Open a note to check it for AI-generated text')
        return
    }
    // Persistent toast (ttl 0) updated in place as a real loading phase: the first-run model
    // download %, then "section N/M" per window — a big essay is many windows, each a forward
    // pass, so this can run for a while and needs visible progress.
    const progress = pushToast('Preparing AI detector…', undefined, 0)
    try {
        const text = await read(path)
        const { detectAiScore } = await import('./aiDetect')
        const { score, peak, chunks } = await detectAiScore(text, p => {
            updateToast(
                progress,
                p.phase === 'load'
                    ? `Downloading detector model… ${p.pct}%`
                    : `Analyzing… section ${p.done}/${p.total}`,
            )
        })
        dismissToast(progress)
        const pct = Math.round(score * 100)
        const detail =
            chunks > 1
                ? ` (peak ${Math.round(peak * 100)}% across ${chunks} sections)`
                : ''
        pushToast(`AI-likelihood ≈ ${pct}%${detail}`)
    } catch (e) {
        dismissToast(progress)
        pushToast(
            (e as Error)?.name === 'TooShortError'
                ? 'Not enough text on this page to analyze'
                : `AI detection failed: ${(e as Error).message}`,
        )
    }
}
