// app/src/ui/_noteProseReady.ts — story helper. A NoteProse marked `lazy` (every chat message)
// mounts its CodeMirror view only once it nears the viewport, so a play() waits for the views
// before it reads them.
import { waitFor } from 'storybook/test'

/** Resolves once `root` holds at least `count` mounted note views, or at once when it shows none
 *  at all (an empty transcript). */
export async function noteProseReady(
    root: HTMLElement,
    count = 1,
): Promise<void> {
    if (!root.querySelector('[data-note-prose]')) return
    await waitFor(() => {
        const n = root.querySelectorAll('[data-note-prose] .cm-editor').length
        if (n < count) throw new Error(`note views mounted: ${n} of ${count}`)
    })
}

/** The note fold triangles under `root`, by fold id (`h|2|Setup|0`, `l|**Install**|0`). */
export function foldArrows(root: HTMLElement): Map<string, HTMLElement> {
    return new Map(
        Array.from(root.querySelectorAll<HTMLElement>('.cm-fold-arrow')).map(
            a => [a.dataset.foldId ?? '', a],
        ),
    )
}
