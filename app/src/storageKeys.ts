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
