// app/src/InboxBell.tsx
// A small persistent inbox icon mounted next to <UpdateBanner/> (App.tsx) — the announce-on-
// open affordance for the daemon inbox (plan §6). Visible whenever the daemon is enabled; a
// badge overlays the count once something's due. Clicking opens/focuses the ::inbox tab.
// Deliberately quiet — the toast on newly-due (daemonInbox.ts) is what actually interrupts.
import { Show } from "solid-js";
import { settings } from "./settings";
import { dueCount } from "./daemonInbox";
import { Icon } from "./icons/Icon";
import "./InboxBell.css";

export function InboxBell(props: { onOpen: () => void }) {
  return (
    <Show when={settings.daemon.enabled}>
      <button class="inbox-bell" onClick={props.onOpen} title="Open daemon inbox">
        <Icon value="Inbox" size={14} />
        <Show when={dueCount() > 0}>
          <span class="inbox-bell-badge">{dueCount()}</span>
        </Show>
      </button>
    </Show>
  );
}
