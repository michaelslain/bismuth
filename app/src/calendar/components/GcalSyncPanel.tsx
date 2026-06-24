// app/src/calendar/components/GcalSyncPanel.tsx
// The "Google Calendar sync" section of a calendar's settings modal (CalendarSettings).
// Shows the connection, lets you designate THIS calendar as the synced one, pick the
// conflict policy, sync now, and connect/disconnect. Reads/writes the global
// `googleCalendar` settings (the store auto-persists); connection status comes from the
// backend (~/.bismuth/gcal). There is one synced calendar at a time, so the toggle points
// the sync at this base.
import { createResource, createSignal, Show } from "solid-js";
import { settings, setSettings } from "../../settings";
import { api, summarizeSync } from "../../api";
import { Select } from "../../ui/Select";
import { TextButton } from "../../ui/TextButton";
import { IconTextButton } from "../../ui/IconTextButton";
import { StatusDot } from "../../ui/StatusDot";
import { Icon } from "../../icons/Icon";
import { pushToast } from "../../Toast";
import { GcalConnectModal } from "../../GcalConnectModal";

const POLICIES = [
  { value: "bismuthWins", label: "This calendar wins" },
  { value: "lastWriteWins", label: "Most recent edit wins" },
  { value: "googleWins", label: "Google wins" },
];

export function GcalSyncPanel(props: { basePath: string }) {
  const [status, { refetch }] = createResource(() => api.gcalStatus());
  const [showConnect, setShowConnect] = createSignal(false);
  const [busy, setBusy] = createSignal(false);

  const gc = () => settings.googleCalendar;
  const syncedHere = () => gc().enabled && gc().basePath === props.basePath;

  const toggle = () => {
    if (syncedHere()) {
      setSettings("googleCalendar", "enabled", false);
    } else {
      setSettings("googleCalendar", "basePath", props.basePath);
      setSettings("googleCalendar", "enabled", true);
    }
  };

  const syncNow = async () => {
    if (busy()) return;
    setBusy(true);
    try {
      // Persist this calendar as the synced one (for auto-sync) AND pass it explicitly so this
      // immediate sync targets it without waiting for the debounced settings write to land.
      if (gc().basePath !== props.basePath) setSettings("googleCalendar", "basePath", props.basePath);
      pushToast(summarizeSync(await api.gcalSync(props.basePath)));
    } catch (e) {
      pushToast(`Sync failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (busy()) return;
    setBusy(true);
    try {
      await api.gcalDisconnect();
      await refetch();
      pushToast("Disconnected from Google Calendar");
    } catch (e) {
      pushToast(`Disconnect failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div class="set-sect">Google Calendar sync</div>

      <Show
        when={status()?.connected}
        fallback={
          <div class="gcal-connect">
            <div class="set-hint">
              Two-way sync between this calendar and Google — events only (no Gmail, Drive, or contacts).
            </div>
            <IconTextButton icon="Calendar" size="sm" variant="selected" onClick={() => setShowConnect(true)}>
              CONNECT GOOGLE CALENDAR
            </IconTextButton>
          </div>
        }
      >
        <div class="gcal-status">
          <StatusDot color="var(--green)" />
          <span class="gcal-acct">{status()!.account}</span>
          <TextButton size="sm" danger onClick={disconnect} disabled={busy()}>DISCONNECT</TextButton>
        </div>

        <div class="gcal-toggle-group">
          <div class="set-cols">
            <div class={"set-col" + (syncedHere() ? "" : " off")} onClick={toggle} role="switch" aria-checked={syncedHere()}>
              <span class="set-col-name">Sync this calendar with Google</span>
              <span class={"evm-toggle" + (syncedHere() ? " on" : "")}><i /></span>
            </div>
          </div>
          <div class="set-hint">Two-way every {gc().syncIntervalMinutes} min, and whenever you hit Sync now.</div>
        </div>

        <div class="set-field span">
          <div class="set-lab"><Icon value="git-merge" size={14} strokeWidth={2} />On a conflict</div>
          <Select
            value={gc().conflictPolicy}
            options={POLICIES}
            onChange={(v) => setSettings("googleCalendar", "conflictPolicy", v as typeof settings.googleCalendar.conflictPolicy)}
          />
          <div class="set-hint">Which side wins if an event changed in both places since the last sync.</div>
        </div>

        <div class="gcal-actions">
          <IconTextButton icon="RefreshCw" size="sm" variant="selected" onClick={syncNow} disabled={busy()}>
            {busy() ? "SYNCING…" : "SYNC NOW"}
          </IconTextButton>
        </div>
      </Show>

      <Show when={showConnect()}>
        <GcalConnectModal onClose={() => { setShowConnect(false); void refetch(); }} />
      </Show>
    </>
  );
}
