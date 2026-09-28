// The one imperative mount: for a caller that is a plain function (a CodeMirror widget, a
// right-click handler) and so has no Solid tree to render a modal into. Renders `view` into a
// detached <div> appended to document.body and returns `close`, which disposes and removes it.
// Not a double portal — Modal/FormModal/ContextMenu already portal their own DOM; this host is
// only ever a mount point.
//
// Final signature:
//   mountModal(view: (close: () => void) => JSX.Element, renderFn?: typeof render): () => void
// `renderFn` exists so the close contract is testable — Bun resolves solid-js/web to its server
// build, where the real `render` throws "Client-only API called on the server side".
import { createComponent, type JSX } from 'solid-js'
import { render } from 'solid-js/web'

export function mountModal(
    view: (close: () => void) => JSX.Element,
    renderFn: (code: () => JSX.Element, host: Element) => () => void = render,
): () => void {
    const host = document.createElement('div')
    document.body.appendChild(host)
    let dispose: (() => void) | undefined
    let closed = false
    const close = (): void => {
        if (closed) return
        closed = true
        // A view that closes itself while still rendering runs before `dispose` exists —
        // the assignment below then disposes on its behalf.
        dispose?.()
        host.remove()
    }
    dispose = renderFn(() => createComponent(() => view(close), {}), host)
    if (closed) dispose()
    return close
}
