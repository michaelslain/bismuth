// app/src/BismuthInstallModal.tsx
// "Install Bismuth CLI + MCP" panel. Shows whether the machine-wide `bismuth` CLI is on
// PATH and the bismuth MCP is registered in the global Claude config (GET /bismuth/install),
// and offers a single button that runs the idempotent, version-gated installer
// (POST /bismuth/install) — a no-op when the bundled tools are already current. Mirrors
// DaemonSetupModal; reuses the shared Modal + TextButton chrome.
import { createSignal, onMount, Show, For } from "solid-js";
import { Modal } from "./ui/Modal";
import { TextButton } from "./ui/TextButton";
import { api } from "./api";
import { pushToast } from "./Toast";
import type { BismuthStatus } from "../../core/src/bismuthInstall";
import "./FolderPrompt.css";

function describeAction(action: string): string {
  switch (action) {
    case "up-to-date":
      return "Bismuth CLI + MCP already up to date";
    case "installed":
      return "Bismuth CLI + MCP installed";
    case "updated":
      return "Bismuth CLI + MCP updated";
    case "skipped-no-src":
      return "No bundled tools to install (dev build)";
    default:
      return `Bismuth install: ${action}`;
  }
}

export function BismuthInstallModal(props: { onClose: () => void }) {
  const [status, setStatus] = createSignal<BismuthStatus | null>(null);
  const [warnings, setWarnings] = createSignal<string[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [running, setRunning] = createSignal(false);

  const refresh = async () => {
    setStatus(await api.bismuthInstallStatus());
  };

  onMount(async () => {
    try {
      await refresh();
    } catch (e) {
      pushToast(`Couldn't load install status: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  });

  const install = async () => {
    if (running()) return;
    setRunning(true);
    try {
      const result = await api.bismuthInstall();
      pushToast(describeAction(result.action));
      setStatus(result.status);
      setWarnings(result.warnings);
    } catch (e) {
      pushToast(`Install failed: ${(e as Error).message}`);
    } finally {
      setRunning(false);
    }
  };

  const yn = (b: boolean | undefined) => (b ? "yes" : "no");

  return (
    <Modal onClose={props.onClose} class="folder-prompt" closeOnBackdrop={false}>
      <div class="folder-prompt-title">Install Bismuth CLI + MCP</div>
      <div class="folder-prompt-hint">
        Installs the <code>bismuth</code> CLI on your PATH and registers the Bismuth MCP in
        your global Claude config, so every terminal and Claude session can use them.
        Idempotent — it only reinstalls when the bundled tools change.
      </div>
      <Show when={!loading()} fallback={<div class="folder-prompt-hint">Loading install status…</div>}>
        <div class="folder-prompt-hint">
          <div>CLI on PATH: {yn(status()?.cliLinked)}{status()?.cliPath ? ` (${status()!.cliPath})` : ""}</div>
          <div>MCP registered: {yn(status()?.mcpRegistered)}</div>
          <Show when={status()?.version}>
            <div>Version: {status()!.version}</div>
          </Show>
        </div>
      </Show>
      <Show when={warnings().length > 0}>
        <div class="folder-prompt-hint">
          <For each={warnings()}>{(w) => <div>⚠ {w}</div>}</For>
        </div>
      </Show>
      <div class="folder-prompt-actions">
        <TextButton onClick={props.onClose}>CLOSE</TextButton>
        <TextButton variant="selected" onClick={install} disabled={loading() || running()}>
          {running() ? "WORKING…" : "INSTALL / UPDATE"}
        </TextButton>
      </div>
    </Modal>
  );
}
