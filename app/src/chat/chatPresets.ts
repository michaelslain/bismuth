// app/src/chat/chatPresets.ts
// Chat presets — a saved provider + model + effort combination, kept in `.settings` as
// `chat.presets` (core/src/schema/settingsSchema.ts) so they belong to the vault, survive a reload
// and are editable as text like every other setting. Pure: no Solid, no settings store, so the list
// rules (match, save-replaces-by-name, delete) are unit-tested without a live session. The model
// dialog (ChatModelPicker → ChatPresetList) reads and writes the list; the session's `applyPreset`
// (chatSession.ts) turns one back into a provider/model/effort switch.

export type ChatPreset = {
    name: string
    provider: string
    /** The model id as the connector reports it ('' = the connector's own default). */
    model: string
    /** The effort level ('' = leave the model's own default alone). */
    effort: string
}

/** What a chat is running right now — the same three fields a preset holds. */
export type ChatPresetCurrent = Omit<ChatPreset, 'name'>

/** Does `preset` describe exactly what the chat is running? An empty preset field is a wildcard —
 *  a preset saved without an effort (a connector with no effort levels) matches at any effort. */
export function presetMatches(
    preset: ChatPreset,
    current: ChatPresetCurrent,
): boolean {
    return (
        preset.provider === current.provider &&
        (!preset.model || preset.model === current.model) &&
        (!preset.effort || preset.effort === current.effort)
    )
}

/** Save `preset`: a preset with the same name (ignoring case and surrounding space) is replaced in
 *  place, otherwise it is appended. An empty name saves nothing. */
export function savePreset(
    list: readonly ChatPreset[],
    preset: ChatPreset,
): ChatPreset[] {
    const name = preset.name.trim()
    if (!name) return [...list]
    const next = { ...preset, name }
    const key = name.toLowerCase()
    const at = list.findIndex(p => p.name.trim().toLowerCase() === key)
    if (at < 0) return [...list, next]
    return list.map((p, i) => (i === at ? next : p))
}

/** Remove the preset at `index` (an index, not a name, so a hand-edited duplicate name deletes only
 *  the row that was clicked). */
export function deletePreset(
    list: readonly ChatPreset[],
    index: number,
): ChatPreset[] {
    return list.filter((_, i) => i !== index)
}

/** A suggested name for saving what the chat is running now: the model word and the effort, e.g.
 *  `opus 4.8 high` — the save input starts with it selected, so typing replaces it. */
export function suggestPresetName(modelWord: string, effort: string): string {
    return [modelWord, effort].filter(Boolean).join(' ')
}
