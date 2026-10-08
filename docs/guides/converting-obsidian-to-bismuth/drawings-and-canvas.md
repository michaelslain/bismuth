# Converting Obsidian canvas and Excalidraw files

Bismuth reads neither Obsidian canvases nor Excalidraw drawings, so this page keeps the files on disk, preserves their content as images where the user wants it, and reports every loss. Bismuth's own drawing formats (`.draw` files and ` ```draw ` fences) have no Obsidian source, so nothing converts into them.

## Sources

- Bismuth: `docs/drawing/overview.md` (`.draw` files), `docs/editor/ink.md` (` ```draw ` fences), `docs/vault/attachments.md` (what can be embedded), `docs/vault/structure.md` (which file types the tree shows).
- Obsidian: https://obsidian.md/help/plugins/canvas, https://obsidian.md/help/file-formats, https://jsoncanvas.org/spec/1.0/
- Excalidraw plugin (only if `obsidian-excalidraw-plugin` is in `community-plugins.json`): https://github.com/zsviczian/obsidian-excalidraw-plugin

## Format differences

The table orients you; where a linked live page disagrees, follow the live page and note the difference in the report.

| Obsidian | In Bismuth |
|---|---|
| `.canvas` (JSON Canvas: `nodes` and `edges`) | not read, not listed in the tree, not embeddable; the file stays on disk |
| `![[Board.canvas]]` | a "note not found" widget |
| `.excalidraw.md` notes (Excalidraw plugin) | an ordinary note showing the plugin's raw text; no Excalidraw code path |
| Excalidraw auto-export PNG/SVG copy (a plugin setting) | an image; embeds like any image |
| stroke ink | none in Obsidian; nothing to import |

## Convert

1. Canvas: leave each `.canvas` where it is (the rsync in the guide's step 1 already copied it) and list every canvas path in the report as lossy. If the user wants the content kept visible, ask them to export an image from Obsidian and embed it as `![[Board.png]]`. Do not hand-translate nodes.
2. Excalidraw (only when the plugin is present): for each `.excalidraw.md`, ask the user to enable the plugin's auto-export (a PNG or SVG copy on save) or to export an image. Put the image next to the note and add `![[<name>.png]]` to the top of the note body. Leave the original note and report each one.
3. Remove stale `![[X.canvas]]` embeds only if the user agrees; otherwise leave them and report them.

## Lossy

- Everything in a canvas (cards, connections, layout) is invisible in Bismuth.
- Excalidraw drawings are viewable only as exported images.

## Validate

- `bismuth tree --vault "$OUT" --pretty | grep -ci canvas` prints `0`, because canvas files are not in the tree, and every canvas path is in the report.
- Any image you added resolves: the unresolved-links check in [the conversion guide](../converting-obsidian-to-bismuth.md) (step 5) prints nothing.
