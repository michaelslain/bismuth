// app/src/storageKeys.ts
// localStorage keys read by more than one module — one spelling each, so a writer and its reader
// cannot drift apart.

/** The cached theme-var map. Written by App.tsx on every theme change and by the first-run intro
 *  just before its restart. No reader today: index.html's inline <head> script reads the stale key
 *  "oa-theme-vars-v1", so the pre-bundle theme paint never fires. Fixing that turns on a new
 *  first-paint behaviour and is its own decision. */
export const THEME_VARS_KEY = 'bismuth-theme-vars-v1'

/** The intro writes the chosen power-up command ids here; the post-restart App reads and clears
 *  it once. An ABSENT key means "no intro ran" — never "deselected everything". */
export const FIRST_RUN_POWERUPS_KEY = 'bismuth-first-run-powerups'
