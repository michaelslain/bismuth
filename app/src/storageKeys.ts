// app/src/storageKeys.ts
// localStorage keys read by more than one module — one spelling each, so a writer and its reader
// cannot drift apart.

/** The cached theme-var map. Written by App.tsx on every projection and by the first-run intro
 *  just before its restart; read by index.html's inline <head> script (which hardcodes this same
 *  spelling) so the last-known theme paints before the bundle loads. */
export const THEME_VARS_KEY = 'bismuth-theme-vars-v1'

/** The intro writes the chosen power-up command ids here; the post-restart App reads and clears
 *  it once. An ABSENT key means "no intro ran" — never "deselected everything". */
export const FIRST_RUN_POWERUPS_KEY = 'bismuth-first-run-powerups'
/** The intro's chosen agent: 'free-agent' or a backend id. Read + removed once by App after the first vault opens. */
export const FIRST_RUN_AGENT_KEY = 'bismuth-first-run-agent'
/** The daemon name typed on the intro, written only when the daemon power-up is on and the name
 *  differs from the default. Read + removed once by App, which writes it to .daemon/identity.md. */
export const FIRST_RUN_DAEMON_NAME_KEY = 'bismuth-first-run-daemon-name'
/** `{source, target}` JSON when the intro's obsidian slide asked for a conversion (cli + mcp on),
 *  written by Rust's choose_first_vault into the hand-off file. Read + removed once by App, which
 *  opens a chat that sends the conversion request. */
export const FIRST_RUN_CONVERT_KEY = 'bismuth-first-run-convert-obsidian'
/** The intro's privacy picks as JSON `{path, value}[]` (every switch, off ones included), written
 *  only when the daemon power-up is on. Read + removed once by App, which writes each to .settings. */
export const FIRST_RUN_PRIVACY_KEY = 'bismuth-first-run-privacy'
