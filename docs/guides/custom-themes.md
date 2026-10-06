# Guide: making a custom colour theme

Read this before you create, edit or debug a colour theme for a Bismuth vault. After following it you will have a validated `.themes/<name>.yaml` file and the vault's `appearance.theme` pointing at it. The running app repaints live; no reload.

## What a theme is

A theme is a **partial override**. It is one YAML file, `<vault>/.themes/<name>.yaml`, with three optional keys:

```yaml
label: 'Dusk'          # shown in pickers; defaults to the file name
extends: paper         # the built-in to start from: ink, paper, cathode or riso; defaults to ink
tokens:                # only the tokens you change
  accent: '#7a3cff'
  r-card: 0
```

Everything you do not write comes from the `extends` built-in. An empty file is valid and is stock `ink`. Keep **only the lines you change**: a theme that restates its parent's values breaks the moment the parent is retuned.

- **Name**: the file name without `.yaml`. It must match `^[a-z0-9][a-z0-9-]{0,39}$` and must not be a built-in name (`ink` `paper` `cathode` `riso`).
- **Where it applies**: `appearance.theme: <name>` in the vault's `.settings`. `bismuth theme use` writes that for you.
- **A token key is the CSS variable name without `--`**: `bg`, `fg`, `accent`, `r-card`, `sp-3`. A token is not only a colour: lengths, durations, fonts and shadows are tokens too. The full list, with kinds, defaults and what each paints, is [the tokens reference](../settings/tokens.md).
- **Quote every colour.** An unquoted `#` starts a YAML comment, so `accent: #7a3cff` makes the value empty and the theme fails validation.
- **Light or dark**: `extends` decides. To make a light theme, extend `paper` or `riso`. To make a dark one, extend `ink` or `cathode`. Set `color-scheme` under `tokens:` only if you move to the other side from your parent.

## Workflow

Run these from the shell with `--vault <dir>` (or `BISMUTH_VAULT` set). Via MCP, call `bismuth_cli` with `{"args": ["theme","create","dusk","--from","paper","--label","Dusk"]}`, one CLI token per array element.

1. **Scaffold from the nearest built-in.** Pick the built-in closest to the look you want:
   ```bash
   bismuth theme create dusk --from paper --label Dusk
   ```
   `--from paper` writes a full file: every field token (the colours JavaScript reads) live with paper's value, and every other token, other colours included, commented out at ink's default. Check those commented colours before uncommenting any in a light theme, since they hold ink's dark values, grouped under `# ── <group>` headings. Without `--from` it writes the minimal file (`label`, `extends: ink`, an empty `tokens: {}`); add `--extends paper` to start from another built-in. It refuses (exit 1) if the file exists; pass `--force` to overwrite.
2. **Keep only the lines you change.** Read the scaffold with `bismuth read .themes/dusk.yaml`, delete every live line you do not want to override, uncomment and edit the rest, and write the whole file back in one call with `bismuth write .themes/dusk.yaml --content '<full YAML>'`. There is no per-field edit command. With direct filesystem access, edit the file instead.
3. **Validate:**
   ```bash
   bismuth theme validate dusk
   ```
   Stdout is always the JSON result, and warnings appear only there. Exit `0` means usable. Exit `1` means at least one error; each error is also printed to stderr as `<name>: <field>: <problem>`. A built-in name also exits `1`. With no name, it validates every file in `.themes/`. Fix errors; fix warnings unless the person asked for a low-contrast look (see Contrast).
4. **Apply:**
   ```bash
   bismuth theme use dusk
   ```
   This validates again, then sets `appearance.theme` in `.settings`. An unknown or invalid theme is refused and nothing is written.

Other commands:

- `bismuth theme tokens [--group <g>] [--kind <k>]` lists every token as `{key, kind, group, default, doc}` (plus `field`/`setting` where set). Use it to find the key for what you want to change.
- `bismuth theme list` shows built-ins and custom themes with validity, plus `active` (what actually paints) and `configured` (the raw `appearance.theme` string). They differ when the configured theme is invalid or missing.
- `bismuth theme show <name>` prints a theme's `label`, `extends`, `tokens` and diagnostics. For a name that does not exist it prints a hint, not diagnostics.

The full reference is [the CLI reference](../cli/reference.md#theme-commands-commandsthemets).

## Finding the token to change

Run `bismuth theme tokens --group <group>`, or read [the tokens reference](../settings/tokens.md). The groups are `surface`, `text`, `accent`, `graph`, `category`, `semantic`, `state`, `effect`, `callout`, `font`, `type-scale`, `weight`, `line-height`, `tracking`, `spacing`, `size`, `radius`, `rule`, `motion`, `popover` and `cursor`.

A few that most themes touch:

| Token | What it paints |
|---|---|
| `bg`, `rail`, `editor` | the canvas, the sidebar and tab rail, the note pane |
| `surface-1`, `surface-2`, `surface-3` | raised surfaces, in order of depth |
| `fg`, `text-muted`, `faint` | the three ink steps: read, scan, structure |
| `accent`, `accent-soft`, `on-accent` | the one accent, its translucent wash, and text on it |
| `graph-0` to `graph-4` | graph clusters and tags: rose, violet, blue, teal, green in that order |
| `teal` `blue` `violet` `green` `gold` `rose` | category hues |
| `danger`, `success`, `warning` | status colours |
| `callout-<type>` | the in-app callout colours (editor and rendered notes); export keeps its own fixed hexes |
| `color-scheme` | `light` or `dark`: native scrollbars and form controls, and the branch for derived surfaces |

A **colour** token that JavaScript reads (the graph, the terminal, Google Calendar) takes a plain colour: hex, numeric `rgb()` / `hsl()`, or `transparent`. A CSS-only colour token also takes `var(--registered)` and `color-mix(...)`. Compute hex for the first kind.

## Coherence rules

A valid theme can still look wrong. A good one follows these:

- **Surfaces step monotonically.** In a dark theme, lightness rises through `rail`, `bg`, `editor`, `surface-1`, `surface-2`, `surface-3`; in a light theme it falls through the same order. Each step is a small, even change in the same hue family. `border-soft` sits between `surface-2` and `border`. If you override one surface, check its neighbours.
- **`graph-0` to `graph-4` are rose, violet, blue, teal, green, in that order**, and the five stay distinguishable from each other and from `node-cold` at graph-node size. Keep similar lightness so no hue shouts.
- **`color-scheme` matches `bg`.** `dark` when `bg` is dark. If you extend `paper` and write a dark `bg`, also write `color-scheme: dark`, or scrollbars and form controls stay light.
- **`on-accent` is legible on `accent`.** Usually the background colour for a light accent, white for a dark one. If you change `accent`, reconsider `accent-soft` (the same colour at about 12% alpha) and `on-accent`.
- **`label-halo` equals `bg`; `graph-bg` is a touch darker than `bg` in a dark theme.**
- **Glow only when the look calls for it.** `glow-text: none` and a hairline `glow-accent` is the default. Only a neon or CRT look blooms.
- **Category hues and `graph-0` to `graph-4` share a family.** The category hues are categorical, not semantic: keep `danger`, `success` and `warning` recognisable (red-ish, green-ish, amber-ish).

## Contrast

`bismuth theme validate` computes WCAG contrast ratios for opaque hex and `rgb()` colours on the resolved theme (your tokens on top of `extends`) and reports **warnings** (exit stays `0`) below these thresholds:

| Pair | Minimum |
|---|---|
| `fg` on `bg` | 4.5 |
| `text-muted` on `bg` | 3 |
| `on-accent` on `accent` | 4.5 |

A warning uses the same `<field>: <problem>` shape and names the pair. Fix warnings unless the person asked for a low-contrast look.

## Errors and warnings

Every problem is one line, `<field>: <problem>`, naming the offending key. Example: `accent: not a color: purple-ish (#rrggbb, rgba(0, 0, 0, 0.5), or transparent)`.

Errors make the theme invalid:

- the file is valid YAML and a map (an empty file is fine)
- the name matches the pattern and is not a built-in (field `name`)
- `label`, if present, is a non-empty string
- `extends`, if present, is one of `ink`, `paper`, `cathode`, `riso`
- every value under `tokens:` passes its kind's check (see [what a value may be](../settings/tokens.md#what-a-value-may-be)); a bad value is an error, never silently dropped

Warnings leave the theme usable:

- `<key>: unknown token, ignored`, with a did-you-mean hint, for a key under `tokens:` that is not registered
- `<key>: unknown field, ignored` for any other top-level key
- `<key>: moved — write it under tokens: as <new key> (see bismuth theme tokens)` for a top-level key from the old format (`background`, `foreground`, `accent`, `accentPalette`, `isLight`, …). Move it under `tokens:` with its new key.
- the contrast warnings above

A theme file that is a symlink, or larger than 64 KB, is refused (`cannot read file: symlink refused`, `file too large (>64 KB)`). A symlinked `.themes/` directory is refused too, with each file listed as `cannot read file: symlink refused`, and a non-file entry reads `cannot read file: not a regular file`.

## Fallback

A missing or invalid theme file never breaks the app: it paints `ink`, the default theme. `appearance.theme: dusk` with a broken `dusk.yaml` shows ink until the file validates; `bismuth theme list` shows the difference as `configured: dusk`, `active: ink`. The iPad build shows `ink` for custom themes for now.

## Overriding one token without a theme

To change one token in one vault, skip the theme: put it under `appearance.tokens` in `.settings`.

```yaml
appearance:
  tokens:
    accent: '#ff6b6b'
    r-card: 0
```

This applies on top of whatever theme is selected, and it wins over the theme's own value for the same key. Use a theme when you want a named, reusable look; use `appearance.tokens` for a one-off tweak. Deleting the line puts the theme's (or the default) value back live. See [the tokens reference](../settings/tokens.md#where-to-set-a-token) for precedence.

## Worked example: `dusk`

A light theme with a violet accent and square cards. It extends `paper`, so the surfaces, ink and graph palette stay paper's; only what differs is written. Save it as `.themes/dusk.yaml`:

```yaml
label: 'Dusk'
extends: paper
tokens:
  accent: '#7a3cff'
  accent-soft: 'rgba(122, 60, 255, 0.12)'
  on-accent: '#ffffff'
  r-card: 0
```

Then:

```bash
bismuth theme validate dusk   # exit 0
bismuth theme use dusk
```

The result is the paper palette with a violet accent, square card corners, and `color-scheme: light`.

## Related

- [Design tokens reference](../settings/tokens.md): every token, its kind, default and what it paints
- [Themes reference](../settings/themes.md), including the Custom themes section
- [CLI reference: theme commands](../cli/reference.md#theme-commands-commandsthemets)
- [`GET /themes`](../api/http-reference.md#get-themes)
