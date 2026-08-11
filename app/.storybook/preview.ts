import type { Preview } from "storybook-solidjs-vite";

// ── Fonts ─────────────────────────────────────────────────────────────────────
// Same font faces the app entry (src/index.tsx) loads: all five Monaspace variants —
// one family does the whole interface (prose/input values AND the UI monospace used
// by buttons, chips, select triggers). Without these the components fall back to the
// browser default.
import "@fontsource/monaspace-xenon/400.css";
import "@fontsource/monaspace-xenon/500.css";
import "@fontsource/monaspace-xenon/700.css";
import "@fontsource/monaspace-neon/400.css";
import "@fontsource/monaspace-neon/500.css";
import "@fontsource/monaspace-neon/700.css";
import "@fontsource/monaspace-argon/400.css";
import "@fontsource/monaspace-argon/500.css";
import "@fontsource/monaspace-argon/700.css";
import "@fontsource/monaspace-krypton/400.css";
import "@fontsource/monaspace-krypton/500.css";
import "@fontsource/monaspace-krypton/700.css";
import "@fontsource/monaspace-radon/400.css";
import "@fontsource/monaspace-radon/500.css";
import "@fontsource/monaspace-radon/700.css";

// ── Stylesheets ───────────────────────────────────────────────────────────────
// App.css supplies the global chrome the primitives lean on beyond their own file:
// the `:root` first-paint CSS-var fallbacks, the semantic tokens NOT covered by the
// theme (`--danger`, `--success`, `--shadow-menu`/`--shadow-popup`/…), `body`
// background/color, `* { box-sizing }`, and the `button { font: inherit }` reset.
import "../src/App.css";
// The UI primitives' own chrome (.btn / .ui-input / .ui-select / .ui-overlay / .chip-toggle)
// and the shared floating-list surface Select's dropdown renders into.
import "../src/ui/ui.css";
import "../src/ui/popover/popover.css";

// ── Runtime theme tokens ──────────────────────────────────────────────────────
// THE crucial step. The primitives are almost entirely driven by CSS custom
// properties (--fg, --bg, --accent, --surface-2, --border-soft, --hover-bg, …) that
// App.css only defines as dark first-paint *fallbacks*. In the real app, App.tsx
// projects the SELECTED theme's palette onto :root at runtime via
// settingsToCssVars(settings). We replicate that here with the schema DEFAULTS so the
// catalog renders in the real default theme (ink) — identical to a fresh app.
import { settingsToCssVars, setCssVars } from "../src/settingsCssVars";
import { DEFAULTS } from "../../core/src/schema/settingsSchema";
import type { Settings } from "../src/settings";

setCssVars(settingsToCssVars(DEFAULTS as unknown as Settings));

// ── The app-shell font ────────────────────────────────────────────────────────
// THIRD crucial step, same spirit as the theme tokens above. App.css declares the interface font
// on `.app-shell` / `.layout` — the two elements that wrap every pane in the real app — NOT on
// `body`. Storybook mounts a component with neither ancestor, so anything that inherits its font
// instead of naming one lands on the browser's default proportional SERIF.
//
// That is not a cosmetic gap: it makes a story actively lie. ChatView's AskUserQuestion card
// (`.chat-question-option { font: inherit }`) rendered its labels and descriptions in Times in the
// catalog while being correct Monaspace in the app — a reviewer comparing them would "fix" a bug
// that does not exist, or distrust the surface. Components that DO name a family (--ui-font-stack,
// --editor-font) looked right, so the breakage was partial and easy to misread.
//
// Mirrors `.app-shell`'s own declaration in App.css. Global, so no story has to re-solve it — the
// same reason the theme tokens and the fake transport are installed here rather than per story.
const appFont = document.createElement("style");
appFont.textContent = `body { font: var(--ui-font-size, 13px)/var(--row-h, 18px) "Monaspace Xenon", ui-monospace, monospace; }`;
document.head.appendChild(appFont);

// ── Backend seam ──────────────────────────────────────────────────────────────
// The SECOND crucial step, for the same reason as the theme tokens above: several components
// fetch on mount (CardEditor's `api.read()`, QueryBuilder's `resolveRows`/`tree`, the daemon and
// gcal status panels). With no backend those reads fail and the component sits in its loading
// state forever — a story that renders only a "Loading…" chip verifies nothing about the
// component, while looking like it passed.
//
// `setTransport` is the same seam mobile uses to run the whole app in-process with no HTTP server
// (app/src/inProcessTransport.ts), so an in-memory implementation is a supported configuration,
// not a hack. Seeded from the shared fixture rows so a card reads back the note it claims to show.
import { setTransport } from "../src/api";
import { fakeTransport } from "../src/ui/_fakeTransport";
import { SAMPLE_ROWS } from "../src/ui/_baseFixtures";

setTransport(
  fakeTransport({
    files: Object.fromEntries(
      SAMPLE_ROWS.map((r) => [
        r.file.path,
        `# ${r.file.name}\n\nNotes for **${r.file.name}**.\n\n- [ ] first checklist item\n- [x] second, already done\n`,
      ]),
    ),
  }),
);

const preview: Preview = {
  parameters: {
    // We paint the page from --bg (via App.css `body`), so disable Storybook's own
    // backgrounds toolbar to avoid a competing white/dark swatch behind components.
    backgrounds: { disable: true },
    layout: "centered",
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
};

export default preview;
