// app/src/UpdateBanner.tsx
// A slim top bar shown when the source-built app is behind origin/main (auto-detected by
// updateCheck.ts). The Update button starts the background self-update (POST /update/apply),
// polls progress (GET /update/progress), and when the build is ready invokes the Tauri
// `quit_app` command so the detached relauncher can swap the .app bundle + reopen it.
import { createSignal, Show } from "solid-js";
import { updateStatus, applyUpdateAndRelaunch } from "./updateCheck";
import { pushToast } from "./Toast";
import type { UpdatePhase } from "../../core/src/selfUpdate";
import "./UpdateBanner.css";

function phaseLabel(p: UpdatePhase | ""): string {
  switch (p) {
    case "pulling": return "Pulling…";
    case "building": return "Building… (a few min)";
    case "ready": return "Relaunching…";
    default: return "";
  }
}

export function UpdateBanner() {
  const [dismissed, setDismissed] = createSignal(false);
  const [working, setWorking] = createSignal(false);
  const [phase, setPhase] = createSignal<UpdatePhase | "">("");

  const behind = () => updateStatus()?.behind ?? 0;
  const show = () => !!updateStatus()?.available && !dismissed();

  const update = async () => {
    if (working()) return;
    setWorking(true);
    setPhase("pulling");
    try {
      const r = await applyUpdateAndRelaunch(setPhase);
      if (r.result === "relaunching") return; // quitting; relauncher takes over
      if (r.result === "error") pushToast(r.message ?? "Update failed");
      setWorking(false); // error or already up to date
    } catch (e) {
      pushToast(`Update failed: ${(e as Error).message}`);
      setWorking(false);
    }
  };

  return (
    <Show when={show()}>
      <div class="update-banner">
        <span class="update-banner-text">
          Bismuth update available — {behind()} commit{behind() === 1 ? "" : "s"} behind
        </span>
        <span class="update-banner-actions">
          <Show when={working()}>
            <span class="update-banner-phase">{phaseLabel(phase())}</span>
          </Show>
          <button class="update-banner-btn" onClick={update} disabled={working()}>
            {working() ? "UPDATING…" : "UPDATE"}
          </button>
          <button class="update-banner-dismiss" onClick={() => setDismissed(true)} disabled={working()} title="Dismiss">
            ✕
          </button>
        </span>
      </div>
    </Show>
  );
}
