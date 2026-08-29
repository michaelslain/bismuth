// app/src/ui/Callout.tsx
// The accent-edge admonition block — formerly the bare `.asc-callout` class in ui/ui.css.
// Had zero direct JSX consumers before this move (the editor's live-preview callout widget
// mirrors the same visual recipe independently, as a CodeMirror decoration theme — see
// editor/livePreview.ts's `calloutThemeSpec` — because CodeMirror renders its own DOM, not a
// Solid component tree, so it cannot import this component; the two are kept visually in sync
// by hand). Real component, colocated module + story, per the 2026-08-27 visual-unification
// audit's §9.8 ("a shared stylesheet is evidence of a missing component") — any FUTURE
// Solid-rendered callout (outside the editor) should reach for this instead of a bare class.
import type { JSX } from 'solid-js'
import styles from './Callout.module.css'

export type CalloutProps = {
    class?: string
    children?: JSX.Element
}

function Callout(props: CalloutProps) {
    return (
        <div class={[styles.callout, props.class].filter(Boolean).join(' ')}>
            {props.children}
        </div>
    )
}

export default Callout
export { Callout }
