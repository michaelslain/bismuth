// app/src/editor/settingsBuffer.ts
// The vault-root `.settings` file is the single app-config surface (YAML). Only that exact root
// path is the settings buffer — a `settings.yaml` nested in a folder is a normal note validated by
// the property registry, not the app-settings schema.
import { SETTINGS_FILE } from '../tabIds'

export function isSettingsBuffer(path: string | null): boolean {
    return path === SETTINGS_FILE
}

/**
 * A YAML CONFIG buffer: the app settings file (`.settings`) or any `.yaml`/`.yml`. These are
 * CODE, not prose — every note (including these) opens in the CodeMirror source `Editor`, where
 * the schema-driven settings autocomplete + lint live (isSettingsBuffer). Mirrors the `isYaml`
 * check in Editor.tsx so the two never drift.
 */
export function isConfigBuffer(path: string | null): boolean {
    return (
        isSettingsBuffer(path) ||
        path?.endsWith('.yaml') === true ||
        path?.endsWith('.yml') === true
    )
}
