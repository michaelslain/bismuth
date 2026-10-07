// One family does the whole interface: Monaspace, all five variants. Xenon is the
// canonical/default face; Neon/Argon/Krypton/Radon are user-selectable (see settings.ts
// FONT_STACKS) and metric-compatible, so switching never reflows the grid.
import '@fontsource/monaspace-xenon/400.css'
import '@fontsource/monaspace-xenon/500.css'
import '@fontsource/monaspace-xenon/700.css'
import '@fontsource/monaspace-neon/400.css'
import '@fontsource/monaspace-neon/500.css'
import '@fontsource/monaspace-neon/700.css'
import '@fontsource/monaspace-argon/400.css'
import '@fontsource/monaspace-argon/500.css'
import '@fontsource/monaspace-argon/700.css'
import '@fontsource/monaspace-krypton/400.css'
import '@fontsource/monaspace-krypton/500.css'
import '@fontsource/monaspace-krypton/700.css'
import '@fontsource/monaspace-radon/400.css'
import '@fontsource/monaspace-radon/500.css'
import '@fontsource/monaspace-radon/700.css'
// The proportional faces, for note prose and chat message bodies only — everything else stays on
// the Monaspace grid. The DEFAULT appearance.proseFont, Libron, is not here: it is not on npm, so
// it is vendored (app/src/assets/fonts/libron/) and declared by @font-face in global.css's tokens
// section. IBM Plex Serif (static cuts: 400 body, 500 h4-h6, 600 h1-h3, 700 strong, plus their
// italics) and Lora stay selectable. Lora repointed
// CMU Serif (Computer Modern), which is uninstalled; CMU itself replaced Newsreader 2026-08-29
// from a 21-candidate comparison. Lora's package declares `font-family: 'Lora Variable'` (not
// bare `'Lora'`) — see the --prose-font comment in global.css's tokens section for why that
// string is load-bearing.
import '@fontsource/ibm-plex-serif/400.css'
import '@fontsource/ibm-plex-serif/400-italic.css'
import '@fontsource/ibm-plex-serif/500.css'
import '@fontsource/ibm-plex-serif/500-italic.css'
import '@fontsource/ibm-plex-serif/600.css'
import '@fontsource/ibm-plex-serif/600-italic.css'
import '@fontsource/ibm-plex-serif/700.css'
import '@fontsource/ibm-plex-serif/700-italic.css'
import '@fontsource-variable/lora/wght.css'
import '@fontsource-variable/lora/wght-italic.css'
