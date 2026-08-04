// Visual spec for <Icon> — the one primitive every icon call site renders through
// (registry.ts). A `value` resolves, in order: (1) a known name -> pixel-art (24x24 SVG
// path, one of the 112 hand-authored HackerNoon paths in pixelPaths.ts — NOT Lucide, despite
// the Lucide-style names) or a typed glyph (the seven surface icons + the handful whose
// ASCII form IS the drawing: "x", "[ ]"/"[x]", "<<"/">>", ...); (2) a name-SHAPED string
// that isn't mapped -> the generic fallback glyph "▸" (never the raw typo text);
// (3) anything else (an emoji, an arbitrary glyph) -> passed through as-is. Every icon name
// used below was grepped against `^  <Name>:` in pixelPaths.ts (or registry.ts's
// SURFACE_GLYPHS for the typed ones) to confirm it actually resolves — an unknown name
// renders nothing, typechecks clean, and passes tests, so this is the one place that would
// silently miss the mistake.
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { Icon } from "./Icon";
import { Row } from "../ui/_storyKit";

const meta = {
  title: "Icons/Icon",
  component: Icon,
  parameters: { layout: "padded" },
} satisfies Meta<typeof Icon>;

export default meta;
type Story = StoryObj<typeof meta>;

function Labeled(props: { value: string; caption: string; size?: number }) {
  return (
    <div style={{ display: "flex", "flex-direction": "column", "align-items": "center", gap: "6px" }}>
      <span style={{ color: "var(--fg)" }}>
        <Icon value={props.value} size={props.size ?? 20} />
      </span>
      <span style={{ "font-family": "var(--ui-font-stack)", "font-size": "10.5px", color: "var(--text-muted)" }}>
        {props.caption}
      </span>
    </div>
  );
}

/** A sample of pixel-art icons (PIXEL_PATHS) — the everyday toolbar/palette/picker case. */
export const Default: Story = {
  render: () => (
    <Row gap="24px">
      <Labeled value="Plus" caption="Plus" />
      <Labeled value="Search" caption="Search" />
      <Labeled value="Settings" caption="Settings" />
      <Labeled value="Trash2" caption="Trash2" />
      <Labeled value="BookOpen" caption="BookOpen" />
      <Labeled value="Calendar" caption="Calendar" />
    </Row>
  ),
};

/** The same icon at the sizes real call sites actually use (12-32px) — every path is
 *  axis-aligned and rendered with `shape-rendering: crispEdges`, so it stays crisp rather
 *  than antialiasing into mush at small sizes. */
export const Sizes: Story = {
  render: () => (
    <Row gap="20px">
      {[12, 14, 16, 20, 24, 32].map((s) => <Labeled value="Star" caption={`${s}px`} size={s} />)}
    </Row>
  ),
};

/** Surface glyphs (registry.ts's SURFACE_GLYPHS) — typed characters, not pixel art. Two
 *  families: the seven surface identities (graph/note/base/calendar/agent/daemon/folder)
 *  and the handful whose ASCII form IS the drawing (window-control "x", task checkboxes,
 *  undo/redo carets). A surface glyph always wins over a same-named pixel path. */
export const SurfaceGlyphs: Story = {
  render: () => (
    <Row gap="24px">
      <Labeled value="Share2" caption="Share2 (graph)" />
      <Labeled value="FileText" caption="FileText (note)" />
      <Labeled value="Table" caption="Table (base)" />
      <Labeled value="Bot" caption="Bot (daemon)" />
      <Labeled value="Folder" caption="Folder" />
      <Labeled value="X" caption="X (close)" />
      <Labeled value="Square" caption="Square (task)" />
      <Labeled value="Undo2" caption="Undo2" />
    </Row>
  ),
};

/** Two edge cases the registry docstring calls out: an unmapped name-SHAPED string (e.g. a
 *  legacy Lucide name surviving in old vault frontmatter) falls back to the generic "▸"
 *  glyph rather than showing broken-looking literal text; a non-name value (an emoji, or
 *  any arbitrary glyph a note's `icon:` frontmatter can hold) passes through unchanged. */
export const UnknownAndEmoji: Story = {
  render: () => (
    <Row gap="24px">
      <Labeled value="LucideBookmarkPlus" caption="unmapped name -> fallback" />
      <Labeled value="🪶" caption="emoji -> passthrough" />
      <Labeled value="★" caption="arbitrary glyph -> passthrough" />
    </Row>
  ),
};
