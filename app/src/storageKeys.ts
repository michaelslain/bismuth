// app/src/storageKeys.ts
// localStorage keys read by more than one module — one spelling each, so a writer and its reader
// cannot drift apart.

/** The cached theme-var map the app paints from on boot (App.tsx writes it on every theme change,
 *  the first-run intro writes it just before the restart). The inline <head> script in
 *  index.html reads a theme-var cache too, but today it reads "oa-theme-vars-v1" — a different
 *  string — so a rename here must be checked against that script rather than assumed mirrored. */
export const THEME_VARS_KEY = 'bismuth-theme-vars-v1'

/** The intro writes the chosen power-up command ids here; the post-restart App reads and clears
 *  it once. An ABSENT key means "no intro ran" — never "deselected everything". */
export const FIRST_RUN_POWERUPS_KEY = 'bismuth-first-run-powerups'
