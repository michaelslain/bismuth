// app/src/Toast.tsx
import { createSignal, For } from "solid-js";
import { TextButton } from "./ui/TextButton";
import "./Toast.css";

export type Toast = {
  id: number;
  message: string;
  action?: { label: string; onClick: () => void };
};

const [toasts, setToasts] = createSignal<Toast[]>([]);
let nextId = 1;
// Auto-dismiss timer handles, keyed by toast id, so an early dismiss (action
// click / external dismiss) can cancel the pending timeout instead of leaking it.
const timers = new Map<number, ReturnType<typeof setTimeout>>();

/** Add a toast; auto-dismisses after `ttl` ms. Returns its id so callers can replace/dismiss it. */
export function pushToast(message: string, action?: Toast["action"], ttl = 5000): number {
  const id = nextId++;
  setToasts((prev) => [...prev, { id, message, action }]);
  timers.set(id, setTimeout(() => dismissToast(id), ttl));
  return id;
}

/** Replace a live toast's message in place (e.g. progress updates). No-op if it's gone.
 *  Replaces the toast object so the keyed <For> re-renders the row; there's no enter
 *  animation (Toast.css is static), so the text just swaps with no flicker. */
export function updateToast(id: number, message: string) {
  setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, message } : t)));
}

export function dismissToast(id: number) {
  const timer = timers.get(id);
  if (timer !== undefined) {
    clearTimeout(timer);
    timers.delete(id);
  }
  setToasts((prev) => prev.filter((t) => t.id !== id));
}

export { toasts };

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
