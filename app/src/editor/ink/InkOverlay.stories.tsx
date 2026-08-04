// Visual spec for <InkOverlay> — the draw-anywhere note-ink layer (app/src/editor/ink/): a
// transparent freehand-stroke layer painted over the CodeMirror editor viewport, in a fixed
// 680px logical coordinate space (core/src/drawing/ink.ts's INK_LOGICAL_W) so pane-width changes
// rescale ink proportionally instead of anchoring to CM line positions.
//
// InkOverlay's required `view: () => EditorView | undefined` prop has no standalone render path —
// every paint reads `view().contentDOM`'s live bounding rect for its geometry (`geom()`), and the
// pointer handlers read `view().contentDOM` too (`toLogical()`), so it renders nothing without a
// real, mounted CM view to sit on top of. This story mounts it inside `_cmHarness.tsx`'s
// `CmHarness`, the reusable minimal CodeMirror 6 `EditorView` harness built for exactly this
// shape of component: a `children` render-prop handed the live view accessor, rendered as a
// sibling of the CM scroller inside a `position:relative` wrapper — the same wrapper/host/overlay
// layering `Editor.tsx` uses for `InkOverlay` in the real app. This file does NOT modify
// InkOverlay.tsx or _cmHarness.tsx — every story below exercises the real, unmodified component
// over a real, unmodified harness.
//
// Full prop list (read from InkOverlay.tsx): `view: () => EditorView | undefined`; `path: () =>
// string | null` (the open note's vault-relative path — drives the `.ink/<path>.ink` sidecar
// load/save, `core/src/drawing/ink.ts`'s `inkPathFor`); `active: () => boolean` (draw mode on/off
// — InkOverlay.css gates the live canvas's `pointer-events` and the Toolbar's visibility on this,
// and `mounted = () => active() || hasInk()` means the whole overlay renders NOTHING when both are
// false — an ink-free note outside draw mode pays for nothing beyond the async load probe);
// `onExit: () => void` (fired on Escape while active, scoped to this pane via focus).
//
// Strokes CAN be seeded: there is no `strokes` prop — InkOverlay loads its own ink on mount via
// `api.read(inkPathFor(path))` against the real `.ink/<note>.ink` sidecar format
// (core/src/drawing/ink.ts's `InkDoc`/`serializeInkDoc`). That's real IO through `api`, so the
// same `setTransport(fakeTransport({ files: {...} }))` seam SheetView.stories.tsx and
// Backlinks.stories.tsx use for a scoped fixture seeds it here too — write the serialized
// `InkDoc` at `inkPathFor(path)` before mounting and InkOverlay reads it back for real.
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { InkOverlay } from "./InkOverlay";
import { CmHarness } from "../../ui/_cmHarness";
import { setTransport } from "../../api";
import { fakeTransport } from "../../ui/_fakeTransport";
import { serializeInkDoc, inkPathFor, type InkDoc } from "../../../../core/src/drawing/ink";
import type { Stroke } from "../../../../core/src/drawing/model";

const meta = {
  title: "Editor/InkOverlay",
  component: InkOverlay,
  // InkOverlay fills its editor wrapper edge-to-edge in the real app (no card chrome around it) —
  // same reasoning as Editor.stories.tsx's `fullscreen`.
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof InkOverlay>;

export default meta;
type Story = StoryObj<typeof meta>;

const noop = () => {};
const PATH = "Ink Demo.md";

// Fixed px, not vh: the Storybook preview iframe is short with the Controls panel open (see
// Editor.stories.tsx / GraphView.stories.tsx's own notes on this).
const STORY_H = "700px";

const NOTE_TEXT = [
  "# Ink Demo",
  "",
  "This note has draw-anywhere ink layered on top of the editor. Toggle draw",
  "mode to sketch directly over the text below.",
  "",
  "Annotate this paragraph, circle a typo, or sketch a diagram right on the",
  "page: the ink persists to a hidden .ink/<note>.ink sidecar next to the",
  "note itself.",
  "",
].join("\n");

/** Flatten `[x, y]` pairs into InkOverlay's packed `pts` format — flat `(x, y, pressureByte)`
 *  triples (`core/src/drawing/model.ts`'s `Stroke.pts`) — at a fixed mid pressure, since these
 *  are seeded fixture geometry, not a real stylus capture. */
function line(points: Array<[number, number]>, pressure = 200): number[] {
  return points.flatMap(([x, y]) => [x, y, pressure]);
}

/** A small doodle in ink's logical content space (x in the note's 680px reading column, y in
 *  content px) sitting over NOTE_TEXT's second paragraph: a wavy underline, a circled "typo",
 *  and a highlighter swipe over the heading — plausible annotation marks, not a captured
 *  stroke. `c: "fg"` resolves to the theme's ink color (`theme.ts`'s `makeColorResolver`); the
 *  highlighter uses a literal hex, matching how a real stroke persists color (Toolbar.tsx's
 *  comment: never a bare swatch id in the saved doc). */
function demoStrokes(): Stroke[] {
  return [
    {
      t: "pen", c: "fg", w: 4,
      pts: line([
        [20, 148], [60, 154], [100, 146], [140, 154], [180, 146],
        [220, 154], [260, 146], [300, 154], [340, 148],
      ]),
    },
    {
      t: "pen", c: "fg", w: 3,
      pts: line([
        [252, 168], [268, 158], [288, 160], [296, 172], [286, 184],
        [264, 184], [252, 174], [252, 168],
      ]),
    },
    { t: "hl", c: "#f2b705", w: 18, pts: line([[16, 18], [120, 18]], 255) },
  ];
}

/** Draw mode freshly toggled on: an empty canvas plus the drawing Toolbar (InkOverlay.css flips
 *  the live canvas interactive and shows `.draw-toolbar` only while `active()`), no ink yet. Uses
 *  the globally-installed fakeTransport (`.storybook/preview.ts`) as-is — an unseeded
 *  `.ink/*.ink` GET resolves to `""` (fakeTransport's default for a missing file), which
 *  InkOverlay's load effect already treats as "start empty" (`if (text.trim()) {...}`). */
export const Default: Story = {
  render: () => (
    <div style={{ height: STORY_H, width: "100%" }}>
      <CmHarness doc={NOTE_TEXT}>
        {(view) => <InkOverlay view={view} path={() => PATH} active={() => true} onExit={noop} />}
      </CmHarness>
    </div>
  ),
};

/** Existing strokes, loaded the real way: a `.ink/<path>.ink` sidecar seeded on a scoped
 *  fakeTransport (same pattern as SheetView.stories.tsx's `.sheet` fixtures), read back by
 *  InkOverlay's own `api.read(inkPathFor(path))` load effect on mount — there is no strokes
 *  prop to poke directly. Still `active`, so the committed strokes render on the base canvas
 *  alongside the Toolbar, showing the overlay mid-annotation rather than freshly reset. */
export const DrawnInk: Story = {
  render: () => {
    const doc: InkDoc = { v: 1, kind: "ink", strokes: demoStrokes() };
    setTransport(fakeTransport({ files: { [inkPathFor(PATH)]: serializeInkDoc(doc) } }));
    return (
      <div style={{ height: STORY_H, width: "100%" }}>
        <CmHarness doc={NOTE_TEXT}>
          {(view) => <InkOverlay view={view} path={() => PATH} active={() => true} onExit={noop} />}
        </CmHarness>
      </div>
    );
  },
};
