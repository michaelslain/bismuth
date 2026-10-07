// app/src/preview/outlinePrefix.ts
// OutlineTree's connector prefix, in the shape its recursion already holds: the `last` flag of every
// ancestor, outermost first. The glyphs themselves are ui/ascii/treePrefix's — the app's ONE tree
// prefix builder — so a connector is drawn the same way in every tree. This wrapper only maps
// OutlineTree's `ancestorsLast` array onto treePrefix's `(depth, isLast, ancestorsLast)` signature
// (the depth IS the array's length).
import { treePrefix } from '../ui/ascii/treePrefix'

export function outlinePrefix(ancestorsLast: boolean[], last: boolean): string {
    return treePrefix(ancestorsLast.length, last, ancestorsLast)
}
