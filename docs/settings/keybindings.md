# Keybindings

Every global shortcut in Bismuth is a named action with a default key combination. To change one, write its id under `keybindings:` in `.settings`. Read this page to rebind a shortcut that collides with your system, to give an action a second shortcut, or to look up what a shortcut does.

```yaml
keybindings:
  command-palette: Mod+Shift+K
  terminal: "Mod+`, Mod+J, Mod+Alt+T"
  find: ""
```

`Mod` means Cmd on macOS and Ctrl elsewhere. A comma separates alternatives, so `terminal` above opens with any of the three combos. An empty string unbinds an action.

## Rebind a shortcut

1. Run **Open Settings** from the command palette (Cmd+P).
2. Add a `keybindings:` key, indent under it, and type the action id. The [tables below](#the-full-keybinding_catalog) list every id.
3. After the colon, press Ctrl+Space. Choose **Record shortcut…** and press the combination you want. Escape cancels, a click outside the editor cancels, and a 3-second wait with no key cancels. Bare modifier presses are ignored until a real key lands.
4. Save. The new shortcut works immediately.

The recorder writes `Mod` for either Cmd or Ctrl. To pin a shortcut to one physical key, type it by hand with `Ctrl` or `Cmd`, as in the combo syntax below.

Autocomplete also offers the remaining modifiers and the keys: you can type a combo in any order, joined by `+`.

## Combo syntax

A combo is tokens joined by `+`. All tokens except the last are modifiers; the last token is the key. Tokens are case-insensitive and ignore spaces around the `+`.

| Modifier | Tokens | Matches |
|---|---|---|
| Portable | `Mod` | Cmd or Ctrl, whichever is held |
| Control | `Ctrl`, `Control` | Only the physical Ctrl key |
| Command | `Cmd`, `Command`, `Meta`, `Super` | Only the physical Cmd or Meta key |
| Alt | `Alt`, `Option`, `Opt` | Alt or Option |
| Shift | `Shift` | Shift |

`Ctrl` and `Cmd` are separate exact tokens, not other spellings of `Mod`. Use them when the portable fold is the problem.
For example, `open-completion` defaults to `Ctrl+Space, Mod+Shift+Space` because macOS reserves Ctrl+Space for switching input sources whenever more than one is enabled. Rebind it away from `Ctrl+Space` and every other `Mod` shortcut keeps working.

The key is compared to the key the keyboard produced, ignoring case. These aliases are accepted for the key:

| Alias | Key |
|---|---|
| `Esc` | `Escape` |
| `Return` | `Enter` |
| `Left`, `Right`, `Up`, `Down` | the matching arrow key |
| `Space`, `Spacebar` | the space bar |
| `Plus` | `+` |

Punctuation keys are written literally: `` ` `` `-` `=` `[` `]` `\` `;` `'` `.` `/`.

## Modifiers must match exactly

A combo fires only when the modifiers held are exactly the modifiers it names. `Mod+D` (split right) does not fire while Shift is held, and `Mod+Shift+D` (split down) does not fire without Shift.
Holding Cmd or Ctrl with a combo that names neither `Mod`, `Ctrl` nor `Cmd` also blocks it: `Alt+T` does not fire under `Cmd+Alt+T`.

## Alt combos on macOS

On macOS, holding Option produces a special character: Option+S types `ß`. The matcher therefore also compares the physical key, so `Alt+S`, `Alt+T` and `Mod+Alt+=` fire as written. You do not need to do anything for this to work.

## Several shortcuts for one action

List alternatives separated by commas; any one fires the action:

```yaml
keybindings:
  terminal: "Mod+`, Mod+J"
```

A comma splits the whole setting before it is parsed, so the comma key cannot be bound: `Mod+,` becomes the combos `Mod+` and an empty one, and neither matches.

## Silent failures

Nothing reports a bad combo; it just never fires.

- A bare shifted character matches nothing useful. Matching is exact, so `Z` alone matches a plain `z` press, never Shift+Z. `+` alone does not parse at all, and `_` alone never fires for Shift+`-`.
  Write the modifier: `Shift+Z`, `Shift+=`, `Shift+-`, or the alias `Plus`. The same holds for `!`, `@`, `#`, `$`, `%`, `^`, `&`, `*`, `(`, `)`, `{`, `}`, `:`, `"`, `<`, `>`, `?` and `~`: bind the unshifted key with `Shift+`.
- A combo with no key, such as `Mod` or an empty segment, never matches.
- An empty string unbinds the action. The one exception is `ui-dismiss`, which falls back to `Escape` so you can never rebind yourself out of closing a dialog.
- Another program may take the combo first. The operating system, a browser or an input method can consume a shortcut before Bismuth sees it. If a rebound combo does nothing, try a different one.

## Where shortcuts do not fire

- While a key is held. Auto-repeat is ignored, so holding a combo fires it once.
- In a text field, for three actions. `insert-template`, `toggle-sidebar` and `toggle-tab-rail` do nothing while focus is in a plain text input or text area, such as the palette search. They do work from a focused note.
- `toggle-draw-mode` is local to the note editor. It fires only when a note is focused, not globally, so that Escape-to-exit stays within that pane.

## The full `KEYBINDING_CATALOG`

Each id below is a key under `keybindings:`, with its default combo and the action it runs. The catalog in `core/src/keybindings.ts` is the source of truth for ids, defaults and descriptions, and every id in it is a valid key.

### Windows, tabs and navigation

| id | default | action |
|---|---|---|
| `command-palette` | `Mod+P` | Toggle command palette |
| `quick-ask` | `Mod+K` | Ask the daemon: open the chat in a popover beside the caret, or at the top of a pane that is not a note. Reopens the same conversation for the same note |
| `quick-switcher` | `Mod+O` | Toggle quick switcher |
| `terminal` | `` Mod+`, Mod+J `` | Open terminal |
| `new-tab` | `Mod+T` | New tab |
| `reopen-tab` | `Mod+Shift+T` | Reopen closed tab |
| `new-window` | `Mod+N` | New window |
| `open-folder` | `Mod+Shift+O` | Open folder |
| `export` | `Mod+Shift+P` | Export |
| `history-back` | `Mod+[` | Back |
| `history-forward` | `Mod+]` | Forward |
| `new-claude-chat` | `Mod+Shift+C` | New Claude chat |
| `insert-template` | `Alt+T` | Insert template |
| `toggle-sidebar` | `Alt+S` | Toggle sidebar |
| `toggle-tab-rail` | `Alt+Shift+S` | Toggle tab rail |
| `zoom-in` | `Mod+=, Mod+Shift+=` | Zoom in |
| `zoom-out` | `Mod+-` | Zoom out |
| `zoom-reset` | `Mod+0` | Reset zoom |

### Panes

| id | default | action |
|---|---|---|
| `split-right` | `Mod+D` | Split pane right |
| `split-down` | `Mod+Shift+D` | Split pane down |
| `equalize-panes` | `Mod+Alt+=` | Equalize panes |
| `close-pane` | `Mod+W` | Close pane |
| `focus-pane-left` | `Mod+Alt+ArrowLeft` | Focus pane left |
| `focus-pane-right` | `Mod+Alt+ArrowRight` | Focus pane right |
| `focus-pane-up` | `Mod+Alt+ArrowUp` | Focus pane up |
| `focus-pane-down` | `Mod+Alt+ArrowDown` | Focus pane down |

### Note editor

| id | default | action |
|---|---|---|
| `find` | `Mod+F` | Find in note |
| `toggle-bold` | `Mod+B` | Toggle bold |
| `toggle-italic` | `Mod+I` | Toggle italic |
| `indent` | `Tab` | Indent |
| `outdent` | `Shift+Tab` | Outdent |
| `open-completion` | `Ctrl+Space, Mod+Shift+Space` | Open autocomplete |
| `accept-completion` | `Tab` | Accept autocomplete suggestion |
| `toggle-draw-mode` | `Mod+Shift+I` | Toggle draw mode |
| `exit-draw-mode` | `Escape` | Exit draw mode |
| `ink-undo` | `Mod+Z` | Undo ink stroke |
| `ink-redo` | `Mod+Shift+Z` | Redo ink stroke |

### Chat

| id | default | action |
|---|---|---|
| `chat-send` | `Enter, Mod+Enter` | Send chat message |
| `chat-stop` | `Escape` | Stop chat response |
| `chat-history-prev` | `ArrowUp` | Recall previous chat message |
| `chat-history-next` | `ArrowDown` | Recall next chat message |

### File tree

| id | default | action |
|---|---|---|
| `undo-delete` | `Mod+Z` | Undo file-tree delete |
| `delete-selection` | `Delete, Backspace, Mod+Delete, Mod+Backspace` | Delete selected file |

### Flashcards

| id | default | action |
|---|---|---|
| `flashcard-flip` | `Space` | Flip flashcard |
| `flashcard-hard` | `1` | Grade flashcard hard |
| `flashcard-good` | `2` | Grade flashcard good |
| `flashcard-easy` | `3` | Grade flashcard easy |

### Graph

| id | default | action |
|---|---|---|
| `graph-reset-view` | `Escape` | Reset graph view |
| `graph-focus-node` | `Z, Shift+Z` | Focus hovered graph node |
| `graph-zoom-in` | `=, Shift+=, Plus` | Zoom graph in |
| `graph-zoom-out` | `-, Shift+-` | Zoom graph out |

### Panels and dialogs

| id | default | action |
|---|---|---|
| `ui-dismiss` | `Escape` | Dismiss panel |
| `ui-confirm` | `Enter` | Confirm panel |

Notes on individual actions:

- `new-tab` opens the home tab, which is the knowledge graph; [`homePage`](status-bar.md#home-page) does not change that.
- `open-completion` defaults to a second combo because `Ctrl+Space` is reserved by the macOS input-source switcher whenever more than one input source is enabled.
- `accept-completion` is rebindable; Enter also accepts a suggestion, and that Enter binding is fixed.
- `indent` runs only while no autocomplete popup is open to accept the suggestion instead, because both default to Tab.
- `toggle-draw-mode` is Ctrl+Shift+I on Linux and Windows, which collides with browser developer tools; rebind it if you hit that.
- `chat-send` includes `Mod+Enter` as well as Enter, because that sent a message before the binding was rebindable.
- `delete-selection` moves the selected file or folder to the trash, and `undo-delete` restores it.
- `graph-focus-node` resets the view when no node is hovered. It is bound to both `Z` and `Shift+Z` because a bare `Z` would not match Shift+Z.
- `graph-zoom-in` lists three alternatives for keyboards where the labelled plus needs Shift.
- `zoom-in`, `zoom-out` and `zoom-reset` zoom the whole app window, not a note. The level is a per-machine preference, not a `.settings` value.
- `toggle-tab-rail` pins the right tab rail open, or lets it return to expanding on hover. It is the sidebar's `Alt+S` plus Shift.

## Shared panel ids: ui-dismiss and ui-confirm

Dialogs, popovers, context menus, inline rename fields, the switcher and similar transient panels do not each have an id.
Two ids stand in for all of them: `ui-dismiss` (default `Escape`) closes or cancels the focused panel, and `ui-confirm` (default `Enter`) accepts it. Rebinding either retargets every panel that reads it.

- An empty `ui-dismiss` falls back to `Escape`. A real rebinding such as `Mod+.` replaces `Escape` outright.
- An empty `ui-confirm` disables keyboard confirm everywhere; every panel keeps a pointer alternative.
- Shift plus the confirm key (Shift+Enter by default) is a newline in multi-line fields and "previous match" in a find bar. It is derived from `ui-confirm`, so rebinding moves both.

Some panels keep their own local Enter and Escape handling and do not follow these two ids. If rebinding does nothing in one place, that panel is one of them.

## Shortcuts that are not rebindable

Some keys are part of how a control works rather than named commands, and have no id:

- Arrow-key navigation inside a list, menu, gallery or pager, and a table cell's Tab, Enter and Escape.
- The editor's built-in editing keys, such as undo, redo and bracket handling.
- Space on a toggle or other `role="button"` control, which is its activation key.
- The context-menu key and Shift+F10 for opening a context menu.

## How it works

`KEYBINDING_CATALOG` in `core/src/keybindings.ts` is an ordered list of `{id, label, default, doc}`.
`core/src/schema/settingsSchema.ts` derives one `keybind` field per entry, so the catalog drives `DEFAULTS`, autocomplete, lint and the schema-to-`Settings` parity test.
The `keybind` type validates any string; correctness is enforced when a key is pressed, and an unparseable combo returns `null` from `parseCombo` and never matches. The `keybindings` section is last in the schema, which a test enforces.

`app/src/keybindings.ts` holds the pure matcher. `parseCombo` splits a combo on `+` into modifier flags and a lowercased key.
`matchesCombo` requires the modifier flags to equal the event's, then accepts the combo if either `event.key` or the physical key from `codeToKey(event.code)` matches.
`matchesKeybinding` splits the setting on commas and returns true if any non-empty alternative matches; an empty or nullish setting returns false.

`codeToKey` maps `Key<A-Z>`, `Digit<0-9>`, `Numpad<0-9>` and punctuation codes to a key, and returns `null` for named keys such as arrows and Enter, which Option does not mangle and which match on `event.key`.

`App.tsx`'s global `keydown` handler reads `settings.keybindings` and tests each id with `matchesKeybinding`; the first match wins. It ignores auto-repeat. `split-down` is tested before `split-right`.
`toggle-draw-mode` is matched by a capture-phase listener on each note editor (`onDrawKey` in `app/src/Editor.tsx`), gated on the note being inkable.
Editor actions such as `toggle-bold` and `indent` reach CodeMirror through a settings-driven keymap (`app/src/editor/settingsKeymap.ts`), which converts each combo to CodeMirror's key syntax with `toCmKeys`, so there is one copy of each combo.

`app/src/ui/widgetKeys.ts` exposes `isDismissKey` and `isConfirmKey`, which panels call instead of testing `e.key === 'Escape'`.
`app/src/keybindingCoverage.test.ts` fails when `app/src` gains a hardcoded key literal outside its typed allow-list, and each allow-list entry carries a reason.
Entries marked `PENDING SWEEP` are surfaces whose local Enter or Escape handling has not moved to the shared ids yet.

`eventToCombo` turns a key press into a combo string for the recorder: it writes `Mod` when Cmd or Ctrl is held, then `Alt`, `Shift`, and the physical key. It returns `null` for a bare modifier, which keeps the recorder listening.
The recorder (`recordShortcut` in `app/src/editor/settingsComplete.ts`) is scoped to the settings editor and tears down on Escape, blur or a 3-second timeout.

### Add a keybinding

1. Add `{ id, label, default, doc }` to `KEYBINDING_CATALOG`. The schema field, autocomplete, lint and default follow.
2. In the handler that should fire it, test `matchesKeybinding(e, settings.keybindings[id])` and act on a match.

Both the catalog and the matcher are pure; `app/src/keybindings.test.ts` holds the canonical examples.

Source: `core/src/keybindings.ts`, `app/src/keybindings.ts`, `app/src/keybindings.test.ts`, `app/src/ui/widgetKeys.ts`, `app/src/keybindingCoverage.test.ts`, `core/src/schema/settingsSchema.ts`, `app/src/editor/settingsComplete.ts`, `app/src/editor/settingsKeymap.ts`, `app/src/App.tsx`, `app/src/Editor.tsx`
