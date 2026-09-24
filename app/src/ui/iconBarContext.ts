// Plain context module for ui/IconBar — no JSX here so it stays importable from IconButton.tsx
// without pulling IconBar's own render tree along. `useIconBar()` is the seam IconButton reads to
// pick up an enclosing bar's glyph size (Solid context) — see IconBar.tsx for the Provider.
import { createContext, useContext } from 'solid-js'

export type IconBarContextValue = {
    /** The bar's glyph px for every IconButton inside it. */
    iconSize: () => number
}

export const IconBarContext = createContext<IconBarContextValue | undefined>(
    undefined,
)

export function useIconBar(): IconBarContextValue | undefined {
    return useContext(IconBarContext)
}
