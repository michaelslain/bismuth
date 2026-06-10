// app/src/editor/listLayout.ts
// Shared list-indent geometry. Kept in its own dependency-free leaf module so that
// both livePreview.ts and foldBlocks.ts can use the same constant without foldBlocks
// pulling in livePreview's heavy (client-only, lucide-backed) widget chain.

// em added to the text indent per nesting level. foldBlocks.ts aligns its fold
// triangle to the same per-depth indent without duplicating the constant.
export const LIST_STEP = 1.6;
