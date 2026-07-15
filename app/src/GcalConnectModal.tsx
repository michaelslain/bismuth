// app/src/GcalConnectModal.tsx
// "Connect Google Calendar" panel (Phase 0 of two-way sync). Shows the current
// connection (GET /gcal/status) and either:
//   • connected → the account + a Disconnect button, or
//   • disconnected → fields for the OAuth "Desktop app" Client ID + Secret, then a
//     Connect button that stores them (POST /gcal/credentials), starts the PKCE flow
//     (POST /gcal/auth/start), opens Google's consent page in the SYSTEM browser, and
//     polls status until the loopback callback completes on the backend.
// Mirrors BismuthInstallModal; reuses the shared Modal + FolderPrompt chrome. Only the
// non-secret Client ID/Secret are entered here — they're persisted outside the vault and
// never touch settings.yaml/git. The single scope requested is calendar.events.
//
// The Google ACCOUNT connection is one per machine (OAuth is account-level), but sync is
// PER-CALENDAR: when opened from a calendar's settings, `basePath` is the currently-open
// calendar — on a successful connect we turn ON sync for THAT base, and "Sync now" targets it.
import { createSignal, onMount, onCleanup, Show } from "solid-js";
import { Modal } from "./ui/Modal";
import { TextButton } from "./ui/TextButton";
import { api, summarizeSync } from "./api";
import { pushToast } from "./Toast";
import { openExternalUrl } from "./appWindow";
import type { GcalStatus } from "../../core/src/gcal";
import "./FolderPrompt.css";

export function GcalConnectModal(props: { onClose: () => void; basePath?: string }) {
  const [status, setStatus] = createSignal<GcalStatus | null>(null);
  const [clientId, setClientId] = createSignal("");
  const [clientSecret, setClientSecret] = createSignal("");
  const [loading, setLoading] = createSignal(true);
  const [busy, setBusy] = createSignal(false);
  let cancelled = false;
  onCleanup(() => { cancelled = true; });

  const refresh = async () => setStatus(await api.gcalStatus());

  onMount(async () => {
    try {
      await refresh();
    } catch (e) {
      pushToast(`Couldn't load Google Calendar status: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  });

  // Poll status after opening the browser until the backend completes the callback.
  const pollUntilConnected = async () => {
    const deadline = Date.now() + 3 * 60 * 1000; // 3 minutes
    while (!cancelled && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1500));
      if (cancelled) return;
      try {
        const s = await api.gcalStatus();
        setStatus(s);
        if (s.connected) {
          // Connecting from a calendar's settings → turn ON sync for THAT calendar base
          // (per-calendar linkage), so the account connect immediately wires up this calendar.
          if (props.basePath) {
            try { await api.setProperty(props.basePath, "googleCalendarSync", true); } catch { /* non-fatal */ }
          }
          pushToast(`Connected to Google Calendar${s.account ? ` as ${s.account}` : ""}`);
          return;
        }
      } catch {
        /* transient — keep polling */
      }
    }
  };

  const connect = async () => {
    if (busy()) return;
    setBusy(true);
    try {
      const needsCreds = status()?.needsCredentials ?? true;
      const id = clientId().trim();
      const secret = clientSecret().trim();
      if (needsCreds || id || secret) {
        if (!id || !secret) {
          pushToast("Enter both the Client ID and Client Secret");
          return;
        }
        await api.gcalSetCredentials(id, secret);
      }
      const { url } = await api.gcalAuthStart();
      await openExternalUrl(url);
      pushToast("Approve access in your browser, then return here…");
      await pollUntilConnected();
    } catch (e) {
      pushToast(`Connect failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (busy()) return;
    setBusy(true);
    try {
      await api.gcalDisconnect();
      await refresh();
      pushToast("Disconnected from Google Calendar");
    } catch (e) {
      pushToast(`Disconnect failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const syncNow = async () => {
    if (busy()) return;
    setBusy(true);
    try {
      pushToast(summarizeSync(await api.gcalSync(props.basePath)));
    } catch (e) {
      pushToast(`Sync failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={props.onClose} class="folder-prompt" closeOnBackdrop={false}>
      <div class="folder-prompt-title">Connect Google Calendar</div>

      <Show when={!loading()} fallback={<div class="folder-prompt-hint">Loading…</div>}>
        <Show
          when={status()?.connected}
          fallback={
            <>
              <div class="folder-prompt-hint">
                Two-way sync requests a single scope — <code>calendar.events</code> (view &amp; edit
                events only). It can't read your Gmail, Drive, or contacts. Create an OAuth
                <b> Desktop app</b> client in Google Cloud Console and paste its credentials below;
                they're stored outside your vault, never in git.
              </div>
              <input
                class="folder-prompt-input"
                placeholder="Client ID (…apps.googleusercontent.com)"
                value={clientId()}
                spellcheck={false}
                autocapitalize="off"
                autocorrect="off"
                onInput={(e) => setClientId(e.currentTarget.value)}
              />
              <input
                class="folder-prompt-input"
                type="password"
                placeholder="Client Secret"
                value={clientSecret()}
                spellcheck={false}
                autocapitalize="off"
                autocorrect="off"
                onInput={(e) => setClientSecret(e.currentTarget.value)}
              />
            </>
          }
        >
          <div class="folder-prompt-hint">
            Connected{status()?.account ? <> as <b>{status()!.account}</b></> : ""}.
            {status()?.timeZone ? <> Calendar timezone: {status()!.timeZone}.</> : ""}
          </div>
        </Show>
      </Show>

      <div class="folder-prompt-actions">
        <TextButton onClick={props.onClose}>CLOSE</TextButton>
        <Show
          when={status()?.connected}
          fallback={
            <TextButton variant="selected" onClick={connect} disabled={loading() || busy()}>
              {busy() ? "CONNECTING…" : "CONNECT"}
            </TextButton>
          }
        >
          <TextButton onClick={disconnect} disabled={busy()}>DISCONNECT</TextButton>
          <TextButton variant="selected" onClick={syncNow} disabled={busy()}>
            {busy() ? "SYNCING…" : "SYNC NOW"}
          </TextButton>
        </Show>
      </div>
    </Modal>
  );
}
