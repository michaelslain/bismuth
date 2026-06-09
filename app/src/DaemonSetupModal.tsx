// app/src/DaemonSetupModal.tsx
// "Set up claude-bot daemon" panel. Shows whether the claude-bot daemon is
// installed + running (GET /daemon/install) and who owns it (GET /daemon/status),
// and offers a single "Set up / repair" button that runs the idempotent,
// ADOPT-ONLY installer (POST /daemon/setup). Setup is safe to run even when the
// daemon is already live — claude-bot adopts the existing install (no clobber,
// no restart) and reports action "adopted". Reuses the shared Modal + TextButton
// chrome, same as DaemonOwnerModal / FolderPrompt.
import { createSignal, onMount, Show } from "solid-js";
import { Modal } from "./ui/Modal";
import { TextButton } from "./ui/TextButton";
import { api } from "./api";
import { pushToast } from "./Toast";
import type { InstallStatus, UpdateResult } from "../../core/src/claudebot";
import type { Owner } from "../../core/src/daemon";
import "./FolderPrompt.css";

/** Human-friendly summary of a setup action for the toast. */
function describeAction(action: string): string {
  switch (action) {
    case "adopted":
      return "claude-bot daemon already installed — adopted existing install";
    case "installed":
      return "claude-bot daemon installed";
    case "would-install":
      return "claude-bot daemon would be installed (dry run)";
    default:
      return `claude-bot setup: ${action}`;
  }
}

/** Human-friendly summary of an update result for the toast. */
function describeUpdate(r: UpdateResult): string {
  switch (r.action) {
    case "updated":
      return r.restarted ? "claude-bot updated + daemon restarted" : "claude-bot updated (restart it to apply)";
    case "up-to-date":
      return "claude-bot already up to date";
    case "no-remote":
      return "claude-bot update: no git remote configured";
    default:
      return `claude-bot update: ${r.action}`;
  }
}

export function DaemonSetupModal(props: { onClose: () => void }) {
  const [status, setStatus] = createSignal<InstallStatus | null>(null);
  const [owner, setOwner] = createSignal<Owner | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [running, setRunning] = createSignal(false);

  const refresh = async () => {
    // Both calls tolerate a daemon that has never run; installStatus never throws
    // server-side, and owner is null when unclaimed.
    const [install, daemon] = await Promise.allSettled([api.daemonInstall(), api.daemonStatus()]);
    if (install.status === "fulfilled") setStatus(install.value);
    if (daemon.status === "fulfilled") setOwner(daemon.value.owner);
  };

  onMount(async () => {
    try {
      await refresh();
    } catch (e) {
      pushToast(`Couldn't load daemon status: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  });

  const setup = async () => {
    if (running()) return;
    setRunning(true);
    try {
      const result = await api.daemonSetup();
      pushToast(describeAction(result.action));
      // Reflect the post-setup status in the panel.
      setStatus(result.status);
      await refresh();
    } catch (e) {
      pushToast(`Daemon setup failed: ${(e as Error).message}`);
    } finally {
      setRunning(false);
    }
  };

  const update = async () => {
    if (running()) return;
    setRunning(true);
    try {
      const result = await api.daemonUpdate();
      pushToast(describeUpdate(result));
      for (const w of result.warnings ?? []) pushToast(`claude-bot update: ${w}`);
      await refresh();
    } catch (e) {
      pushToast(`Daemon update failed: ${(e as Error).message}`);
    } finally {
      setRunning(false);
    }
  };

  const yn = (b: boolean | undefined) => (b ? "yes" : "no");

  return (
    <Modal onClose={props.onClose} class="folder-prompt" closeOnBackdrop={false}>
      <div class="folder-prompt-title">Set up claude-bot daemon</div>
      <div class="folder-prompt-hint">
        The claude-bot daemon runs crons and the persistent bot session in the background.
        <strong> Set up</strong> is idempotent — if already installed, it adopts the existing
        install without changing anything. <strong>Update</strong> pulls the latest claude-bot,
        reinstalls deps, and restarts the daemon.
      </div>
      <Show
        when={!loading()}
        fallback={<div class="folder-prompt-hint">Loading daemon status…</div>}
      >
        <div class="folder-prompt-hint">
          <div>Installed: {yn(status()?.installed)}</div>
          <div>Running: {yn(status()?.running)}</div>
          <div>
            Owner:{" "}
            {owner() ? owner()!.ownerLabel || owner()!.ownerDeviceId : "unclaimed"}
          </div>
          <Show when={status()?.home}>
            <div>Home: {status()!.home}</div>
          </Show>
        </div>
      </Show>
      <div class="folder-prompt-actions">
        <TextButton onClick={props.onClose}>CLOSE</TextButton>
        <TextButton onClick={update} disabled={loading() || running()}>
          {running() ? "WORKING…" : "UPDATE"}
        </TextButton>
        <TextButton variant="selected" onClick={setup} disabled={loading() || running()}>
          {running() ? "WORKING…" : "SET UP / REPAIR"}
        </TextButton>
      </div>
    </Modal>
  );
}
