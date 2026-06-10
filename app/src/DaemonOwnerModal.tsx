// app/src/DaemonOwnerModal.tsx
// Pick which device owns the claude-bot daemon. Lists every heartbeating device
// (from GET /daemon/devices), marks the current owner and this machine, and on
// confirm writes owner.json via POST /daemon/owner (the single source of truth —
// Bismuth does NOT store the owner as a setting). Reuses the shared Modal +
// Select chrome (same as FolderPrompt / the calendar dialogs).
import { createSignal, onMount, Show } from "solid-js";
import { Modal } from "./ui/Modal";
import { Select } from "./ui/Select";
import { TextButton } from "./ui/TextButton";
import { api } from "./api";
import { pushToast } from "./Toast";
import type { DeviceEntry } from "../../core/src/daemon";
import { relTimeISO } from "./relTime";
import "./FolderPrompt.css";

export function DaemonOwnerModal(props: { onClose: () => void }) {
  const [devices, setDevices] = createSignal<DeviceEntry[]>([]);
  const [selected, setSelected] = createSignal<string>("");
  const [loading, setLoading] = createSignal(true);
  const [saving, setSaving] = createSignal(false);

  onMount(async () => {
    try {
      const { devices, ownerDeviceId } = await api.daemonDevices();
      setDevices(devices);
      // Default the picker to the current owner, else this device, else the first.
      const me = devices.find((d) => d.isThis)?.deviceId;
      setSelected(ownerDeviceId ?? me ?? devices[0]?.deviceId ?? "");
    } catch (e) {
      pushToast(`Couldn't load devices: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  });

  // A short suffix marking owner / this device, shown in the dropdown label.
  const tagFor = (d: DeviceEntry): string => {
    const tags: string[] = [];
    if (d.isOwner) tags.push("owner");
    if (d.isThis) tags.push("this device");
    return tags.length ? ` (${tags.join(", ")})` : "";
  };

  const options = () =>
    devices().map((d) => ({
      value: d.deviceId,
      label: `${d.label || d.deviceId}${tagFor(d)} · ${relTimeISO(d.lastSeenISO)}`,
    }));

  const submit = async () => {
    const id = selected();
    if (!id || saving()) return;
    setSaving(true);
    try {
      const owner = await api.setDaemonOwner(id);
      pushToast(`Daemon owner set to ${owner.ownerLabel || owner.ownerDeviceId}`);
      props.onClose();
    } catch (e) {
      pushToast(`Set owner failed: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal onClose={props.onClose} class="folder-prompt" closeOnBackdrop={false}>
      <div class="folder-prompt-title">Set daemon owner device</div>
      <div class="folder-prompt-hint">
        The owner device runs the claude-bot daemon (crons + the persistent bot session).
        Other devices idle but stay selectable.
      </div>
      <Show
        when={!loading()}
        fallback={<div class="folder-prompt-hint">Loading devices…</div>}
      >
        <Show
          when={devices().length > 0}
          fallback={
            <div class="folder-prompt-hint">
              No devices have checked in yet. Start the claude-bot daemon, then reopen this.
            </div>
          }
        >
          <Select value={selected()} options={options()} onChange={setSelected} />
        </Show>
      </Show>
      <div class="folder-prompt-actions">
        <TextButton onClick={props.onClose}>CANCEL</TextButton>
        <TextButton
          variant="selected"
          onClick={submit}
          disabled={loading() || saving() || devices().length === 0 || selected() === ""}
        >
          SET OWNER
        </TextButton>
      </div>
    </Modal>
  );
}
