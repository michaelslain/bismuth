# Keybindings

Bismuth's global keyboard shortcuts are configured entirely from the `keybindings:` section of `.settings` — **nothing is hardcoded in the app**. Every action id, its default combo, and its doc string come from a single source of truth (`core/src/keybindings.ts` `KEYBINDING_CATALOG`); the settings schema derives one `keybind`-typed YAML key per action from it, and `App.tsx`'s global `keydown` handler matches each `KeyboardEvent` against the configured combo via the pure matcher in `app/src/keybindings.ts`. This file documents the combo syntax (`"Mod"`, exact modifier matching, key aliases, comma-separated alternatives, `event.code` physical-key matching), the full catalog of every action id + default, and the `keybind` PropertyType (autocomplete + the "Record shortcut…" recorder).

## The `keybindings:` section

In `.settings`, `keybindings:` is a nested object — one key per app-level action, whose value is a `keybind` combo string. It is authored last in a freshly generated `.settings` file (it "sits at the end of the file"), and is a regular nested object (not a list) so the per-key merge — autocomplete, lint, the schema↔interface parity test, and `POST /set-setting` — work without any special-casing.

```yaml
keybindings:
  find: Mod+F
  command-palette: Mod+P
  quick-switcher: Mod+O
  terminal: Mod+`, Mod+J
  split-right: Mod+D
  split-down: Mod+Shift+D
  equalize-panes: Mod+Alt+=
  close-pane: Mod+W
  new-tab: Mod+T
  reopen-tab: Mod+Shift+T
  history-back: Mod+[
  history-forward: Mod+]
  focus-pane-left: Mod+Alt+ArrowLeft
  focus-pane-right: Mod+Alt+ArrowRight
  focus-pane-up: Mod+Alt+ArrowUp
  focus-pane-down: Mod+Alt+ArrowDown
  new-claude-chat: Mod+Shift+C
  insert-template: Alt+T
  toggle-sidebar: Alt+S
  zoom-in: Mod+=, Mod+Shift+=
  zoom-out: Mod+-
  zoom-reset: Mod+0
```

Each value above is the action's **default** — defaults equal the combos that were previously hardcoded in `App.tsx`, so writing the schema's defaults into a file is a behavioral no-op. To rebind an action, change the string. To remove a shortcut, set it to an empty string (an empty/nullish setting matches nothing — `matchesKeybinding(e, "")` and `matchesKeybinding(e, undefined)`/`null` all return `false`).

Settings are persisted by PATCHing only the changed leaf via `POST /set-setting` (the backend merges that one key in place, preserving comments/order); see [the settings overview](./overview.md).

## Combo syntax

A combo is a `"+"`-joined list of tokens. All tokens except the last are modifiers; the **final token is the key**. Tokens are whitespace-tolerant and case-insensitive (`mod + alt + ArrowRight` parses the same as `Mod+Alt+ArrowRight`).

```
"Mod+P"                 → Mod + key P
"Mod+Shift+D"           → Mod + Shift + key D
"Mod+Alt+ArrowLeft"     → Mod + Alt + key ArrowLeft
"Mod+`"                 → Mod + key ` (backtick)
"Alt+T"                 → Alt + key T
```

### Modifier tokens

The matcher folds several spellings into three modifier flags (`mod`, `alt`, `shift`):

| Flag    | Accepted tokens (case-insensitive)                          |
|---------|------------------------------------------------------------|
| `mod`   | `Mod`, `Cmd`, `Command`, `Ctrl`, `Control`, `Meta`, `Super` |
| `alt`   | `Alt`, `Option`, `Opt`                                      |
| `shift` | `Shift`                                                     |

`"Mod"` is the portable, recommended modifier: it matches **Cmd on macOS / Ctrl elsewhere** — internally it matches when *either* `event.metaKey` OR `event.ctrlKey` is held (mirroring CodeMirror's convention). So `Cmd+P`, `Ctrl+P`, and `Meta+P` all parse to the same `mod: true` combo, and a literal `Mod+P` setting fires under both Cmd and Ctrl:

```
matchesCombo(<key p, meta>, "Mod+P")   // true
matchesCombo(<key p, ctrl>, "Mod+P")   // true
parseCombo("Cmd+P").mod === true
parseCombo("Ctrl+P").mod === true
parseCombo("Meta+P").mod === true
```

A token counts as a modifier **only when it is not the final (key) token**. This means `Shift` typed *last* is treated as a literal key (a degenerate edge case), not a modifier.

### The key token

The key is the last `"+"`-separated token. Comparison against `KeyboardEvent.key` is **case-insensitive** (Shift uppercases the produced key — e.g. holding Shift makes the event report `"D"` — but `Mod+Shift+D` still matches because the key compare is lowercased on both sides).

Friendly key aliases are normalized to the lowercased `KeyboardEvent.key` they represent:

| Alias (any case)          | Normalized key   |
|---------------------------|------------------|
| `Esc`                     | `escape`         |
| `Return`                  | `enter`          |
| `Left`                    | `arrowleft`      |
| `Right`                   | `arrowright`     |
| `Up`                      | `arrowup`        |
| `Down`                    | `arrowdown`      |
| `Space`, `Spacebar`       | `" "` (a space)  |
| `Plus`                    | `+`              |

So `Mod+Alt+Left` and `Mod+Alt+ArrowLeft` are equivalent; `Esc` and `Escape` are equivalent; `Plus` and `+` are equivalent. Punctuation keys can be used literally too: `` ` `` (backtick), `-`, `=`, `[`, `]`, `\`, `;`, `'`, `,`, `.`, `/`.

### Empty / modifier-only combos

A combo with no key token is invalid and never matches:

```
parseCombo("")      === null
parseCombo("   ")   === null
```

(A combo must end in a key; a bare `"Mod"` or `"Shift"` does not parse to a usable binding.)

## Exact modifier matching

Modifier matching is **exact**: a combo with no `Shift` token does NOT fire while Shift is held, and a combo without `Mod` does NOT fire when Cmd/Ctrl is held. This is what keeps closely-related bindings distinct (e.g. `split-right` = `Mod+D` vs `split-down` = `Mod+Shift+D` never collide):

```
matchesCombo(<d, meta>,        "Mod+D")         // true
matchesCombo(<d, meta+shift>,  "Mod+D")         // false  (extra Shift rejected)
matchesCombo(<d, meta+shift>,  "Mod+Shift+D")   // true
matchesCombo(<d, meta>,        "Mod+Shift+D")   // false  (missing Shift)

matchesCombo(<t, alt>,         "Alt+T")         // true
matchesCombo(<t, alt+meta>,    "Alt+T")         // false  (extra Mod rejected)
matchesCombo(<p>,              "Mod+P")         // false  (missing Mod)
```

Concretely, `matchesCombo` requires all three to hold:
- `combo.mod === (event.metaKey || event.ctrlKey)`
- `combo.alt === event.altKey`
- `combo.shift === event.shiftKey`

…plus a key match (next section).

## Physical `event.code` matching (Option-composed keys)

On macOS, holding **Option (Alt)** composes a special character, so `event.key` is mangled: `Alt+S` reports `event.key === "ß"`, `Alt+T` reports `"†"`, `Mod+Alt+=` reports `"≠"`. Comparing only against `event.key` would make *every* Alt combo silently fail.

To survive this, the matcher also compares against the layout- and modifier-independent **`event.code`** (`KeyS`, `Digit1`, `Equal`), which Option does not affect. A combo fires if **EITHER** the produced key (`event.key`) **OR** the physical key (`codeToKey(event.code)`) matches:

```
matchesCombo(<key "ß", alt,  code KeyS>,        "Alt+S")        // true  (physical match)
matchesCombo(<key "†", alt,  code KeyT>,        "Alt+T")        // true
matchesCombo(<key "≠", meta+alt, code Equal>,   "Mod+Alt+=")    // true
matchesCombo(<key "ß", alt,  code KeyS>,        "Alt+A")        // false (wrong physical key)
```

### `codeToKey(code)` resolution

`codeToKey` maps a physical `event.code` to the normalized single-key string, or `null` when the code has no stable single-key mapping:

- `Key<A-Z>` → lowercased letter (`KeyS` → `"s"`).
- `Digit<0-9>` and `Numpad<0-9>` → the digit (`Digit1` → `"1"`, `Numpad5` → `"5"`).
- Punctuation/space codes map via a table:

  | code | key | | code | key |
  |------|-----|-|------|-----|
  | `Minus` | `-` | | `Comma` | `,` |
  | `Equal` | `=` | | `Period` | `.` |
  | `BracketLeft` | `[` | | `Slash` | `/` |
  | `BracketRight` | `]` | | `Space` | `" "` |
  | `Backslash` | `\` | | `NumpadAdd` | `+` |
  | `Semicolon` | `;` | | `NumpadSubtract` | `-` |
  | `Quote` | `'` | | `NumpadMultiply` | `*` |
  | `Backquote` | `` ` `` | | `NumpadDivide` | `/` |
  | | | | `NumpadDecimal` | `.` |

- Named keys (arrows, Enter, etc.) and unmapped/empty codes → `null`. These aren't mangled by Option, so they keep matching via `event.key`:

  ```
  codeToKey("ArrowLeft")  === null
  codeToKey("Enter")      === null
  codeToKey(undefined)    === null
  codeToKey("")           === null
  ```

  This is why arrow-key combos like `Mod+Alt+ArrowLeft` match via `event.key` directly:
  ```
  matchesCombo(<ArrowLeft, meta+alt>, "Mod+Alt+ArrowLeft")  // true
  matchesCombo(<`, meta>,             "Mod+`")              // true
  ```

## Comma-separated alternatives

A keybinding setting may list **multiple combos separated by commas**; any one matching wins. This is how `terminal` is bound to both `Mod+` `` ` `` and `Mod+J` by default:

```yaml
keybindings:
  terminal: "Mod+`, Mod+J"
```

```
matchesKeybinding(<`, meta>, "Mod+`, Mod+J")   // true
matchesKeybinding(<j, meta>, "Mod+`, Mod+J")   // true
matchesKeybinding(<k, meta>, "Mod+`, Mod+J")   // false
```

`matchesKeybinding(event, setting)` splits the setting on `,`, trims each combo, and returns `true` if any non-empty combo matches via `matchesCombo`. An empty/whitespace-only/undefined/null setting returns `false`.

> Note: combos are split on `,` at the **setting** level. A literal comma key still works because `parseCombo` splits a single combo on `+` (not `,`). To bind the comma key, just use `,` as the final token in one combo, e.g. `Mod+,` — only top-level commas separate alternatives.

## The full `KEYBINDING_CATALOG`

Every action id, its human label, default combo, and what it does. Ids are the YAML keys under `keybindings:`. Source of truth: `core/src/keybindings.ts`.

| id | Default | Label / behavior |
|----|---------|------------------|
| `find` | `Mod+F` | Find in note — open the in-note find bar in the focused editor (searches the current note). |
| `command-palette` | `Mod+P` | Toggle command palette — open/close the command palette. |
| `quick-switcher` | `Mod+O` | Toggle quick switcher — open/close the quick file switcher. |
| `terminal` | `` Mod+`, Mod+J `` | Open terminal — open a terminal tab (comma-separated alternatives allowed). |
| `split-right` | `Mod+D` | Split pane right — split the focused pane into a new (empty) pane to the right. |
| `split-down` | `Mod+Shift+D` | Split pane down — split the focused pane into a new (empty) pane below. |
| `equalize-panes` | `Mod+Alt+=` | Equalize panes — reset all split panes to equal sizes. |
| `close-pane` | `Mod+W` | Close pane — close the focused pane (closes the whole tab when it's the last pane). |
| `new-tab` | `Mod+T` | New tab — open a new tab (the Knowledge Graph home). |
| `reopen-tab` | `Mod+Shift+T` | Reopen closed tab — reopen the most recently closed tab. |
| `history-back` | `Mod+[` | Back — go back in the focused pane's navigation history. |
| `history-forward` | `Mod+]` | Forward — go forward in the focused pane's navigation history. |
| `focus-pane-left` | `Mod+Alt+ArrowLeft` | Focus pane left — move focus to the pane on the left. |
| `focus-pane-right` | `Mod+Alt+ArrowRight` | Focus pane right — move focus to the pane on the right. |
| `focus-pane-up` | `Mod+Alt+ArrowUp` | Focus pane up — move focus to the pane above. |
| `focus-pane-down` | `Mod+Alt+ArrowDown` | Focus pane down — move focus to the pane below. |
| `new-claude-chat` | `Mod+Shift+C` | New Claude chat — open a new Claude Code chat session in its own tab. |
| `insert-template` | `Alt+T` | Insert template — open the template-insertion palette (ignored while typing in a form field). |
| `toggle-sidebar` | `Alt+S` | Toggle sidebar — show/hide the left sidebar (ignored while typing in a form field). |
| `zoom-in` | `` Mod+=, Mod+Shift+= `` | Zoom in — increase the whole app's UI zoom one step (whole-app native webview zoom, not a note/editor zoom). The Shift alternative covers keyboards where the labeled "+" requires Shift. |
| `zoom-out` | `Mod+-` | Zoom out — decrease the whole app's UI zoom one step. |
| `zoom-reset` | `Mod+0` | Reset zoom — reset the whole app's UI zoom to 100%. |

`KEYBINDING_CATALOG` is an ordered array (`KeybindingSpec[]`) — iterating it in order yields these ids.

### How `App.tsx` consumes them

The global `keydown` handler reads `settings.keybindings` (reactive) and tests each binding with `matchesKeybinding`; the first match wins (`return` after handling), and most call `e.preventDefault()` to suppress the browser's default (print/open/etc.). Notable handler details verified in `App.tsx`:

- `if (e.repeat) return;` at the top — auto-repeat keydowns are ignored, so holding a combo fires once.
- These shortcuts **fire even while the editor is focused** — CodeMirror doesn't bind them, and the note editor is `contentEditable` (not an `INPUT`/`TEXTAREA`).
- **`insert-template` and `toggle-sidebar` are suppressed while typing in a form field**: the handler checks `e.target.tagName` and skips when it's `INPUT` or `TEXTAREA` (palette search, calendar title, etc.). Because the note editor is `contentEditable` (not those tags), inserting a template from a focused note still works.
- `command-palette`/`quick-switcher` **toggle** (open if closed, close if already showing that palette).
- `split-down` is checked before `split-right` because `Mod+Shift+D` is a superset of `Mod+D`'s modifiers; the exact-match rule keeps them distinct (`Mod+D` won't fire when Shift is held). The new pane is empty (`EMPTY_PANE`).
- Pane-focus directions are matched from a `[id, dir]` table: `focus-pane-left|right|up|down` → move focus to the neighbor in that direction (no-op if no neighbor).

## The `keybind` PropertyType

`keybind` is a string-valued `PropertyType` in the settings schema (`core/src/schema/types.ts`). The `keybindings` section is built by deriving one entry per catalog action:

```ts
// core/src/schema/settingsSchema.ts
const keybindingFields: Schema = {};
for (const k of KEYBINDING_CATALOG) {
  keybindingFields[k.id] = { type: "keybind", default: k.default, doc: k.doc };
}
// …
keybindings: object(keybindingFields),
```

Because the schema is the single source of truth, the catalog drives:
- **`DEFAULTS`** — `deriveDefaults` materializes each field's `default`, so `settings.keybindings.<id>` is seeded synchronously on boot.
- **`reconcileSettings`** — adds any missing key to an existing `.settings`, preserving comments.
- **The `keybind`-typed autocomplete + linter** (next section).
- **The schema↔`Settings`-interface parity test** (`app/src/settings.ts` must mirror the schema).

### Validation

The `keybind` type validates leniently as a string (any string is accepted at the schema level). Correctness is really enforced at match time — an unparseable combo just never fires (`parseCombo` returns `null` → `matchesCombo` returns `false`).

## Autocomplete + the "Record shortcut…" recorder

The `keybind` type drives a smart, **order-free** autocomplete in the settings editor (`app/src/editor/settingsComplete.ts` → `keybindCompletions`), dispatched when the property under the cursor has type `keybind`.

### Order-free combo completion

The grammar is order-free: modifiers and the key can be typed in any order, joined by `+`, with comma-separated alternatives. The completion targets the **current token** — the text after the last `+` within the current `,`-separated combo — and offers:

1. **`Record shortcut…`** action (highest priority, `boost: 99`) — see below.
2. **Remaining modifier families** from `KEYBIND_MODIFIERS` (`["Mod", "Alt", "Shift", "Cmd", "Ctrl", "Meta"]`). `"Mod"` is the portable default; `Cmd`/`Ctrl`/`Meta` are offered for users who want an explicit platform key. Applying a modifier appends `"+"` so the combo keeps building (`boost: 10`).
3. **Keys** from `KEYBIND_KEYS`: `A–Z`, `0–9`, the arrows, `Enter`/`Escape`/`Tab`/`Space`/`Backspace`/`Delete`, `Home`/`End`/`PageUp`/`PageDown`/`Insert`, `F1–F12`, and punctuation `` ` `` `-` `=` `[` `]` `\` `;` `'` `,` `.` `/`. (Case in this list is cosmetic — `parseCombo` lowercases when matching.)

**Family de-duplication**: once a modifier from a family is present in the current combo, that whole family is hidden. Typing `Mod` drops `Cmd`/`Ctrl`/`Meta` (all the `mod` family) from further suggestions. This uses `modifierFamily(token)`:

```
modifierFamily("Mod")   === "mod"
modifierFamily("cmd")   === "mod"
modifierFamily("Ctrl")  === "mod"
modifierFamily("Option")=== "alt"
modifierFamily("Shift") === "shift"
modifierFamily("D")     === null   // plain key
modifierFamily("ArrowLeft") === null
```

The completion auto-pops only when there's something to complete (after a `+`/`,` separator, or with a non-empty token), and is always available on explicit invocation (Ctrl-Space).

### The recorder

Choosing **`Record shortcut…`** runs `recordShortcut(view, valueFrom)`, which:

- Adds a capture-phase `keydown` listener on `window` and shows a toast: *"Recording shortcut… press keys"* (~3.2s).
- **Swallows every keystroke** while recording (`preventDefault` + `stopPropagation` in the capture phase) so keys don't type into the editor or fire app shortcuts.
- Converts each event with `eventToCombo(e)`. A **bare modifier press** (`Shift`/`Control`/`Alt`/`Meta`/`OS`/`AltGraph` alone) returns `null` → keep listening until a real key lands.
- On the first real key, replaces the keybind value (from `valueFrom` to end of line) with the captured combo and re-focuses the editor.
- **Times out after 3 seconds** with no captured key (`setTimeout(() => finish(null), 3000)`) and writes nothing.

### `eventToCombo(e)` — how a press becomes a combo string

Used by the recorder to serialize a `KeyboardEvent`:

- Returns `null` for a bare modifier press (`["Control","Shift","Alt","Meta","OS","AltGraph"].includes(e.key)`), so the recorder keeps waiting.
- Builds tokens in fixed order: `Mod` (if `metaKey || ctrlKey`), then `Alt` (if `altKey`), then `Shift` (if `shiftKey`), then the key.
- **Prefers the physical key** (`codeToKey(e.code)`) so Option-composed characters record as the key actually pressed; falls back to the produced `e.key` for named keys. The key is shown via `displayKey` — `" "` → `Space`, single chars uppercased (`d` → `D`), multi-char names kept as-is (`ArrowLeft`).

```
eventToCombo(<d, meta+shift>)             === "Mod+Shift+D"
eventToCombo(<p, ctrl>)                   === "Mod+P"
eventToCombo(<ArrowLeft, meta+alt>)       === "Mod+Alt+ArrowLeft"
eventToCombo(<" ", alt>)                  === "Alt+Space"
eventToCombo(<t, alt>)                    === "Alt+T"
eventToCombo(<key "ß", alt, code KeyS>)   === "Alt+S"            // physical key recorded
eventToCombo(<key "≠", meta+alt, code Equal>) === "Mod+Alt+="
eventToCombo(<Shift, shift>)              === null               // bare modifier → keep listening
eventToCombo(<Meta, meta>)               === null
eventToCombo(<Control, ctrl>)            === null
```

## Adding a keybinding

To add a new global shortcut (mirrors the [commands](./toolbar-commands.md) split-data pattern):

1. Add an entry to `KEYBINDING_CATALOG` in `core/src/keybindings.ts`: `{ id, label, default, doc }`. The schema field, its autocomplete, lint, and default are derived automatically.
2. In the handler that should fire it (typically `App.tsx`'s `handleGlobalKeydown`), read `settings.keybindings.<id>` via `matchesKeybinding(e, ...)` and act on a match (usually `e.preventDefault()` then the action, then `return`).

Because both the catalog (ids + defaults) and the matcher are pure, both are unit-tested — see `app/src/keybindings.test.ts` for the canonical examples used throughout this doc.

## Gotchas

- **`"Mod"` is platform-portable, prefer it** over literal `Cmd`/`Ctrl` unless you specifically want one platform's key. `Mod` matches `metaKey OR ctrlKey`.
- **Matching is exact on modifiers** — adding an unexpected modifier (e.g. holding Shift) makes a non-Shift combo *not* fire. This is intentional (keeps `Mod+D` and `Mod+Shift+D` distinct).
- **macOS Option composes characters** — always rely on the `event.code` fallback; the recorder and matcher both handle it, but if you hand-author an Alt combo it will still match because of `codeToKey`.
- **`insert-template`/`toggle-sidebar` are suppressed in `INPUT`/`TEXTAREA`** but still work from a focused note (the note editor is `contentEditable`, not an input).
- **Auto-repeat is ignored** (`e.repeat` short-circuits the handler), so holding a combo fires once, not repeatedly.
- **An empty string disables a binding** (`matchesKeybinding` returns false for empty/nullish).
- **Comma is the alternative separator** at the setting level; `+` is the combo separator. Bind the comma key as `Mod+,` (one combo) — only top-level commas split alternatives.

## See also

- [Settings overview](./overview.md) — `.settings` lifecycle, schema, `POST /set-setting`.
- [Commands & toolbar](./toolbar-commands.md) — the parallel split-data pattern for commands (`COMMAND_CATALOG` + `bindCommands`).

Source: `core/src/keybindings.ts`, `app/src/keybindings.ts`, `app/src/keybindings.test.ts`, `core/src/schema/settingsSchema.ts`, `core/src/schema/types.ts`, `app/src/editor/settingsComplete.ts`, `app/src/App.tsx`
