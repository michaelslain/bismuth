# Shell Layout

The `layout:` group in `.settings` rearranges the window's big pieces: which edge the sidebar and the vertical tab rail sit on, which sidebar sections show and in what order, and whether the status bar is there. Every key is optional; with none set the window looks exactly as it always has. The pure helpers behind it are in `core/src/shellLayout.ts`; the schema is in `core/src/schema/settingsSchema.ts`.

```yaml
layout:
  sidebarSide: left                  # left | right
  tabRailSide: right                 # left | right
  sidebar: [toolbar, files, graph]   # top to bottom; leave an id out to hide that section
  statusBar: true
```

| Key | Type | Default | Meaning |
|-----|------|---------|---------|
| `sidebarSide` | `left` \| `right` | `left` | Window edge the sidebar sits flush against. |
| `tabRailSide` | `left` \| `right` | `right` | Window edge the tab rail sits flush against. |
| `sidebar` | list of `toolbar` \| `files` \| `graph` | `[toolbar, files, graph]` | Sections top to bottom. Order and presence are both honoured. |
| `statusBar` | boolean | `true` | `false` removes the 18px bottom bar; the editor and sidebar then reach the window's bottom edge. |

## Same-side rule

The two side keys are independent. When both name the same edge, the **sidebar is outermost** and the tab rail sits between it and the editor: `sidebar | rail | editor` on the left, `editor | rail | sidebar` on the right. The tab rail's hover flyout opens over the editor and never covers the sidebar.

## Sidebar sections

- `normalizeSidebarSections` reads the list: unknown ids are dropped (the schema also rejects them), a duplicate keeps its first occurrence, and a value that is not a list falls back to the default order.
- An empty list `[]` gives an empty sidebar column, which can still be toggled and resized. It is not an error.
- **Parked graph rule:** leaving `graph` out removes the docked mini graph. While a note is open the always-mounted graph floater then parks, invisible and inert, instead of floating over nothing. The full-view graph tab, the home graph shown when no tab is open and the Cmd+O switcher backdrop are unaffected.

## Palette commands

Settings have no GUI, so three palette commands change these keys and write `.settings`: `move-sidebar-side`, `move-tab-rail-side` and `toggle-status-bar`. Their labels are `Move sidebar to other side`, `Move tab rail to other side` and `Toggle status bar`; each flips one key live (the columns animate with the usual 0.26s ease where a width changes). They have no keybindings; reach them from the palette or a toolbar item.

## Not here yet

- **Widths** are not part of `layout:`; the sidebar, mini graph and tab rail sizes stay in `appearance:` (`sidebarWidth`, `sidebarGraphHeight`, `tabRailWidth`).
- **The top strip is fixed**; it cannot be moved or hidden.

See the [full reference](reference.md#layout) and the [overview](overview.md).
