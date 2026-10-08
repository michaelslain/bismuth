# Getting started

Bismuth is a notes app where plain markdown files link into a knowledge graph you can search and explore. This tutorial takes you from a fresh install to a small linked vault in about ten minutes. You need the app installed ([install](install.md) covers building from source) and nothing else.

In this tutorial, `Mod` means Cmd on macOS and Ctrl elsewhere. A vault is a plain folder of files, so nothing here locks your notes inside the app.

## Step 1: Choose your vault

The first launch shows a short intro, then asks you to pick a folder. That folder becomes your vault.

1. Page through the intro with the Right and Left arrow keys. Press Escape to jump to the last slide.
2. On the theme slide, pick a palette. The choice is saved to the new vault and changeable later.
3. On the power-ups slide, leave the `daemon` and `cli + mcp` boxes checked or clear them. Both can be set up later from the command palette.
4. On the last slide, click **enter your vault**. In the folder dialog, pick an empty folder, create one, or choose an existing folder of markdown notes, and confirm.

The app relaunches into the vault and opens a graph tab. For an empty folder the graph is empty. The intro appears once per machine; later launches reopen your last vault.

## Step 2: Create a note

A new note appears in the file tree with its name ready to edit.

1. Click the **+** button at the top of the sidebar and choose **New note**. (From the keyboard: press `Mod+P`, type `New note`, press Enter.)
2. Type `Reading list` and press Enter.
3. Click the `Reading list` row to open it, and write a line of text.

You should see the note in the file tree and its text in the editor. Notes save automatically as you type, to a plain `Reading list.md` file in your vault folder.

## Step 3: Link two notes with wikilinks

A wikilink is a note name in double square brackets. It links to the note with that file name, wherever that note sits in the vault.

1. Create a second note named `Ideas`.
2. In `Ideas`, type `See [[`. A list of your notes pops up. Pick `Reading list`, or type the full name and close the brackets yourself.
3. Move the cursor off that line. The link renders as a clickable link. Click it.

You should land in `Reading list`. Linking to a name that has no note opens an empty note with that name. See [wikilinks and tags](../vault/wikilinks-tags.md) for the full syntax, including `[[Note#Heading]]` and `[[Note|alias]]`.

## Step 4: Add tags and frontmatter

Frontmatter is a block of YAML at the very top of a note, between two `---` lines. Each key in it is a property of the note, and the `tags` key is how a note joins a tag.

1. Put this at the top of `Reading list`:

   ```markdown
   ---
   tags: [books, queue]
   status: reading
   ---
   ```

2. In the body of `Ideas`, add an inline tag: `Worth revisiting #books`.

Both spellings produce the same tag. Tags become nodes in the graph, and properties become columns you can filter and sort in a base ([your first base](../bases/first-base.md)). The [frontmatter reference](../vault/frontmatter.md) lists the property types.

## Step 5: Open the knowledge graph

The knowledge graph is the home tab: it is the first tab on a fresh start, and Bismuth reopens one if you close every tab.

1. Press `Mod+P`, type `Open graph view`, press Enter. (Your first tab already is the graph; this command is the way back to it later.)
2. Find the `Reading list` and `Ideas` nodes with a line between them, plus a tag node for `books`.
3. Click the `Ideas` node.

You should see the note open as a tab. Press `Z` while hovering a node to focus it, and `Escape` to reset the view. The graph header switches between modes; the 2nd brain mode shows your vault and its tags. [Graph overview](../graph/overview.md) covers the modes and rendering.

## Step 6: Find anything with the switcher

The switcher is Bismuth's one search surface: file names, note contents, and a way to ask an AI.

1. Press `Mod+O`. The graph expands to fill the window and a search panel opens on the left.
2. Type `read`. Matching file names appear first, then notes whose text matches.
3. Press the Down arrow to highlight a row and press Enter.

You should land in the chosen note. Notes that match your query light up in the graph behind the panel. Press Escape to leave without choosing. With a query that matches nothing, Enter asks Bismuth AI about your notes; `Mod+Enter` does that from anywhere ([connect an agent](../chat/connect-an-agent.md)).

## Step 7: Use tabs and split panes

Every open item lives in a tab, and each tab holds one or more panes. Tabs sit in a vertical rail along a window edge.

1. Press `Mod+T` for a new tab.
2. With a note open, press `Mod+D` to split the pane to the right, or `Mod+Shift+D` to split downward.
3. Open different notes in the two panes. Move between them with `Mod+Alt+Left` and `Mod+Alt+Right`.
4. Press `Mod+W` to close the focused pane. Closing the last pane closes the tab, and `Mod+Shift+T` reopens it.

Drag a sidebar row onto a note to insert a link to it, or onto a pane's edge to split ([draggables](draggables.md) lists every drop). `Alt+S` toggles the sidebar and `Alt+Shift+S` toggles the tab rail. Every shortcut is rebindable; the full list is in [keybindings](../settings/keybindings.md).

## Step 8: Open the settings file

Bismuth has no settings screen. Settings live in one hidden file at the root of the vault, `.settings`, which opens in the editor like a note.

1. Press `Mod+P`, type `Open Settings`, press Enter.
2. Add these lines, or press `Ctrl+Space` to browse every key with its default:

   ```yaml
   appearance:
     theme: paper
   ```

3. Wait a moment for the autosave.

You should see the whole app switch to the light `paper` palette without a restart. A key you leave out uses its default, so the file stays short. [Settings reference](../settings/reference.md) lists every key and [themes](../settings/themes.md) lists the palettes.

## Where next

- [Your first base](../bases/first-base.md): turn the properties from step 4 into a table, board or calendar.
- [Task syntax](../tasks/syntax.md): write `- [ ] call mum [due 2026-10-12]` anywhere and Bismuth tracks it.
- [Connect an AI agent](../chat/connect-an-agent.md): chat, terminal and MCP with the agent you already use.
- [Set up the daemon](../daemon/setup.md): a background assistant that builds a memory graph beside your notes.
- [Glossary](glossary.md): every term used in these docs.
- [Troubleshooting](troubleshooting.md): symptoms and fixes if something misbehaves.
