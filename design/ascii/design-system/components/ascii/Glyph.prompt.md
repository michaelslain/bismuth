Raw character block — use it whenever you would otherwise reach for an SVG.

```jsx
<Glyph text={noiseField(110, 60, 0.34)} color="var(--faint)" opacity={0.45} />
```

Never set `font-size` without also setting `line-height` to the matching cell height — the drawing shears otherwise.
