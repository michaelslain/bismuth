# Settings Page — Design

**Date:** 2026-05-26
**Status:** Approved

## Goal

Add a settings page to the Three Brains app covering four areas — Appearance,
Graph, Editor behavior, and Vault & backup. Today the app has **no persisted
user config**: vault/port come from CLI args and all visual choices (graph
palette, spin, physics; editor font/size; accent color) are hardcoded. This
introduces a settings store and surfaces those knobs.

## UI container

Settings opens as a **tab** (reusing the existing tab system), not a modal. A
sentinel tab id `"::settings"` is pushed into `tabs` and made active by a gear
button in the sidebar. The editor pane special-cases `active() === "::settings"`
to render `<Settings/>`; `tabLabel` shows "⚙ Settings". It closes like any tab.
The page is a single scrolling column with four section headers and labeled
controls, plus a "Reset to defaults" button.

## Persistence & state — `app/src/settings.ts` (new)

- A `Settings` type + `DEFAULTS` whose values equal today's hardcoded behavior,
  so day-one behavior is unchanged.
- Hydrated from `localStorage["three-brains.settings"]`, merged over `DEFAULTS`
  via a pure `loadSettings(raw: string | null): Settings` function (unit-tested).
- Exposed as a SolidJS `createStore` singleton: `settings`, `setSettings`,
  `resetSettings`. A root effect serializes to `localStorage` on change.

## Settings (default = current hardcoded value)

| Section | Setting | Default |
|---|---|---|
| Appearance | Accent color | `#6496ff` |
| | Theme | `dark` (light = second CSS-variable block) |
| | Editor font | `Lora` (select of ~4) |
| | Editor font size | `16` (px) |
| Graph | Spin on/off + speed | on, `0.0015` /frame |
| | Node palette | "Aurora" (current pink→blue) + 2–3 presets |
| | Repulsion / link distance / centering | `-7` / `5` / `0.13` |
| | Node size | `6` |
| Editor | Live preview | on |
| | Line numbers | off |
| | Line wrapping | on |
| | Auto-save delay | `800` (ms) |
| Vault & backup | Vault path | read-only (new `GET /config`) |
| | Backup on save | on (gates existing save-time backup) |
| | "Backup now" button | existing `POST /backup` |

## How each section applies live

- **Appearance** — a root effect writes CSS variables (`--accent`,
  `--editor-font`, `--editor-font-size`, …) onto `:root` and sets a `data-theme`
  attribute. `App.css` and the CodeMirror editor theme are refactored to read
  those variables. Light theme is a second variable block keyed on `data-theme`.
- **Graph** — `GraphView` pushes a `GraphConfig` (derived from `settings.graph`)
  to a new `renderer.setConfig(cfg)` inside an effect. Spin speed and node size
  are read live each frame. Palette/physics changes update the d3 forces and
  reheat the sim (`sim.alpha(...).restart()`) and rebuild node/edge colors — no
  full reload. Builds on the existing uncommitted `WebGLRenderer.ts` changes.
- **Editor** — `Editor.tsx` reads `settings.editor` when building its extension
  list (conditional live-preview, line numbers, line wrapping; auto-save delay;
  font/size in the theme). Its existing rebuild-on-path-change effect re-applies.
- **Vault/backup** — new `GET /config` returns `{ vault }`; backup button reuses
  `api.backup()`. `backupOnSave` gates the existing save-time `api.backup()` call.

## Out of scope

- Changing the vault path live (it's a launch arg → needs a core restart). The
  field is read-only display only.

## Files

- **New:** `app/src/settings.ts`, `app/src/Settings.tsx`.
- **Edit:** `app/src/App.tsx`, `app/src/App.css`, `app/src/Editor.tsx`,
  `app/src/GraphView.tsx`, `app/src/graph/WebGLRenderer.ts`, `app/src/api.ts`,
  `core/src/server.ts`.

## Testing

- Bun test for the new `GET /config` endpoint (`core/test/server.test.ts`).
- Unit test for the pure `loadSettings(raw)` merge function.
- Manual verification by running the app (appearance/graph/editor live-apply,
  persistence across reload, reset-to-defaults).
