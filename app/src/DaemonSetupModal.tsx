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
import type { InstallStatus } from "../../core/src/claudebot";
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

  const yn = (b: boolean | undefined) => (b ? "yes" : "no");

  return (
    <Modal onClose={props.onClose} class="folder-prompt" closeOnBackdrop={false}>
      <div class="folder-prompt-title">Set up claude-bot daemon</div>
      <div class="folder-prompt-hint">
        The claude-bot daemon runs crons and the persistent bot session in the background.
        Setup is idempotent — if it's already installed, this adopts the existing install
        without restarting or changing anything.
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
        <TextButton variant="selected" onClick={setup} disabled={loading() || running()}>
          {running() ? "WORKING…" : "SET UP / REPAIR"}
        </TextButton>
      </div>
    </Modal>
  );
}
