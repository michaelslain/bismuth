// Visual spec for <SymbolGallery> — the searchable grid-of-symbols modal (icons,
// emoji) reused by the file-tree "Set icon" picker and the editor's `:`-emoji
// autocomplete. Driven entirely by a GallerySource (see ./types.ts + ./sources.ts):
// the icon source (Lucide names, prefix-then-substring ranked) and the emoji source
// (glyphs, ranked by the shared emoji search) are the two concrete sources in-repo.
//
// Uses the same shell as the command palette (<Modal> + `.palette-panel`), so
// `layout: "fullscreen"` lets the overlay fill the preview frame like Modal's stories.
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createSignal } from "solid-js";
import { SymbolGallery } from "./SymbolGallery";
import { iconSource, emojiSource } from "./sources";
import { Button } from "../Button";

const meta = {
  title: "UI/Gallery/SymbolGallery",
  component: SymbolGallery,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof SymbolGallery>;

export default meta;
type Story = StoryObj<typeof meta>;

const noop = () => {};

/** The icon gallery — every Lucide icon, unfiltered default set. */
export const IconSource: Story = {
  render: () => <SymbolGallery source={iconSource} onPick={noop} onClose={noop} />,
};

/** The icon gallery with a highlighted "current" selection + a reset action (the
 *  file-tree "Set icon" picker's shape). */
export const IconSourceWithCurrentAndClear: Story = {
  render: () => (
    <SymbolGallery
      source={iconSource}
      current="BookOpen"
      onClear={() => {}}
      clearLabel="RESET TO DEFAULT"
      onPick={noop}
      onClose={noop}
    />
  ),
};

/** The emoji gallery (the editor's `:`-emoji autocomplete shape). */
export const EmojiSource: Story = {
  render: () => <SymbolGallery source={emojiSource} onPick={noop} onClose={noop} />,
};

/** Interactive: a trigger opens the gallery; picking a symbol or Escape/backdrop closes
 *  it and shows what was picked. */
export const Interactive: Story = {
  render: () => {
    const [open, setOpen] = createSignal(false);
    const [picked, setPicked] = createSignal<string | null>(null);
    return (
      <div style={{ padding: "40px", display: "flex", "flex-direction": "column", gap: "12px", "align-items": "flex-start" }}>
        <Button kind="text" state="selected" onClick={() => setOpen(true)}>Open icon picker</Button>
        <span style={{ "font-family": "var(--ui-font-stack)", "font-size": "13px", color: "var(--text-muted)" }}>
          Picked: {picked() ?? "(none)"}
        </span>
        {open() && (
          <SymbolGallery
            source={iconSource}
            current={picked() ?? undefined}
            onPick={(v) => setPicked(v)}
            onClose={() => setOpen(false)}
          />
        )}
      </div>
    );
  },
};
