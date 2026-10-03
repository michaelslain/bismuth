// app/src/intro/introPager.ts
// The intro's pager arithmetic, pure. No framework imports.

/** Index of the slide named `startAt`; absent or unknown → 0. */
export function startIndex(
    slides: readonly { key: string }[],
    startAt?: string,
): number {
    return Math.max(
        0,
        slides.findIndex(s => s.key === startAt),
    )
}

export type PagerMove = 'next' | 'prev' | 'skip' | 'go'

/** One pager move. `enter` is true only when `next` is pressed ON the last slide — the CTA —
 *  which stays put and asks the caller to enter the vault. `skip` jumps to the last slide rather
 *  than bailing (there is no vault yet). `go` clamps `target` into range. */
export function step(
    index: number,
    count: number,
    move: PagerMove,
    target = index,
): { index: number; enter: boolean } {
    const last = Math.max(0, count - 1)
    const clamp = (k: number) => Math.max(0, Math.min(last, k))
    switch (move) {
        case 'next':
            return index >= last
                ? { index: last, enter: true }
                : { index: clamp(index + 1), enter: false }
        case 'prev':
            return { index: clamp(index - 1), enter: false }
        case 'skip':
            return { index: last, enter: false }
        case 'go':
            return { index: clamp(target), enter: false }
    }
}
