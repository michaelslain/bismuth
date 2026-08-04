// Visual spec for <DaemonOwnerModal> — picks which device owns the daemon. Fetches
// GET /daemon/devices in onMount; the Storybook-wide fakeTransport (.storybook/preview.ts)
// doesn't special-case that path (it only answers /tree, /version, /file, /rows), so the
// fetch throws, the modal's own try/catch/finally clears `loading` with `devices` still
// empty, and the panel settles on its real "no devices have checked in" empty state
// rather than hanging on "Loading devices…".
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createSignal } from "solid-js";
import { DaemonOwnerModal } from "./DaemonOwnerModal";
import { Button } from "./ui/Button";

const meta = {
  title: "Modals/DaemonOwnerModal",
  component: DaemonOwnerModal,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof DaemonOwnerModal>;

export default meta;
type Story = StoryObj<typeof meta>;

const noop = () => {};

/** Open, onClose a no-op. No devices resolve (fake transport can't answer the fetch), so it
 *  shows the real "No devices have checked in yet" fallback with SET OWNER disabled. */
export const Default: Story = {
  render: () => <DaemonOwnerModal onClose={noop} />,
};

/** Interactive: a trigger opens the modal; CANCEL (or Escape) closes it — exercising the
 *  onClose callback Default no-ops. */
export const Interactive: Story = {
  render: () => {
    const [open, setOpen] = createSignal(true);
    return (
      <div style={{ padding: "40px" }}>
        <Button kind="text" state="selected" onClick={() => setOpen(true)}>Open owner picker</Button>
        {open() && <DaemonOwnerModal onClose={() => setOpen(false)} />}
      </div>
    );
  },
};
