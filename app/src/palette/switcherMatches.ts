// app/src/palette/switcherMatches.ts
// Pure helper shared by the Cmd+O switcher → backdrop-graph wiring. Maps the switcher's
// ranked result FILE PATHS (vault-relative, e.g. "reading/quotes/x.md") to knowledge-graph
// NODE IDS so the graph can light up EVERY matching note as a search match (not just the
// active row). Graph node ids are the note path WITHOUT the ".md" extension (see
// core/src/vault.ts); non-".md" results (the hidden ".settings" file, ".sheet"/".draw"
// files) are not graph nodes and are dropped. Input order is preserved.
export function switcherMatchNodeIds(paths: readonly string[]): string[] {
  const ids: string[] = [];
  for (const p of paths) {
    if (p.endsWith(".md")) ids.push(p.slice(0, -3));
  }
  return ids;
}
