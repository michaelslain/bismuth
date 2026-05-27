// app/src/ContextMenu.tsx
import { For, onCleanup, onMount } from "solid-js";

export type MenuItem = { label: string; onSelect: () => void; danger?: boolean };

/** A cursor-positioned action menu. Closes on outside-click, Escape, or after an item is chosen. */
export function ContextMenu(props: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const onDocClick = () => props.onClose();
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") props.onClose();
  };
  onMount(() => {
    // Defer so the click that opened the menu doesn't immediately close it.
    setTimeout(() => document.addEventListener("click", onDocClick), 0);
    document.addEventListener("keydown", onKey);
  });
  onCleanup(() => {
    document.removeEventListener("click", onDocClick);
    document.removeEventListener("keydown", onKey);
  });

  return (
    <div
      style={{
        position: "fixed",
        top: `${props.y}px`,
        left: `${props.x}px`,
        "z-index": 1000,
        background: "var(--bg)",
        border: "1px solid var(--border)",
        "border-radius": "6px",
        padding: "4px",
        "min-width": "150px",
        "box-shadow": "0 4px 16px rgba(0,0,0,0.3)",
        "font-size": "13px",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <For each={props.items}>
        {(item) => (
          <div
            style={{
              padding: "5px 10px",
              cursor: "pointer",
              "border-radius": "4px",
              color: item.danger ? "#e5534b" : "var(--fg)",
              "user-select": "none",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--accent)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            onClick={() => {
              item.onSelect();
              props.onClose();
            }}
          >
            {item.label}
          </div>
        )}
      </For>
    </div>
  );
}
