// Visual spec for <FolderPrompt> — the "Open folder" modal (a typed absolute path, since
// there's no server-accessible native folder picker in the browser). Wraps its own <Modal>
// internally, so the story just needs a fullscreen canvas for the backdrop to fill.
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createSignal } from "solid-js";
import { FolderPrompt } from "./FolderPrompt";
import { TextButton } from "./ui/TextButton";

const meta = {
  title: "App/FolderPrompt",
  component: FolderPrompt,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof FolderPrompt>;

export default meta;
type Story = StoryObj<typeof meta>;

const noop = () => {};

/** Shown open (onClose is a no-op so it stays visible for the spec); OPEN starts disabled
 *  since the path field is empty. */
export const Default: Story = {
  render: () => <FolderPrompt onClose={noop} onOpen={noop} />,
};

/** Interactive: a trigger opens it, Escape / Cancel / backdrop closes it (closeOnBackdrop
 *  defaults true here — unlike the daemon's non-dismissable modals). */
export const Interactive: Story = {
  render: () => {
    const [open, setOpen] = createSignal(true);
    return (
      <div style={{ padding: "40px" }}>
        <TextButton onClick={() => setOpen(true)}>OPEN FOLDER…</TextButton>
        {open() && <FolderPrompt onClose={() => setOpen(false)} onOpen={() => setOpen(false)} />}
      </div>
    );
  },
};
