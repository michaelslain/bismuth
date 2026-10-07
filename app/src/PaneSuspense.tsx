// app/src/PaneSuspense.tsx
// The Suspense boundary every lazy pane view sits in. Its fallback is a full-size empty box, so a
// split or tab keeps the pane's whole box through the brief chunk load instead of flashing a
// collapsed pane. Written once here — PaneContent had it eight times. `full` is the global
// full-size utility (global.css), the same one the graph/terminal host placeholders use.
// `fallback` overrides it for the one view (ExportView) whose placeholder must hold its own grid
// shape. Every PaneContent story renders through this boundary.
import { Suspense, type Component, type JSX } from 'solid-js'

export type PaneSuspenseProps = {
    children: JSX.Element
    fallback?: JSX.Element
}

const PaneSuspense: Component<PaneSuspenseProps> = props => (
    <Suspense fallback={props.fallback ?? <div class="full" />}>
        {props.children}
    </Suspense>
)

export default PaneSuspense
