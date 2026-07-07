// app/src/InboxView.tsx
// The `::inbox` tab (INBOX_TAB, tabIds.ts): a top-level view over every daemon-authored page
// (core/src/daemonPages.ts) in three sections — Needs review (due, FIFO), Scheduled (future
// deliverAt, transparency-only), Recently resolved (terminal, collapsed, newest-first). Sorting/
// grouping is pure (daemonInboxLogic.ts); this component is just the presentation + press wiring.
import { createMemo, createSignal, For, Show } from "solid-js";
import type { DaemonPage, PageStatus } from "../../core/src/daemonPages";
import { inboxPages, refreshDaemonPages } from "./daemonInbox";
import { dueSorted, scheduledSorted, resolvedSorted, sharedPrimaryAction } from "./daemonInboxLogic";
import { api } from "./api";
import { pushToast } from "./Toast";
import { ViewBar, Crumb } from "./ui/ViewBar";
import { TextButton } from "./ui/TextButton";
import { EmptyState } from "./ui/EmptyState";
import { relTimeISO } from "./relTime";
import "./InboxView.css";

const STATUS_COLOR: Record<PageStatus, string> = {
  pending: "var(--text-muted)",
  working: "var(--accent)",
  done: "var(--green)",
  failed: "var(--rose)",
  dismissed: "var(--text-muted)",
};

/** ~120-char single-line preview of a page's body — collapse whitespace/markdown noise so the
 *  row reads as a snippet, not a wrapped paragraph. */
function snippet(body: string): string {
  const flat = body.replace(/[#*_`>[\]]/g, "").replace(/\s+/g, " ").trim();
  return flat.length > 120 ? flat.slice(0, 120) + "…" : flat;
}

function PageRow(props: { page: DaemonPage; onOpen: (path: string) => void; showActions: boolean; onChanged: () => void }) {
  const [pressingId, setPressingId] = createSignal<string | null>(null);

  async function press(actionId: string): Promise<void> {
    setPressingId(actionId);
    try {
      const res = await api.resolveDaemonPage(props.page.path, actionId);
      if (res.alreadyResolved) pushToast("Already resolved");
      props.onChanged();
    } catch (e) {
      pushToast(`Couldn't resolve: ${(e as Error).message}`);
    } finally {
      setPressingId(null);
    }
  }

  return (
    <div class="inbox-row" onClick={() => props.onOpen(props.page.path)}>
      <span class="inbox-row-dot" style={{ background: STATUS_COLOR[props.page.status] }} />
      <div class="inbox-row-main">
        <div class="inbox-row-head">
          <span class="inbox-row-title">{props.page.title}</span>
          <Show when={props.page.source}>
            <span class="inbox-row-source">{props.page.source}</span>
          </Show>
          <span class="inbox-row-time">{relTimeISO(props.page.createdAt)}</span>
        </div>
        <div class="inbox-row-snippet">{snippet(props.page.body)}</div>
      </div>
      <Show when={props.showActions}>
        <div class="inbox-row-actions" onClick={(e) => e.stopPropagation()}>
          <For each={props.page.actions}>
            {(a) => (
              <TextButton
                size="sm"
                variant={a.kind === "primary" ? "selected" : "normal"}
                danger={a.kind === "danger"}
                disabled={props.page.status === "working"}
                onClick={() => press(a.id)}
              >
                {props.page.status === "working" && pressingId() === a.id ? "…" : a.label.toUpperCase()}
              </TextButton>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

export function InboxView(props: { onOpen: (path: string) => void }) {
  const now = () => Date.now();
  const due = createMemo(() => dueSorted(inboxPages(), now()));
  const scheduled = createMemo(() => scheduledSorted(inboxPages(), now()));
  const resolved = createMemo(() => resolvedSorted(inboxPages()));
  const [resolvedOpen, setResolvedOpen] = createSignal(false);

  const approveAllId = createMemo(() => sharedPrimaryAction(due()));

  // Presses run SEQUENTIALLY, never parallel — the daemon multiplexes every vault's brain off
  // one process, so firing a batch of one-shot sessions all at once would just queue behind
  // each other anyway; sequential keeps the UI's per-row state honest as each settles.
  async function approveAll(): Promise<void> {
    const actionId = approveAllId();
    if (!actionId) return;
    for (const p of due()) {
      try {
        await api.resolveDaemonPage(p.path, actionId);
      } catch (e) {
        pushToast(`Couldn't resolve "${p.title}": ${(e as Error).message}`);
      }
    }
    refresh();
  }

  function refresh(): void {
    // The row press already updated the sidecar on disk; App.tsx's own poll will catch it too,
    // but pull it forward here so the UI updates at once instead of waiting for the next tick.
    void refreshDaemonPages();
  }

  return (
    <div class="inbox-host">
      <ViewBar>
        <Crumb icon="Inbox">Inbox</Crumb>
      </ViewBar>
      <div class="inbox-body">
        <Show when={due().length === 0 && scheduled().length === 0 && resolved().length === 0}>
          <EmptyState title="Inbox empty">Pages the daemon needs you to approve or dismiss will show up here.</EmptyState>
        </Show>

        <Show when={due().length > 0}>
          <div class="inbox-section-head">
            Needs review <span class="inbox-section-count">{due().length}</span>
            <Show when={approveAllId()}>
              <TextButton size="sm" onClick={approveAll} style={{ "margin-left": "auto" }}>
                APPROVE ALL
              </TextButton>
            </Show>
          </div>
          <For each={due()}>{(p) => <PageRow page={p} onOpen={props.onOpen} showActions onChanged={refresh} />}</For>
        </Show>

        <Show when={scheduled().length > 0}>
          <div class="inbox-section-head">
            Scheduled <span class="inbox-section-count">{scheduled().length}</span>
          </div>
          <For each={scheduled()}>{(p) => <PageRow page={p} onOpen={props.onOpen} showActions={false} onChanged={refresh} />}</For>
        </Show>

        <Show when={resolved().length > 0}>
          <div class="inbox-section-head inbox-section-head-collapsible" onClick={() => setResolvedOpen((v) => !v)}>
            Recently resolved <span class="inbox-section-count">{resolved().length}</span>
            <span class="inbox-section-toggle">{resolvedOpen() ? "hide" : "show"}</span>
          </div>
          <Show when={resolvedOpen()}>
            <For each={resolved()}>{(p) => <PageRow page={p} onOpen={props.onOpen} showActions={false} onChanged={refresh} />}</For>
          </Show>
        </Show>
      </div>
    </div>
  );
}
