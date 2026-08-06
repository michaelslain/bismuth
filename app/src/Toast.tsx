// app/src/Toast.tsx
// The JSX host: renders the live toast stack. Pure state + actions (pushToast/updateToast/
// dismissToast/toasts) live in ./toastStore, re-exported here so every existing `from "./Toast"`
// import keeps working unchanged — see toastStore.ts's header comment for why the split exists.
import { For } from "solid-js";
import { TextButton } from "./ui/TextButton";
import "./Toast.css";
import { toasts, dismissToast, pushToast, updateToast, type Toast } from "./toastStore";

export type { Toast };
export { pushToast, updateToast, dismissToast, toasts };

/** Fixed bottom-center stack of toasts. Mount once near the app root. */
export function ToastHost() {
  return (
    <div class="toast-host">
      <For each={toasts()}>
        {(t) => (
          <div class="toast-pill">
            <span>{t.message}</span>
            {t.action && (
              <TextButton
                size="sm"
                onClick={() => {
                  t.action!.onClick();
                  dismissToast(t.id);
                }}
              >
                {t.action.label.toUpperCase()}
              </TextButton>
            )}
          </div>
        )}
      </For>
    </div>
  );
}
