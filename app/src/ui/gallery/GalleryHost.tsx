// app/src/ui/gallery/GalleryHost.tsx
// Renders whichever gallery `openGallery()` has queued. Mount ONCE near the app root, like ToastHost.
//
// Split out of galleryStore.tsx (visual-unification audit §6/§9.8). That file mixed a component
// (this) with the imperative launcher logic, under a camelCase name — so it was simultaneously a
// component file that did not look like one and a logic module that could not be unit-tested
// without a renderer. The launcher is now galleryStore.ts, framework-agnostic apart from a signal.
import { Show, type Component } from 'solid-js'
import SymbolGallery from './SymbolGallery'
import { setGalleryOpen } from './galleryState'
import { pending, setPending } from './galleryStore'

const GalleryHost: Component = () => {
    const settle = (value: string | null) => {
        const p = pending()
        setPending(null)
        // Resolve FIRST, and keep `isGalleryOpen()` TRUE until AFTER the resolver has run its insert
        // (#67). The resolver (autocomplete.ts's emoji `apply`) does `applyInsert(cellView, …)` +
        // `view.focus()` on the promise's microtask. If we cleared the flag synchronously here (the old
        // order), the focus churn from unmounting the modal could fire the table cell's `focusout` with
        // the guard already down → `leaveEdit` commits + DESTROYS the nested cell editor the insert
        // targets, so the picked emoji (top result / Enter) landed nowhere. Deferring the clear to the
        // NEXT MACROTASK keeps the teardown guard up across the whole synchronous+microtask insert;
        // by the time the user's NEXT real blur fires (a later macrotask) the flag is false again, so
        // the cell tears down normally then (#49).
        p?.resolve(value)
        if (typeof setTimeout !== 'undefined')
            setTimeout(() => setGalleryOpen(false), 0)
        else setGalleryOpen(false)
    }
    return (
        <Show when={pending()}>
            {p => (
                <SymbolGallery
                    source={p().source}
                    current={p().current}
                    title={p().title}
                    onPick={v => settle(v)}
                    onClose={() => settle(null)}
                />
            )}
        </Show>
    )
}

export default GalleryHost
export { GalleryHost }
