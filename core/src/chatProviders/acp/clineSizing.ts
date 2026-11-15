// core/src/chatProviders/acp/clineSizing.ts
// Hand cline the model's loaded window. cline reads `contextWindow` from a provider's settings in
// `$CLINE_DIR/data/settings/providers.json` (ProviderSettingsSchema in @cline/core's
// services/llms/provider-settings; its model-info `maxInputTokens` is not a provider setting, and
// the schema drops unknown keys), and compacts against it. Without it cline assumes a large window
// and never compacts before a small local model overflows.

/** The provider-settings keys that carry `window`; empty when the window is unknown. */
export function clineContextSettings(
    window: number | null,
): { contextWindow?: number } {
    if (window == null || !Number.isFinite(window) || window <= 0) return {}
    return { contextWindow: Math.floor(window) }
}
