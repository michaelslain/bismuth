// app/src/editor/openQueryBuilder.tsx
// Mounts the no-code <QueryBuilder> modal outside of any Solid component tree — the CodeMirror
// slash-menu apply() and the QueryBlockWidget's pencil are both plain functions, not Solid
// components, so there is nothing to render JSX *into* at the call site. This mounts a fresh
// container appended to document.body via solid-js/web `render`, and tears it down on confirm
// or close.
//
// Not a double portal: <QueryBuilder> renders a <FormModal>, which wraps <Modal>, which already
// wraps its content in a solid-js/web <Portal> (see ui/Modal.tsx) — so the actual dialog DOM
// teleports to document.body regardless of where this function's own container div sits. That
// container is just a mount point for the component tree; it holds no visible DOM itself.
import { render } from 'solid-js/web'
import { QueryBuilder } from '../bases/QueryBuilder'
import type { BuilderState } from '../bases/queryGen'

export default function openQueryBuilder(opts: {
    hostPath?: string
    initial?: BuilderState
    onConfirm: (body: string) => void
    onClose?: () => void
}): void {
    const container = document.createElement('div')
    document.body.appendChild(container)

    let dispose: () => void = () => {}
    const teardown = () => {
        dispose()
        container.remove()
    }

    dispose = render(
        () => (
            <QueryBuilder
                hostPath={opts.hostPath}
                initial={opts.initial}
                onConfirm={body => {
                    opts.onConfirm(body)
                    teardown()
                }}
                onClose={() => {
                    opts.onClose?.()
                    teardown()
                }}
            />
        ),
        container,
    )
}
