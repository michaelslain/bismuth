// app/src/editor/settingsBuffer.ts
// The vault-root settings.yaml is the single app-config surface. Only the exact
// root path is the settings buffer — a `settings.yaml` nested in a folder is a
// normal note validated by the property registry, not the app-settings schema.
export function isSettingsBuffer(path: string | null): boolean {
  return path === "settings.yaml";
}
