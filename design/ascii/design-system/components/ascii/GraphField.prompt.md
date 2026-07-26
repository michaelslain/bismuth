The ASCII knowledge graph — noise field, rasterized edges, positioned labels.

```jsx
<GraphField nodes={nodes} edges={edges} labels={labels} density={0.34} />
```

- Clear the noise under every edge and label, or the field reads as mush.
- Zoom = resolution (more cells), never `transform: scale` — scaling breaks the grid and, in an embedded context, the host page zooms with it.
- Filter by **provenance** (2nd brain / 3rd brain / daemon), ghosting other layers to faint `·`.
