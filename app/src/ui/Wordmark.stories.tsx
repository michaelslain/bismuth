// Visual spec for the app-shell wordmark — the ASCII mark in the top strip
// (`app/src/App.tsx`'s `.asc-wordmark` span, styled in `App.css`).
//
// This is chrome, not a `ui/` primitive, so there is no `Wordmark` component to import: the story
// renders the same span + class the shell does. Kept here anyway because the mark is a brand
// decision that needs to be LOOKED at, and the shell has no other visual surface.
//
// WHY THE WRAPPER SETS --grad: `.asc-wordmark` paints via `background-clip: text` with
// `color: transparent`, and `--grad` is derived per-theme at runtime by `settingsCssVars.ts`.
// Storybook never runs that, so without a local `--grad` the mark renders INVISIBLE — transparent
// text over no background. The wrapper supplies the ink/paper-theme ramp so the story shows the
// real thing rather than an empty strip.
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { Label } from "./_storyKit";
import "../App.css";

/** The mark itself — a hopper-crystal silhouette in punctuation. */
const MARK = ",;']--]';,";

/** The runtime `--grad` ramp, inlined so the sheen renders outside the app. */
const GRAD =
  "linear-gradient(100deg, #ff6ec7 0%, #a06bff 18%, #4d8bff 36%, #22d3d6 52%, #5ff0a8 68%, #ffd36e 84%, #ff6ec7 100%)";

function Strip(props: { tracking?: string; children?: string }) {
  return (
    <div
      style={{
        "--grad": GRAD,
        ...(props.tracking ? { "--wordmark-tracking": props.tracking } : {}),
        background: "var(--bg, #0d0d0f)",
        padding: "10px 14px",
        "border-radius": "4px",
        display: "flex",
        "align-items": "center",
        "min-width": "180px",
      }}
    >
      <span class="asc-wordmark">{props.children ?? MARK}</span>
    </div>
  );
}

const meta = {
  title: "App Shell/Wordmark",
  parameters: { layout: "centered" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The shipped mark at its default tracking (-0.06em). */
export const Default: Story = {
  render: () => <Strip />,
};

/**
 * Tracking ladder. The mark is ASCII art, not lettering — the glyphs have to close into one
 * silhouette, so this reads bottom-up: looser values break it into loose punctuation, tighter
 * values fuse the `--` bar into the bracket shoulders. Pick by eye.
 */
export const Tracking: Story = {
  render: () => (
    <div style={{ display: "flex", "flex-direction": "column", gap: "10px" }}>
      {([".08em (old, for lettering)", "0", "-0.03em", "-0.06em (current)", "-0.09em", "-0.12em"] as const).map(
        (t) => {
          const value = t.split(" ")[0];
          return (
            <div style={{ display: "flex", "align-items": "center", gap: "12px" }}>
              <span style={{ "min-width": "170px" }}>
                <Label>{t}</Label>
              </span>
              <Strip tracking={value} />
            </div>
          );
        },
      )}
    </div>
  ),
};

/** Side by side with the old word, for scale and weight. */
export const AgainstTheOldWord: Story = {
  render: () => (
    <div style={{ display: "flex", "flex-direction": "column", gap: "10px" }}>
      <Label>mark</Label>
      <Strip />
      <Label>previous wordmark</Label>
      <Strip tracking=".08em">bismuth</Strip>
    </div>
  ),
};
