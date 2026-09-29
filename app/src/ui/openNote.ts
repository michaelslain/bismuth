/** Ask the app to open a note (optionally scrolled to a heading) via the app-wide `bismuth-open`
 *  event. The ONE dispatcher: nothing else hand-builds this CustomEvent. */
export function openNote(path: string, heading?: string): void {
    window.dispatchEvent(
        new CustomEvent('bismuth-open', { detail: heading ? { path, heading } : path }),
    )
}
