The vault tree — typed connectors, one surface glyph per row.

```jsx
<AsciiTree activeId="j15" onSelect={open} rows={[
  { id: "journal", label: "journal/", glyph: "▸" },
  { id: "j15", label: "2029-09-15", glyph: "✎", depth: 1 },
]} />
```

Never substitute box-drawing characters for `|--` / `\`--`.
