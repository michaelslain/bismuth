The vertical tab strip on the RIGHT edge of the window.

```jsx
<TabRail value={view} onChange={setView} open={open} onToggle={toggle} tabs={[
  { id: "graph", glyph: "⁘", label: "graph" },
  { id: "daemon", glyph: "✳", label: "DAEMON *" },
]} />
```

Collapsed (46px) is the default. The active rule is `--grad`, 2px, on the left edge of the entry.
