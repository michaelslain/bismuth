# Shell layout

The `layout:` group in `.settings` rearranges the window's big pieces: which edge the sidebar and the vertical tab rail sit on, which sidebar sections show and in what order, and whether the status bar is there.
Every key is optional; with none set, the sidebar is on the left, the tab rail on the right, and the status bar shows.

```yaml
layout:
  sidebarSide: left                  # left | right
  tabRailSide: right                 # left | right
  sidebar: [toolbar, files, graph]   # top to bottom; leave an id out to hide that section
  statusBar: true
```

| Key | Type | Default | Meaning |
|---|---|---|---|
| `sidebarSide` | `left` or `right` | `left` | Window edge the sidebar sits flush against. |
| `tabRailSide` | `left` or `right` | `right` | Window edge the tab rail sits flush against. |
| `sidebar` | list of `toolbar`, `files`, `graph` | `[toolbar, files, graph]` | Sidebar sections from top to bottom. Order and presence both count. |
| `statusBar` | boolean | `true` | `false` removes the bottom bar, and the editor and sidebar then reach the window's bottom edge. |

## Change the layout without editing the file

Three palette commands flip these keys and write `.settings`: **Move sidebar to other side**, **Move tab rail to other side** and **Toggle status bar**. Each takes effect at once. They have no shortcuts; run them from the command palette or put them on a [toolbar button](toolbar-commands.md).

## When both panels share an edge

The two side keys are independent. When both name the same edge, the sidebar is outermost and the tab rail sits between it and the editor: `sidebar | rail | editor` on the left, `editor | rail | sidebar` on the right. The tab rail's hover flyout opens over the editor and never covers the sidebar.

## Choose and order sidebar sections

- An id the schema does not know is rejected by lint and dropped when read. A repeated id keeps its first occurrence. A value that is not a list gives the default order.
- An empty list `[]` gives an empty sidebar column, which can still be toggled and resized. It is not an error.
- Leaving `graph` out removes the docked mini graph. While a note is open, the graph then waits out of sight instead of floating over nothing. The full graph tab, the home graph shown when no tab is open and the Cmd+O switcher backdrop are unaffected.

## Widths and the top strip

Widths are not part of `layout:`. The sidebar, mini graph and tab rail sizes are `appearance.sidebarWidth`, `appearance.sidebarGraphHeight` and `appearance.tabRailWidth` in the [settings reference](reference.md#appearance); dragging a panel's edge writes them.
The top strip is fixed and cannot be moved or hidden.

## How it works

`core/src/shellLayout.ts` holds the pure helpers: `SIDEBAR_SECTIONS` (the section ids, also the default order), `normalizeSidebarSections` (unknown ids dropped, first occurrence wins, non-list gives the default), and `otherSide`.
The schema in `core/src/schema/settingsSchema.ts` derives the `sidebar` item enum from `SIDEBAR_SECTIONS`. The three palette commands flip the keys through the settings store in `app/src/App.tsx`.

Source: `core/src/shellLayout.ts`, `core/src/schema/settingsSchema.ts`, `app/src/App.tsx`, `app/src/shell/GraphFloater.tsx`
