// app/src/editor/settingsBuffer.ts
// The vault-root `.settings` file is the single app-config surface (YAML). Only that exact root
// path is the settings buffer — a `settings.yaml` nested in a folder is a normal note validated by
// the property registry, not the app-settings schema.
import { SETTINGS_FILE } from "../tabIds";

export function isSettingsBuffer(path: string | null): boolean {
  return path === SETTINGS_FILE;
}
