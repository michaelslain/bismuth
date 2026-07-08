import type { Preview } from "storybook-solidjs-vite";

// ── Fonts ─────────────────────────────────────────────────────────────────────
// Same font faces the app entry (src/index.tsx) loads: Lora (prose / input values)
// + Monaspace Xenon (the UI monospace used by buttons, chips, select triggers).
// Without these the components fall back to the browser default serif/mono.
import "@fontsource/lora/400.css";
import "@fontsource/lora/700.css";
import "@fontsource/lora/400-italic.css";
import "@fontsource/monaspace-xenon/400.css";
import "@fontsource/monaspace-xenon/700.css";

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
// catalog renders in the real default theme (Oxide Duotone) — identical to a fresh app.
import { settingsToCssVars, setCssVars } from "../src/settingsCssVars";
import { DEFAULTS } from "../../core/src/schema/settingsSchema";
import type { Settings } from "../src/settings";

setCssVars(settingsToCssVars(DEFAULTS as unknown as Settings));

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
