// app/src/blocks/emphasisMarker.ts
// Marker-aware `emphasis` / `strong` mdast-util-to-markdown handlers — so `_italic_` round-trips
// as `_italic_` (not `*italic*`) and `__bold__` as `__bold__` (not `**bold**`).
//
// WHY a custom handler: the AUTHORED marker is already preserved through PARSE — Milkdown's
// commonmark preset ships a `remarkMarker` transformer that reads `source[node.position.start]`
// onto `node.marker`, and its emphasis/strong $markSchema stores that as the mark's `marker`
// attr (parseMarkdown) and re-emits it onto the serialized mdast node (toMarkdown). The ONLY gap
// is the serializer: the stock mdast-util-to-markdown `emphasis`/`strong` handlers ignore
// `node.marker` and read `state.options.emphasis` / `.strong` (hard-pinned to `*` in
// STRINGIFY_OPTIONS), so the marker is lost at the last step. These handlers close that gap by
// emitting the marker carried on the node.
//
// WHY we DON'T delegate to the stock handler: the stock handler additionally applies "attention"
// character-reference encoding (`encodeInfo`) that, for `_` runs (treated more strictly than `*`),
// rewrites e.g. `_a_ _b_` → `_a&#x5F; &#x5F;b_`. Because this surface emits inline text VERBATIM
// (it never escapes a lone `_`/`*` in prose — see verbatimText in milkdownEditor.ts), that
// defensive re-encoding is both unnecessary and a byte-divergence. Emitting `marker + content +
// marker` directly is byte-stable AND idempotent for every realistic inline case (verified in
// milkdownSerialize.test.ts), so the simpler emitter is also the more faithful one.
//
// The `marker` attr defaults to `*` (the schema default) when a doc is built programmatically
// (toggle command, paste) rather than parsed, so newly-authored emphasis still serializes as `*`.

interface MarkerNode {
  marker?: unknown;
}

// The mdast-util-to-markdown handler shape we rely on (a subset — `state.enter`,
// `state.containerPhrasing`, `state.createTracker`). Typed loosely because the lib isn't a direct
// dep; the runtime objects are the real serializer state passed by remark-stringify.
interface SerializerState {
  enter: (type: string) => () => void;
  containerPhrasing: (node: unknown, info: Record<string, unknown>) => string;
  createTracker: (info: unknown) => { move: (s: string) => string; current: () => Record<string, unknown> };
}

/** `*` unless the node carries a `_` marker (authored underscore emphasis/strong). */
function markerOf(node: MarkerNode): "*" | "_" {
  return node.marker === "_" ? "_" : "*";
}

function makeHandler(seqLen: 1 | 2) {
  const handler = (node: MarkerNode, _parent: unknown, state: SerializerState, info: unknown): string => {
    const marker = markerOf(node);
    const seq = seqLen === 2 ? marker + marker : marker;
    const exit = state.enter(seqLen === 2 ? "strong" : "emphasis");
    const tracker = state.createTracker(info);
    const before = tracker.move(seq);
    const between = tracker.move(
      state.containerPhrasing(node, { after: marker, before, ...tracker.current() }),
    );
    const after = tracker.move(seq);
    exit();
    return before + between + after;
  };
  // `peek` lets the serializer know our opening char for adjacency decisions in OTHER handlers.
  (handler as { peek?: () => string }).peek = () => "*";
  return handler;
}

/** mdast-util-to-markdown handler for `emphasis` that honours the authored `_`/`*` marker. */
export const markerAwareEmphasis = makeHandler(1);

/** mdast-util-to-markdown handler for `strong` that honours the authored `__`/`**` marker. */
export const markerAwareStrong = makeHandler(2);
