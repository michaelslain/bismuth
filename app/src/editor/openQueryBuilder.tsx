// app/src/editor/openQueryBuilder.tsx
// Mounts the no-code <QueryBuilder> modal outside of any Solid component tree — the CodeMirror
// slash-menu apply() and the QueryBlockWidget's pencil are both plain functions, not Solid
// components, so there is nothing to render JSX *into* at the call site. This mounts through
// ui/mountModal, which tears it down on confirm or close.
import { QueryBuilder } from '../bases/QueryBuilder'
import type { BuilderState } from '../bases/queryGen'
import { mountModal } from '../ui/mountModal'

export default function openQueryBuilder(opts: {
    hostPath?: string
    initial?: BuilderState
    onConfirm: (body: string) => void
    onClose?: () => void
}): void {
    mountModal(close => (
        <QueryBuilder
            hostPath={opts.hostPath}
            initial={opts.initial}
            onConfirm={body => {
                opts.onConfirm(body)
                close()
            }}
            onClose={() => {
                opts.onClose?.()
                close()
            }}
        />
    ))
}
