// app/src/ui/paneChrome.ts
// The pane's own chrome — close + drag — handed DOWN to whatever a pane renders, so a view that
// already draws a ViewBar can carry it instead of PaneLeaf stacking a PaneHeader on top of it.
//
// A split pane used to show two title rows: PaneHeader (icon · name · [×]) and then the view's
// ViewBar repeating the same icon and name. Now PaneLeaf provides this context, the FIRST ViewBar
// to mount inside the pane claims it (ui/ViewBar.tsx), and that bar grows the [×] and becomes the
// drag handle. PaneLeaf renders PaneHeader only while nothing has claimed — the fallback for
// bar-less views (notes, terminal, sheets, drawings) — and PaneHeader is itself a name-only
// ViewBar under its own chrome, so every split pane's top is the same primitive: one height, one
// hairline, one [×], one focus cue.
//
// FIRST CLAIMANT WINS. A view can nest a second bar (the daemon page's bar, then its chat's
// header); only the first registrant owns the chrome, and when it unmounts the next in line does.
// A ViewBar mounted in its own render root (a ```query block's embedded base, via
// editor/solidWidget.ts's `render()`) never sees this context, so it can never claim a pane.
import {
    createContext,
    createSignal,
    useContext,
    type Accessor,
} from 'solid-js'

export type PaneChrome = {
    /** The tab is split — only then does a claimant draw the [×] (an unsplit tab has no chrome). */
    split: Accessor<boolean>
    /** The pane has focus — an unfocused pane's bar dims its title, the split's one focus cue. */
    focused: Accessor<boolean>
    close: () => void
    startDrag: (e: PointerEvent) => void
    /** Register a claimant; returns its release. */
    claim: (id: symbol) => () => void
    /** The claimant that owns the chrome, or undefined when none has claimed. */
    owner: Accessor<symbol | undefined>
}

export const PaneChromeContext = createContext<PaneChrome>()

export const usePaneChrome = (): PaneChrome | undefined =>
    useContext(PaneChromeContext)

export function createPaneChrome(opts: {
    split: Accessor<boolean>
    focused: Accessor<boolean>
    close: () => void
    startDrag: (e: PointerEvent) => void
}): PaneChrome {
    const [claimants, setClaimants] = createSignal<symbol[]>([])
    return {
        split: opts.split,
        focused: opts.focused,
        close: opts.close,
        startDrag: opts.startDrag,
        claim: id => {
            setClaimants(c => [...c, id])
            return () => setClaimants(c => c.filter(x => x !== id))
        },
        owner: () => claimants()[0],
    }
}
