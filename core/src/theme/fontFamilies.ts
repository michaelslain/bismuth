// core/src/theme/fontFamilies.ts
// The font families a token or setting may name. Bundle-safe (pure data) so the schema, the token
// registry and the app all read ONE list. Same values and order as the lists settingsSchema.ts
// used to keep privately.

/** The five Monaspace variants — chrome + in-note mono constructs (uiFont), and an all-mono-editor
 *  option on proseFont too. */
export const MONO_FONTS: readonly string[] = [
    'Monaspace Xenon',
    'Monaspace Neon',
    'Monaspace Argon',
    'Monaspace Krypton',
    'Monaspace Radon',
]

/** proseFont's valid values: the two proportional serifs — IBM Plex Serif (the default) and Lora —
 *  plus the same five Monaspace variants, for a user who wants an all-mono editor. */
export const PROSE_FONTS: readonly string[] = [
    'IBM Plex Serif',
    'Lora',
    ...MONO_FONTS,
]
