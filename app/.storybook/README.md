# Storybook for the Bismuth app

Visual catalog of the whole app: the `ui/` primitives plus the feature surfaces (bases, calendar,
graph, chat, shell, daemon, ...). Stories sit next to the components they document
(`src/**/*.stories.@(ts|tsx)`), and this catalog is the visual-verification surface.

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

## What makes components render like the real app

The components carry no colour values of their own — every colour, surface, border and radius
comes from CSS custom properties. `preview.ts` + `preview-head.html` wire up what the app
normally provides:

1. **Fonts** — `import '../src/fonts'`, the same module the app entry (`src/index.tsx`) imports
   (Monaspace variants + IBM Plex Serif + Lora; Libron, the default prose face, is an `@font-face` in
   `global.css`, imported next). Without them text falls back to browser defaults.

2. **Stylesheet** — one import, `../src/global.css`: the global layer only (tokens, element reset,
   classes written into runtime-generated HTML). Component rules live in each component's own
   `.module.css`, which the component imports itself.

3. **Runtime theme tokens** — `global.css` only holds first-paint fallbacks. `App.tsx` projects
   the selected theme onto `:root` via `settingsToCssVars`; `preview.ts` calls the same
   projection over the schema `DEFAULTS`, so stories render in the real default theme (`ink`).
   Never hardcode a stand-in for a token.

4. **Theme axis** — a toolbar `Theme` global re-projects on every render (the four built-in
   themes plus the example custom theme `dusk` from `ui/_themeFixtures`). A story can pass
   `parameters.tokens` to override `appearance.tokens`.

5. **App-shell font** — a global `body` font rule mirroring `shell/AppFrame.module.css`, since
   stories mount without the `.app-shell` ancestor that declares it.

6. **`fakeTransport`** — `setTransport(fakeTransport(...))` installs an in-memory backend
   (`ui/_fakeTransport`, seeded from `ui/_baseFixtures`), so components that fetch on mount
   settle instead of sitting in "Loading…".

7. **`preview-head.html`** sets `window.__BISMUTH_FIRST_RUN__ = true` before the preview bundle
   evaluates, so `settings.ts` takes its first-run branch and skips the `EventSource` +
   `GET /settings` sync (there is no backend: otherwise failed-fetch spam).

## `main.ts`

- **`cacheDir`** is per checkout (`app/.storybook-cache/sb-vite`, gitignored). The default lives
  under `node_modules/.cache`, which a worktree symlinks to the main checkout, so two Storybooks
  would re-optimize deps into one directory and white-screen each other's open tab.
- **`server.fs.allow`** is widened to the real workspace root. A worktree has its own `bun.lock`,
  which stops Vite's auto-detection at the worktree root, and symlinked `node_modules` assets
  (`@font-face` urls) then 403 and silently fall back to a system font.

## Notes

- A story id comes from `meta.title`, not the file path: copy it from
  `curl -s :6006/index.json | jq -r '.entries|keys[]'`.
- `ChipToggle` tones (`teal | blue | violet | green | gold | rose`, accent when unset) map to
  Button's `accent` prop as `var(--<tone>)`, which `.btn--text.btn--selected` in
  `ui/Button.module.css` reads.
