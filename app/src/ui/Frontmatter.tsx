// app/src/ui/Frontmatter.tsx
// The compact accent-edge meta panel — formerly the bare `.asc-frontmatter` class in
// ui/ui.css. Had zero direct JSX consumers before this move (the editor's live-preview
// frontmatter widget mirrors the same visual recipe independently, as a CodeMirror decoration
// theme — see editor/livePreview.ts's `.cm-block-mid`/`.cm-block-top`/`.cm-block-bottom` rules —
// because CodeMirror renders its own DOM, not a Solid component tree, so it cannot import this
// component; the two are kept visually in sync by hand). Real component, colocated module +
// story, per the 2026-08-27 visual-unification audit's §9.8 ("a shared stylesheet is evidence
// of a missing component") — any FUTURE Solid-rendered frontmatter panel (outside the editor)
// should reach for this instead of a bare class.
import type { JSX } from 'solid-js'
import styles from './Frontmatter.module.css'

export type FrontmatterProps = {
    class?: string
    children?: JSX.Element
}

function Frontmatter(props: FrontmatterProps) {
    return (
        <div class={[styles.frontmatter, props.class].filter(Boolean).join(' ')}>
            {props.children}
        </div>
    )
}

export default Frontmatter
export { Frontmatter }
