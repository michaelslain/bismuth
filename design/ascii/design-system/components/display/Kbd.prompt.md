Keybinding caps — the command palette, overlay footers, menu rows, and the status bar.

```jsx
<Kbd combo="Mod+K" />                          // ⌘ K
<Kbd combo="Mod+\`, Mod+J" />                   // ⌘ ` then ⌘ J
<KbdHint combo="Mod+O">switcher</KbdHint>
<KbdHints items={[{ combo: "Mod+O", label: "switcher" },
                  { combo: "Mod+K", label: "commands" }]} />
```

- Pass `combo` in the app's own keybinding syntax; `Mod` resolves to ⌘ on macOS and Ctrl elsewhere.
- Each key is a separate cap. Never render "⌘+K" with a literal plus — adjacency is the chord.
- A comma-separated sequence renders a faint "then" between groups.
- Right-aligned in menu rows (`.row-kbd`), left-of-label in hint rows.
