import type { Component } from 'solid-js'

export type CaretProps = {
    class?: string
}

/**
 * The one blinking cursor glyph, reused in terminal/chat/status/tree contexts. `.asc-caret`
 * (+ its `@keyframes asc-blink`) lives in app/src/global.css, NOT a colocated module — Caret.tsx
 * has no production importer (only its own story does), so a module stylesheet here would be
 * tree-shaken out of the real bundle and every caret would ship invisible (found + fixed
 * 2026-09-20; see global.css's own comment on the rule). The class is written as the bare
 * literal string, the same pattern ui/ViewBar.tsx uses for its own global-register classes,
 * because there is no hashed local to read: seven other components already write `asc-caret`
 * bare with no owning component, so this stays a shared global name until a later wave converts
 * those call sites to compose <Caret> instead.
 *
 * Every existing bare `.asc-caret` writer (ChatComposer, Terminal, intro/TermPanel,
 * chat/ChatTranscript, shell/TopStrip, shell/StatusBar, palette/SwitcherBar) wraps an underscore
 * glyph as the element's content — an EMPTY element has no intrinsic size and renders as a 0x0
 * box, invisible regardless of color/animation. Caret supplies that same "_" content so it is
 * visible without every caller having to remember to pass it.
 */
const Caret: Component<CaretProps> = props => {
    return <span class={`asc-caret${props.class ? ` ${props.class}` : ''}`}>_</span>
}

export default Caret
export { Caret }
