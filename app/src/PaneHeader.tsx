// app/src/PaneHeader.tsx
// The title row of a split pane whose view draws NO bar of its own — notes, terminal, sheets,
// drawings, the empty pane. A view that does draw a ViewBar claims the pane's close + drag through
// ui/paneChrome.ts and carries the [×] in its own bar, so PaneLeaf renders this only while nothing
// has claimed (it used to sit above every view, repeating the icon and name the view's bar
// already showed).
//
// IT IS A NAME-ONLY ViewBar under its own pane chrome, not a bespoke row. It used to be a 24px
// strip on --rail with its own title rule, beside a neighbouring pane's 36px bar on the plain
// ground — two heights, two fills, two [×] sizes, hairlines that never lined up across a split.
// Rendering through ViewBar makes every split pane's top the same primitive, and the [×], the
// drag handle (the bar outside its controls) and the unfocused-pane title dim all come from
// ViewBar's own pane-chrome handling rather than a second copy here.
//
// Its chrome is its OWN createPaneChrome, not PaneLeaf's: PaneLeaf shows this header only while
// its chrome is unclaimed, so if this bar claimed that same chrome it would hide itself.
import ViewBar, { Crumb } from './ui/ViewBar'
import { createPaneChrome, PaneChromeContext } from './ui/paneChrome'

export type PaneHeaderProps = {
    icon?: string
    label: string
    /** The pane has focus; unfocused, the title dims. Defaults to focused. */
    focused?: boolean
    onPointerDown: (e: PointerEvent) => void
    onClose: () => void
    class?: string
}

export function PaneHeader(props: PaneHeaderProps) {
    const chrome = createPaneChrome({
        split: () => true,
        focused: () => props.focused ?? true,
        close: () => props.onClose(),
        startDrag: e => props.onPointerDown(e),
    })
    return (
        <PaneChromeContext.Provider value={chrome}>
            <ViewBar
                class={props.class}
                identity={<Crumb icon={props.icon}>{props.label}</Crumb>}
            />
        </PaneChromeContext.Provider>
    )
}
