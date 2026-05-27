// app/src/Toast.tsx
import { createSignal, For } from "solid-js";

export type Toast = {
  id: number;
  message: string;
  action?: { label: string; onClick: () => void };
};

const [toasts, setToasts] = createSignal<Toast[]>([]);
let nextId = 1;

/** Add a toast; auto-dismisses after `ttl` ms. Returns its id so callers can replace/dismiss it. */
export function pushToast(message: string, action?: Toast["action"], ttl = 5000): number {
  const id = nextId++;
  setToasts((prev) => [...prev, { id, message, action }]);
  setTimeout(() => dismissToast(id), ttl);
  return id;
}

export function dismissToast(id: number) {
  setToasts((prev) => prev.filter((t) => t.id !== id));
}

export { toasts };

/** Fixed bottom-center stack of toasts. Mount once near the app root. */
export function ToastHost() {
  return (
    <div
      style={{
        position: "fixed",
        bottom: "16px",
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        "flex-direction": "column",
        gap: "8px",
        "z-index": 2000,
        "align-items": "center",
      }}
    >
      <For each={toasts()}>
        {(t) => (
          <div
            style={{
              background: "var(--panel)",
              border: "1px solid var(--border)",
              "border-radius": "8px",
              padding: "8px 14px",
              "box-shadow": "0 4px 16px rgba(0,0,0,0.3)",
              "font-size": "13px",
              color: "var(--fg)",
              display: "flex",
              "align-items": "center",
              gap: "12px",
            }}
          >
            <span>{t.message}</span>
            {t.action && (
              <button
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--accent)",
                  cursor: "pointer",
                  "font-weight": "600",
                  padding: 0,
                }}
                onClick={() => {
                  t.action!.onClick();
                  dismissToast(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        )}
      </For>
    </div>
  );
}
