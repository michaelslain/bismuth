// ui/caretClock.ts — keeps every brand cursor blinking in phase.
//
// A CSS animation's clock starts when its element starts animating, so two carets that mounted
// 300ms apart blink 300ms apart forever — and an intro slide, the top strip and the status bar
// mount their carets at different moments. Every caret runs the same `asc-blink` keyframes for the
// same --cursor-blink duration, so pinning each animation's start to the document timeline's origin
// (Web Animations' `startTime = 0`) puts them all on one clock, whenever each one appeared.
// Pure: it touches only what it is handed, so a test can drive it with a stand-in element.

export type ClockedElement = {
    getAnimations?: () => { startTime: CSSNumberish | null }[]
}

/** Pin every running animation on `el` to the document timeline's origin. */
export function syncToDocumentClock(el: ClockedElement): void {
    for (const animation of el.getAnimations?.() ?? []) animation.startTime = 0
}
