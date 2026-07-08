// Visual spec for <ViewBar> + <Crumb> + <ViewBarSpacer> + <VBtn> — the canonical
// 46px view header used across graph/bases/calendar/flashcards: a breadcrumb on the
// left, a flexible spacer, then right-aligned controls (SegmentedToggle switchers +
// VBtn buttons). Composed together here exactly as call sites do (see GraphView.tsx /
// bases/BaseView.tsx) rather than each piece in isolation.
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createSignal, type JSX } from "solid-js";
import { ViewBar, Crumb, ViewBarSpacer, VBtn } from "./ViewBar";
import { SegmentedToggle } from "./SegmentedToggle";
import { IconButton } from "./IconButton";

const meta = {
  title: "UI/ViewBar",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// ViewBar is a bare header strip (no side padding beyond its own), so give the story
// canvas a body to sit above, matching a real content view.
function Frame(props: { children: JSX.Element }) {
  return (
    <div style={{ width: "640px", border: "1px solid var(--border)", "border-radius": "8px", overflow: "hidden", background: "var(--bg)" }}>
      {props.children}
      <div style={{ height: "160px", display: "flex", "align-items": "center", "justify-content": "center", color: "var(--faint)", "font-size": "13px" }}>
        (view content)
      </div>
    </div>
  );
}

/** A breadcrumb only — the simplest bar (e.g. a single-view base with no tabs). */
export const CrumbOnly: Story = {
  render: () => (
    <Frame>
      <ViewBar>
        <Crumb icon="Table">Reading List</Crumb>
      </ViewBar>
    </Frame>
  ),
};

/** Breadcrumb + view tabs + a settings toggle on the right (the Bases shape). */
export const WithTabsAndActions: Story = {
  render: () => {
    const [view, setView] = createSignal(0);
    const [settingsOpen, setSettingsOpen] = createSignal(false);
    return (
      <Frame>
        <ViewBar>
          <Crumb icon="Table">Reading List</Crumb>
          <SegmentedToggle
            value={view()}
            onChange={setView}
            options={[
              { id: 0, label: "Table" },
              { id: 1, label: "Cards" },
              { id: 2, label: "Kanban" },
            ]}
          />
          <ViewBarSpacer />
          <VBtn icon="Settings" title="Settings" active={settingsOpen()} onClick={() => setSettingsOpen((v) => !v)} />
          <IconButton icon="Code" label="Source" />
        </ViewBar>
      </Frame>
    );
  },
};

/** A serif crumb title (the standalone calendar month heading shape) + a mode switcher
 *  on the far right — the Knowledge Graph header shape. */
export const SerifCrumbWithModeSwitcher: Story = {
  render: () => {
    const [mode, setMode] = createSignal("2d");
    return (
      <Frame>
        <ViewBar>
          <Crumb icon="Share2" serif>Knowledge Graph</Crumb>
          <ViewBarSpacer />
          <SegmentedToggle
            value={mode()}
            onChange={setMode}
            size="sm"
            options={[
              { id: "2d", label: "2D" },
              { id: "3d", label: "3D" },
            ]}
          />
        </ViewBar>
      </Frame>
    );
  },
};
