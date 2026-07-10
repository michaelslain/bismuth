// app/src/ui/palette.ts
// The canonical theme color-token list. Each token maps to a `--<token>` CSS var set
// at runtime by settingsCssVars from the active theme. This is the single source of
// truth shared by Chip tones, calendar category swatches, and the export palette.
export const PALETTE_TOKENS = ["accent", "teal", "blue", "violet", "green", "gold", "rose"] as const;
export type PaletteTokenName = (typeof PALETTE_TOKENS)[number];
