// Visual spec for <InboxPageView> — the action-bar HEADER rendered above a `type:
// daemon-page` note's editor: the page's actions[] as buttons, or a status chip/owner
// warning once there's nothing left to press. Like InboxView, `page()` is looked up by
// `path` in the SAME module-level daemonInbox.ts signal — populated the same way here (a
// scoped GET /daemon/pages route + refreshDaemonPages() called inside each story's render).
//
// The body below the header is the REAL Editor.tsx (CodeMirror) — settings.editor.defaultMode
// defaults to "source" — mounted with `initialText` so it never needs to fetch the file
// itself. `api.daemonStatus()` (GET /daemon/status, used for the "not the owner device"
// warning) is left unhandled: createResource's fetch just rejects and `notOwner()` degrades
// to false, same as a real offline backend — no route needed for these two states.
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { InboxPageView } from "./InboxPageView";
import { refreshDaemonPages } from "./daemonInbox";
import { setTransport } from "./api";
import { fakeTransport } from "./ui/_fakeTransport";
import { sampleDaemonPages } from "./ui/_daemonFixtures";
import type { Transport } from "./api";

function pagesTransport(): Transport {
  const base = fakeTransport();
  return {
    ...base,
    getJson: async <T,>(path: string): Promise<T> => {
      if (path === "/daemon/pages") return sampleDaemonPages() as unknown as T;
      return base.getJson<T>(path);
    },
  };
}

const meta = {
  title: "App/InboxPageView",
  component: InboxPageView,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof InboxPageView>;

export default meta;
type Story = StoryObj<typeof meta>;

const noop = () => {};

/** A pending page: two live header actions ("Send" / "Dismiss"). */
export const Pending: Story = {
  render: () => {
    setTransport(pagesTransport());
    void refreshDaemonPages();
    return (
      <InboxPageView
        path=".daemon/pages/reply-drafts.md"
        initialText={"# 3 reply drafts ready\n\nDrafted replies to 3 unread emails from the last hour. Review before sending.\n"}
        onSaved={noop}
        noteNames={() => []}
        memoryNames={() => []}
        tagNames={() => []}
      />
    );
  },
};

/** A failed page: the danger note plus its still-live retry action. */
export const Failed: Story = {
  render: () => {
    setTransport(pagesTransport());
    void refreshDaemonPages();
    return (
      <InboxPageView
        path=".daemon/pages/gcal-sync.md"
        initialText={"# Calendar sync failed\n\nGoogle Calendar sync failed: token expired.\n"}
        onSaved={noop}
        noteNames={() => []}
        memoryNames={() => []}
        tagNames={() => []}
      />
    );
  },
};
