// Visual spec for <CommandButton> — the presentational half of App.tsx's configurable toolbar
// button, shared by the sidebar header bar, the horizontal tab strip, and the vertical tab rail.
//
// WHY THIS FILE EXISTS: `.toolbar-btn-wrap` and `.toolbar-badge` are about to move from the global
// App.css into CommandButton.module.css, which HASHES every class name. A name left behind as a
// string literal still compiles and still renders, it just matches nothing — the badge loses its
// absolute positioning and lands inline instead of pinned to the icon's corner. Nothing else in
// the repo can see that: typecheck reads no CSS, and Bun resolves `solid-js/web` to its server
// build so no unit test can mount a Solid component at all. `bench/cssBaseline.ts` reads computed
// styles off Storybook, so these stories ARE the gate — and they were recorded BEFORE the CSS
// moved, while the class names were still the pre-migration global literals. That ordering is the
// only one under which a subsequent "0 changed" means the migration preserved the rendering; a
// story first recorded after the move would have blessed whatever it happened to render, broken
// included.
//
// NO FIXTURE SEAM NEEDED: the component takes six read-only props, holds no state, fetches
// nothing, and reads no context — the resolution logic (commands, the daemon gate, the live
// due-count) stays in App.tsx's `ToolbarButton` wrapper, which this component never sees.
//
// FOUR STORIES: `Default` at rest. `WithBadge` — the only story rendering `.toolbar-badge` at all,
// on a dark surface so its `color: var(--bg)` on `background: var(--accent)` is legible and its
// absolute position against `.toolbar-btn-wrap` is visible. `Disabled` — the unknown-command
// fallback path, which (post-extraction) now also wraps in `.toolbar-btn-wrap`; see the component
// header for why that is an intentional, harmless shape change. `SidebarSize` — the sidebar header
// bar's `iconSize` (settings.appearance.sidebarIconFontSize's default, 12px) versus the 18px this
// component falls back to via IconButton's own default when no size is given.
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { CommandButton } from "./CommandButton";

const noop = () => {};

const meta = {
  title: "Shell/CommandButton",
  component: CommandButton,
  parameters: { layout: "padded" },
} satisfies Meta<typeof CommandButton>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The resting state: a single icon button with no badge. */
export const Default: Story = {
  render: () => <CommandButton icon="Inbox" label="Inbox" onClick={noop} />,
};

/** The inbox's live due-count badge — the only story that renders `.toolbar-badge` at all.
 *  Rendered on a dark surface so the badge's `color: var(--bg)` on `background: var(--accent)`
 *  reads correctly. */
export const WithBadge: Story = {
  render: () => (
    <div style={{ padding: "12px", background: "var(--fg)" }}>
      <CommandButton icon="Inbox" label="Inbox" badge={3} onClick={noop} />
    </div>
  ),
};

/** The unknown-command fallback: `resolveButtonCommands` found nothing to run, so the button is
 *  disabled and its label names the unresolved command. */
export const Disabled: Story = {
  render: () => <CommandButton icon="CircleHelp" label="Unknown command: not-a-real-command" disabled onClick={noop} />,
};

/** The sidebar header bar's icon size (`appearance.sidebarIconFontSize`'s default, 12px) next to
 *  the 18px a caller gets by omitting `iconSize` (IconButton's own default), for comparison. */
export const SidebarSize: Story = {
  render: () => (
    <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
      <CommandButton icon="Search" label="Search" iconSize={12} onClick={noop} />
      <CommandButton icon="Search" label="Search" onClick={noop} />
    </div>
  ),
};
