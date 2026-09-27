# Storybook for `app/src/ui/`

Visual catalog for the Bismuth Solid.js UI primitives. This is the visual **spec**
the eventual React (Claude Design) ports must match, so faithfulness matters.

```bash
cd app
bun run storybook        # dev server on :6006
bun run build-storybook  # static build → app/storybook-static/
```

## Stack (and why these exact versions)

- **Storybook 9** (`storybook@9.1.20`) + **`storybook-solidjs-vite@9.0.3`** (community
  Solid renderer over Storybook's Vite builder).
- There is **no Storybook-8 build of `storybook-solidjs-vite`** — its lowest published
  version is `9.0.0`. So we run Storybook 9, not 8.
- **No `@storybook/addon-essentials`.** That package is Storybook-8-only; in SB9 its
  features (controls, actions, viewport, backgrounds, docs) are built into core. `addons`
  is intentionally empty.
- CSF types (`Meta`, `StoryObj`, `Preview`) and the `StorybookConfig` type are imported
  from **`storybook-solidjs-vite`** directly (it bundles the renderer; there is no separate
  `storybook-solidjs@9` package).

## What makes the Solid components render STYLED (the reusable finding)

The primitives are ~entirely CSS-custom-property driven. Getting them to render like the
real app takes **three layers**, all wired in `preview.ts` + `preview-head.html`:

1. **Fonts** — import the same `@fontsource` faces the app entry loads (all five Monaspace
   variants — Xenon/Neon/Argon/Krypton/Radon). Without them buttons/chips/select triggers
   fall back to browser mono.

2. **Stylesheets** — one import, `../src/global.css`, whose sections carry (among others):
   - the `App.css` section — global `:root` first-paint CSS-var *fallbacks*, the semantic tokens
     the theme map does **not** provide (`--danger`, `--success`, `--shadow-*`), the `body`
     background/color, `* { box-sizing }`, and the `button { font: inherit }` reset.
   - the `ui/ui.css` section — the primitives' own chrome (`.btn`, `.ui-input`, `.ui-select-*`,
     `.ui-overlay`, `.chip-toggle`).
   - the `ui/popover/popover.css` section — the shared floating-list surface that `Select`'s open
     dropdown (`<PopoverList>`) renders into.

3. **Runtime theme tokens (the crucial step)** — global.css's `App.css` section only defines the color vars as
   dark *fallbacks*. In the real app, `App.tsx` projects the **selected theme's** palette
   onto `:root` at runtime via `settingsToCssVars(settings)`. `preview.ts` replicates that
   with the schema `DEFAULTS`, so the catalog renders in the real default theme
   (**ink**), identical to a fresh vault:

   ```ts
   import { settingsToCssVars, setCssVars } from "../src/settingsCssVars";
   import { DEFAULTS } from "../../core/src/schema/settingsSchema";
   setCssVars(settingsToCssVars(DEFAULTS as unknown as Settings));
   ```

   > For the React port: the components carry **no color values of their own** — every color,
   > surface, border, radius token comes from these `--vars`. Port `settingsToCssVars` +
   > `themes.ts` (both are DOM/Solid-free already) and project the same variables, or the
   > ports will render unstyled.

4. **`preview-head.html`** sets `window.__BISMUTH_FIRST_RUN__ = true` **before** the preview
   bundle evaluates. `settingsCssVars.ts` transitively imports `settings.ts`, whose module
   scope opens an `EventSource` + `GET /settings` to live-sync from the core backend. There is
   no backend in Storybook; the flag makes `settings.ts` take its first-run branch and skip
   the network sync (otherwise: failed-fetch spam).

## Notes for the React port

- Only **`Button`** (via `buttonClass`) and **`Chip`** have real visual variant axes. See
  each `*.stories.tsx` header for the enumerated variants.
- **`ChipToggle` tones**: the `tone` prop (`teal | blue | violet | green | gold | rose`, accent
  when unset) maps to Button's `accent` prop as `var(--<tone>)`, which `.btn--text.btn--selected`
  in `ui/Button.module.css` reads — so every tone has its own *selected* colour.
