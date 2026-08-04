// Visual spec for <NoteTitle> — the inline, display-only `# <title>` heading at the top of
// a note editor. Title is a pure function of `path` (deriveTitle, noteTitleOps.ts); editing
// + committing renames the file via api.move (a generic-ok POST under the shared fakeTransport).
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { NoteTitle } from "./NoteTitle";

const meta = {
  title: "App/NoteTitle",
  component: NoteTitle,
  parameters: { layout: "padded" },
} satisfies Meta<typeof NoteTitle>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A short, ordinary note title. */
export const Default: Story = {
  render: () => (
    <div style={{ width: "480px" }}>
      <NoteTitle path="reading/Weekly Review.md" />
    </div>
  ),
};

/** A long title — the field is a <textarea> that auto-grows to wrap it onto multiple lines
 *  rather than clipping (NoteTitle.tsx's own `autosize`). */
export const LongTitle: Story = {
  render: () => (
    <div style={{ width: "480px" }}>
      <NoteTitle path="projects/Q3 roadmap review notes and follow-up action items from the planning offsite.md" />
    </div>
  ),
};
