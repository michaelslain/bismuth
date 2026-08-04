// Visual spec for <GcalConnectModal> — "Connect Google Calendar" panel. Fetches
// GET /gcal/status in onMount; the Storybook-wide fakeTransport (.storybook/preview.ts;
// only /tree, /version, /file, /rows answered) throws on that path, the modal's own
// try/catch/finally clears `loading` with `status` still null, and — since
// `status()?.connected` is then falsy — it lands on the real DISCONNECTED form (Client
// ID / Client Secret fields + CONNECT), not stuck on "Loading…".
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createSignal } from "solid-js";
import { GcalConnectModal } from "./GcalConnectModal";
import { Button } from "./ui/Button";

const meta = {
  title: "Modals/GcalConnectModal",
  component: GcalConnectModal,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof GcalConnectModal>;

export default meta;
type Story = StoryObj<typeof meta>;

const noop = () => {};

/** Open, onClose a no-op, no basePath (opened from the command palette rather than a
 *  calendar's own settings). Status never resolves, so it shows the disconnected credentials
 *  form rather than a connected-account summary. */
export const Default: Story = {
  render: () => <GcalConnectModal onClose={noop} />,
};

/** Interactive: a trigger opens the modal; CLOSE (or Escape) closes it — exercising the
 *  onClose callback Default no-ops. */
export const Interactive: Story = {
  render: () => {
    const [open, setOpen] = createSignal(true);
    return (
      <div style={{ padding: "40px" }}>
        <Button kind="text" state="selected" onClick={() => setOpen(true)}>Open Google Calendar connect</Button>
        {open() && <GcalConnectModal onClose={() => setOpen(false)} />}
      </div>
    );
  },
};
