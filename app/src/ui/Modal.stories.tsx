// Visual spec for <Modal> — the shared overlay shell.
//
// Portal-mounted `.ui-overlay` backdrop (scrim) that centers an inner panel, closes on
// Escape, and (unless closeOnBackdrop={false}) on backdrop click. The panel's own look is
// the CALLER's `class` — Modal owns only the overlay + dismiss behavior — so these stories
// supply a representative dialog panel (styled from theme tokens) to show it in context.
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createSignal, type JSX } from "solid-js";
import { Modal } from "./Modal";
import { Button } from "./Button";

const meta = {
  title: "UI/Modal",
  component: Modal,
  // The overlay is fixed inset:0, so let it fill the preview frame.
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Modal>;

export default meta;
type Story = StoryObj<typeof meta>;

const noop = () => {};

/** A representative dialog panel (the app passes classes like `.event-modal`; here we
 *  inline the equivalent chrome from theme tokens so the shell shows in context). */
function DialogPanel(props: { onClose?: () => void; children?: JSX.Element }) {
  return (
    <div
      style={{
        background: "var(--surface-1)",
        border: "1px solid var(--border)",
        "border-radius": "12px",
        padding: "24px",
        width: "min(440px, 92vw)",
        "box-shadow": "var(--shadow-modal)",
        display: "flex",
        "flex-direction": "column",
        gap: "14px",
      }}
    >
      <div style={{ "font-family": "var(--editor-font)", "font-size": "20px", color: "var(--fg)" }}>
        Delete note?
      </div>
      <div style={{ "font-size": "13px", "line-height": 1.6, color: "var(--text-muted)" }}>
        {props.children ??
          "This moves “Meeting notes 2026-07-07” to the trash. You can undo this from the file tree with Cmd+Z."}
      </div>
      <div style={{ display: "flex", "justify-content": "flex-end", gap: "8px", "margin-top": "4px" }}>
        <Button kind="text" state="unselected" onClick={() => props.onClose?.()}>Cancel</Button>
        <Button kind="text" danger onClick={() => props.onClose?.()}>Delete</Button>
      </div>
    </div>
  );
}

/** The modal shown open (onClose is a no-op so it stays visible for the spec). */
export const Default: Story = {
  render: () => (
    <Modal onClose={noop}>
      <DialogPanel />
    </Modal>
  ),
};

/** Backdrop click does NOT dismiss (closeOnBackdrop={false}); only Escape / an explicit
 *  action closes it. */
export const NonDismissableBackdrop: Story = {
  render: () => (
    <Modal onClose={noop} closeOnBackdrop={false}>
      <DialogPanel>
        This dialog ignores backdrop clicks (closeOnBackdrop=false). Press Escape or use a
        button to close it.
      </DialogPanel>
    </Modal>
  ),
};

/** Interactive: a trigger opens the modal; Escape / backdrop / a button closes it. */
export const Interactive: Story = {
  render: () => {
    const [open, setOpen] = createSignal(true);
    return (
      <div style={{ padding: "40px" }}>
        <Button kind="text" state="selected" onClick={() => setOpen(true)}>Open modal</Button>
        {open() && (
          <Modal onClose={() => setOpen(false)}>
            <DialogPanel onClose={() => setOpen(false)} />
          </Modal>
        )}
      </div>
    );
  },
};
