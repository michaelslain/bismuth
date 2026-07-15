// app/src/calendar/components/GcalSyncPanel.tsx
// The "Google Calendar sync" section of a calendar's settings modal (CalendarSettings).
// PER-CALENDAR: the on/off toggle + the target Google calendar id are stored on THIS
// calendar base's own frontmatter (googleCalendarSync / googleCalendarId, via setProperty),
// so a vault can have several calendars each synced with a different Google calendar. The
// account connection + conflict policy + cadence are connection-level (shared), read from the
// backend (~/.bismuth/gcal) and the global `googleCalendar` settings respectively.
import { createEffect, createResource, createSignal, Show } from "solid-js";
import { settings, setSettings } from "../../settings";
import { api, summarizeSync } from "../../api";
import { Select } from "../../ui/Select";
import { TextButton } from "../../ui/TextButton";
import { TextInput } from "../../ui/TextInput";
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

type GcalView = { googleCalendarSync?: boolean; googleCalendarId?: string };

export function GcalSyncPanel(props: { basePath: string }) {
  const [status, { refetch }] = createResource(() => api.gcalStatus());
  // This base's parsed config → its per-calendar sync linkage.
  const [parsed, { refetch: refetchBase }] = createResource(() => props.basePath, (p) => api.base(p));
  const [showConnect, setShowConnect] = createSignal(false);
  const [busy, setBusy] = createSignal(false);

  const view = (): GcalView => (parsed()?.config.views?.[0] as GcalView | undefined) ?? {};
  const syncedHere = () => Boolean(view().googleCalendarSync);
  const gc = () => settings.googleCalendar;

  // The Google calendar id field, seeded from (and re-seeded on external change to) the base.
  const [calId, setCalId] = createSignal("primary");
  createEffect(() => {
    const id = view().googleCalendarId;
    setCalId(typeof id === "string" && id.trim() ? id : "primary");
  });

  const toggle = async () => {
    if (busy()) return;
    setBusy(true);
    try {
      const next = !syncedHere();
      await api.setProperty(props.basePath, "googleCalendarSync", next);
      // On first enable, make sure a target calendar id is persisted (default "primary").
      if (next && !view().googleCalendarId) {
        await api.setProperty(props.basePath, "googleCalendarId", calId().trim() || "primary");
      }
      await refetchBase();
    } catch (e) {
      pushToast(`Couldn't update sync: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  // Persist the calendar id (on blur / Enter) — only when it actually changed.
  const commitCalId = async () => {
    const v = calId().trim() || "primary";
    if (v === (view().googleCalendarId ?? "primary")) return;
    await api.setProperty(props.basePath, "googleCalendarId", v);
    await refetchBase();
  };

  const syncNow = async () => {
    if (busy()) return;
    setBusy(true);
    try {
      await commitCalId(); // flush any pending id edit so this sync targets the right calendar
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
          <div class="set-lab"><Icon value="calendar" size={14} strokeWidth={2} />Google calendar</div>
          <TextInput
            value={calId()}
            onInput={setCalId}
            onBlur={() => void commitCalId()}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void commitCalId(); } }}
            placeholder="primary"
            spellcheck={false}
            autocapitalize="off"
            autocorrect="off"
          />
          <div class="set-hint">Which Google calendar this base syncs with. <code>primary</code> is your main calendar; paste another calendar's ID (Google Calendar → Settings → Integrate calendar → Calendar ID) to sync a different one.</div>
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
        <GcalConnectModal basePath={props.basePath} onClose={() => { setShowConnect(false); void refetch(); void refetchBase(); }} />
      </Show>
    </>
  );
}
