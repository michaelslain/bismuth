# Make a custom colour theme

A custom theme is one YAML file, `<vault>/.themes/<name>.yaml`, that overrides design tokens on top of a built-in theme. Follow this guide to create, edit or debug one; you end with a validated theme file and the vault's `appearance.theme` pointing at it. The running app repaints live, with no reload.

A complete theme, and all you need for a first one:

```yaml
label: 'Dusk'          # shown in pickers; defaults to the file name
extends: paper         # the built-in to start from: ink, paper, cathode or riso; defaults to ink
tokens:                # only the tokens you change
  accent: '#7a3cff'
  r-card: 0
```

## Theme file keys

All three keys are optional, and an empty file is valid: it paints stock `ink`.

| Key | Type | Default | Effect |
|---|---|---|---|
| `label` | non-empty string | the file name | Name shown in theme pickers |
| `extends` | `ink`, `paper`, `cathode` or `riso` | `ink` | Built-in whose values every unwritten token takes; also decides light or dark |
| `tokens` | map of token key to value | none | The overrides; a key is the CSS variable name without `--` (`bg`, `accent`, `r-card`, `sp-3`) |

Rules that apply to the file as a whole:

- The name is the file name without `.yaml`. It matches `^[a-z0-9][a-z0-9-]{0,39}$` and is not a built-in name (`ink`, `paper`, `cathode`, `riso`).
- Write only the lines you change. A theme that restates its parent's values drifts the moment the parent is retuned.
- A token is not only a colour: lengths, durations, fonts and shadows are tokens too. [The tokens reference](../settings/tokens.md) lists every token with its kind, default and what it paints.
- Light or dark follows `extends`. Extend `paper` or `riso` for a light theme and `ink` or `cathode` for a dark one. Set `color-scheme` under `tokens:` only when you cross to the other side from your parent.
- Quote every colour: an unquoted `#` starts a YAML comment, so `bg: #101010` becomes an empty value and the theme fails validation with `bg: not a color: null`.

## Steps to create a theme

Run these from the shell with `--vault <dir>`, or with `BISMUTH_VAULT` set. Through MCP, call `bismuth_cli` with one CLI token per array element, for example `{"args": ["theme","create","dusk","--from","paper","--label","Dusk"]}`.

1. Scaffold from the built-in closest to the look you want:
   ```bash
   bismuth theme create dusk --from paper --label Dusk
   ```
   `--from paper` writes a full file. Every field token (a colour that JavaScript reads) is live at paper's value. Every other token, other colours included, is commented out at ink's default under a `# ── <group>` heading, so check those colours before you uncomment any in a light theme. Without `--from` the file is minimal (`label`, `extends: ink`, `tokens: {}`); add `--extends paper` to start from another built-in. The command exits 1 if the file exists; `--force` overwrites it.
2. Keep only the lines you change. Read the scaffold with `bismuth read .themes/dusk.yaml`, delete every live line you do not want to override, uncomment and edit the rest, and write the whole file back with `bismuth write .themes/dusk.yaml --content '<full YAML>'`. There is no per-field edit command. With direct filesystem access, edit the file instead.
3. Validate:
   ```bash
   bismuth theme validate dusk
   ```
   Stdout is the JSON result, and warnings appear only there. Exit `0` means the theme is usable; exit `1` means at least one error, and each error also prints to stderr as `<name>: <field>: <problem>`. With no name, the command validates every file in `.themes/`. Fix errors, and fix warnings unless the person asked for a low-contrast look.
4. Apply:
   ```bash
   bismuth theme use dusk
   ```
   The command validates again, then sets `appearance.theme` in `.settings`. An unknown or invalid theme is refused and nothing is written.

Other theme commands:

| Command | Output |
|---|---|
| `bismuth theme tokens [--group <g>] [--kind <k>]` | Every token as `{key, kind, group, default, doc}`, plus `field` and `setting` where set |
| `bismuth theme list` | Built-ins and custom themes with `valid` and `tokens` counts, plus `active` (what paints) and `configured` (the raw `appearance.theme` string) |
| `bismuth theme show <name>` | A theme's `label`, `extends`, `tokens` and `diagnostics`; exit 1 with a hint for a name that does not exist |

`active` and `configured` differ when the configured theme is invalid or missing. The full flag list is in [the CLI reference](../cli/reference.md).

## Working example: dusk

A light theme with a violet accent and square cards. It extends `paper`, so surfaces, ink and the graph palette stay paper's, and only what differs is written. Save it as `.themes/dusk.yaml`:

```yaml
label: 'Dusk'
extends: paper
tokens:
  accent: '#7a3cff'
  accent-soft: 'rgba(122, 60, 255, 0.12)'
  on-accent: '#ffffff'
  r-card: 0
```

Then validate and apply it:

```bash
bismuth theme validate dusk
bismuth theme use dusk
```

The result is the paper palette with a violet accent, square card corners and `color-scheme: light`.

## Find the token to change

Run `bismuth theme tokens --group <group>`, or read [the tokens reference](../settings/tokens.md). The groups are `surface`, `text`, `accent`, `graph`, `category`, `semantic`, `state`, `effect`, `callout`, `font`, `type-scale`, `weight`, `line-height`, `tracking`, `spacing`, `size`, `radius`, `rule`, `motion`, `popover` and `cursor`.

Tokens that most themes touch:

| Token | What it paints |
|---|---|
| `bg`, `rail`, `editor` | The canvas, the sidebar and tab rail, the note pane |
| `surface-1`, `surface-2`, `surface-3` | Raised surfaces, in order of depth |
| `fg`, `text-muted`, `faint` | The three ink steps: read, scan, structure |
| `accent`, `accent-soft`, `on-accent` | The one accent, its translucent wash, and text on it |
| `graph-0` to `graph-4` | Graph clusters and tags: rose, violet, blue, teal, green in that order |
| `teal` `blue` `violet` `green` `gold` `rose` | Category hues |
| `danger`, `success`, `warning` | Status colours |
| `callout-<type>` | In-app callout accents, in the editor and in rendered notes |
| `color-scheme` | `light` or `dark`: native scrollbars and form controls, and the branch for derived surfaces |

A colour token that JavaScript reads (the graph, the terminal, Google Calendar) takes a plain colour: hex, numeric `rgb()` or `hsl()`, or `transparent`. A CSS-only colour token also takes `var(--registered)` and `color-mix(...)`. Compute hex for the first kind.

## Keep a theme coherent

A valid theme can still look wrong. A good one follows these rules:

- Surfaces step monotonically. In a dark theme, lightness rises through `rail`, `bg`, `editor`, `surface-1`, `surface-2`, `surface-3`; in a light theme it falls through the same order. Each step is a small, even change in one hue family, and `border-soft` sits between `surface-2` and `border`. If you override one surface, check its neighbours.
- `graph-0` to `graph-4` are rose, violet, blue, teal, green, in that order. Keep the five distinguishable from each other and from `node-cold` at graph-node size, with similar lightness so no hue shouts.
- `color-scheme` matches `bg`. If you extend `paper` and write a dark `bg`, also write `color-scheme: dark`, or scrollbars and form controls stay light.
- `on-accent` is legible on `accent`: usually the background colour for a light accent and white for a dark one. If you change `accent`, reconsider `accent-soft` (the same colour at about 12% alpha) and `on-accent`.
- `label-halo` equals `bg`, and `graph-bg` is a touch darker than `bg` in a dark theme.
- Glow only when the look calls for it. `glow-text: none` and a hairline `glow-accent` are the defaults; only a neon or CRT look blooms.
- Category hues are categorical, not semantic. Keep `danger`, `success` and `warning` recognisable as red-ish, green-ish and amber-ish.

## Contrast warnings

`bismuth theme validate` computes WCAG contrast ratios for opaque hex and `rgb()` colours on the resolved theme (your tokens on top of `extends`). A ratio below the minimum adds a warning and leaves the exit code at `0`.

| Pair | Minimum |
|---|---|
| `fg` on `bg` | 4.5 |
| `text-muted` on `bg` | 3 |
| `on-accent` on `accent` | 4.5 |

A warning reads like `fg: low contrast against bg: 1.09:1 (aim for 4.5:1)`. Pairs that use `rgba()`, `hsl()` or `transparent` are not checked.

## Failure modes

Every diagnostic is one line, `<field>: <problem>`, naming the offending key, for example `accent: not a color: purple-ish (#rrggbb, rgba(0, 0, 0, 0.5), or transparent)`.

These errors make the theme invalid:

- The file is not valid YAML, or is not a map. An empty file is fine.
- The name does not match the pattern, or is a built-in name (field `name`).
- `label` is present and not a non-empty string.
- `extends` is present and not one of `ink`, `paper`, `cathode`, `riso`.
- A value under `tokens:` fails its kind's check (see [what a value may be](../settings/tokens.md#what-a-value-may-be)). A bad value is an error, never silently dropped.
- The file is a symlink (`cannot read file: symlink refused`), is larger than 64 KB (`file too large (>64 KB)`), or is a directory (`cannot read file: not a regular file`). A symlinked `.themes/` directory refuses every file with the symlink message.

These warnings leave the theme usable:

- `<key>: unknown token, ignored`, with a did-you-mean hint, for a key under `tokens:` that is not registered. A misspelt token silently does nothing; read the warning.
- `<key>: unknown field, ignored` for any other top-level key.
- `<key>: moved — write it under tokens: as <new key> (see bismuth theme tokens)` for a top-level key that is a token's field name (`background`, `foreground`, `accent`, `accentPalette`, `isLight`, and the like). The top-level key does nothing; move it under `tokens:` with its token key.
- The contrast warnings above.

An invalid theme never breaks the app: it paints `ink`. `appearance.theme: dusk` with a broken `dusk.yaml` shows ink until the file validates, and `bismuth theme list` shows the gap as `configured: dusk`, `active: ink`.

## Override one token without a theme

To change one token in one vault, skip the theme and put it under `appearance.tokens` in `.settings`:

```yaml
appearance:
  tokens:
    accent: '#ff6b6b'
    r-card: 0
```

This applies on top of whatever theme is selected and wins over the theme's own value for the same key. Use a theme for a named, reusable look and `appearance.tokens` for a one-off tweak. Deleting the line puts the theme's (or the default) value back live. [Where to set a token](../settings/tokens.md#where-to-set-a-token) covers the full precedence.

## Verify

1. Run `bismuth theme validate dusk`. Expected output, with exit code `0`:
   ```json
   {"ok":true,"results":[{"name":"dusk","diagnostics":[]}]}
   ```
2. Run `bismuth theme use dusk`. Expected output:
   ```json
   {"ok":true,"theme":"dusk"}
   ```
3. Run `bismuth theme list` and read the top-level fields. `"active":"dusk"` and `"configured":"dusk"` mean the theme paints. `"active":"ink"` with `"configured":"dusk"` means the file is invalid; run `bismuth theme validate dusk` to see why.

## Related

- [Design tokens reference](../settings/tokens.md): every token, its kind, default and what it paints
- [Themes reference](../settings/themes.md): the built-in themes and how a theme is picked
- [CLI reference](../cli/reference.md): the `theme` commands
- [HTTP reference](../api/http-reference.md): `GET /themes`
