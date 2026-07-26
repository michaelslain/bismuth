Bracketed ASCII action button — the one action primitive; everything clickable that isn't a row or a tab is a Button.

```jsx
<Button bracket primary onClick={accept}>accept</Button>
<Button bracket>edit</Button>
<Button bracket state="unselected">dismiss</Button>
```

- `bracket` for in-content actions (`[ accept ]`); bare UPPERCASE for chrome segments.
- `state="selected"` is the on-member of a toggle — accent text, accent-soft fill, accent border.
- `primary` adds `--glow-accent`; **max one per view**.
- `kind="icon"` for the glyph-only buttons in the tab rail and window controls.
