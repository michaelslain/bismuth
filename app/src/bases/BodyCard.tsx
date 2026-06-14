import { createSignal, createMemo, Show, onMount, onCleanup } from "solid-js";
import { Portal } from "solid-js/web";
import type { ViewResult, BaseConfig, Row } from "../../../core/src/bases/types";
import { api } from "../api";
import { onServerChange } from "../serverVersion";
import { renderValue } from "./renderValue";
import { readNoteCached, primeNoteCache, peekNoteCache } from "../noteCache";
import { ContextMenu, type MenuItem } from "../ContextMenu";
import { buildTaskCardParts } from "./taskCardMarkup";
import { taskStatusItems } from "../taskStatusMenu";
import styles from "./BaseView.module.css";

/**
 * A Google-Keep-style preview card: the note's body rendered as real markdown
 * (`renderNoteBody` — standard renderer + Obsidian `[[wikilinks]]`), with resolved tasks
 * (done/cancelled) hidden behind a "N completed" expander. Every checkbox task line renders a
 * status-bearing `.oa-task-box` marker (`taskCardMarkup.ts`): left-click toggles it, right-click
 * opens a status menu. Links open the note. Cards take their natural height; the grid
 * (`.bodyGrid`) lays them out as a masonry so a short note stays short.
 */
// "N completed" expanded-state per note path, kept at module scope so it survives a BodyCard
// re-mount (BaseView re-resolving rows recreates the cards) — otherwise the section silently
// collapses whenever the view revalidates.
const doneExpanded = new Map<string, boolean>();

export function BodyCard(props: { row: Row; result: ViewResult; config: BaseConfig; mode?: "body" | "tasks" }) {
  // Seed from the note-body cache so a re-mount (e.g. BaseView re-resolving rows after an
  // unrelated vault write) paints instantly from cache instead of flashing "Loading…" —
  // that flash is what reads as the card "reloading over and over" under daemon churn.
  const cached = peekNoteCache(props.row.file.path);
  const [content, setContent] = createSignal<string>(cached ?? "");
  const [loaded, setLoaded] = createSignal(cached !== undefined);
  const [showDone, setShowDone] = createSignal(doneExpanded.get(props.row.file.path) ?? false);
  const toggleDone = () => {
    const v = !showDone();
    setShowDone(v);
    doneExpanded.set(props.row.file.path, v);
  };
  const [menu, setMenu] = createSignal<{ x: number; y: number; items: MenuItem[] } | null>(null);

  // Re-read the note after a write so the card repaints the new status; keep the cache current
  // so a re-mount paints the toggled state.
  async function refreshFromDisk() {
    const t = await api.read(props.row.file.path);
    primeNoteCache(props.row.file.path, t);
    setContent(t);
  }

  onMount(async () => {
    try {
      const r = readNoteCached(props.row.file.path);
      setContent(typeof r === "string" ? r : await r);
    } catch {
      if (!loaded()) setContent("");
    } finally {
      setLoaded(true);
    }
  });

  // Keep the card's body fresh when its note changes on disk from ANYWHERE — edited in another
  // pane, a task toggled in a different view, an external sync — by re-reading in place. With
  // the row-identity reconcile (reconcileRows.ts), a body-only edit no longer remounts the card
  // (its row keeps identity), so without this the card would show a stale body. Re-reading here
  // also primes the note cache, so any remount that DOES happen paints instantly instead of
  // flashing "Loading…". Mirrors noteCache's eviction rule: targeted paths, or all on an
  // unknown-extent change (empty paths = a dropped-SSE poll catch-up).
  const off = onServerChange((c) => {
    if (c.paths.length === 0 || c.paths.includes(props.row.file.path)) void refreshFromDisk();
  });
  onCleanup(off);

  const firstCol = () => props.result.columns[0] ?? "file.name";

  const parts = createMemo(() => buildTaskCardParts(content(), props.mode));

  // The clicked task marker, or null when the event didn't land on one. The todo box char is
  // a space, but DOMPurify strips whitespace-only attribute values (`data-status=" "` → `""`),
  // so normalize an empty/blank status back to " " (todo) — otherwise "To do" never matches the
  // current status and so isn't filtered out of the menu.
  const markerAt = (e: MouseEvent): { line: number; status: string } | null => {
    const box = (e.target as HTMLElement).closest(".oa-task-box") as HTMLElement | null;
    if (!box) return null;
    const line = Number(box.dataset.line);
    if (!Number.isInteger(line)) return null;
    const raw = box.dataset.status ?? "";
    return { line, status: raw.trim() === "" ? " " : raw };
  };

  // Delegated click: a task marker toggles its source line; a link opens the note (the
  // standard `oa-open` nav) or external URL.
  async function onCardClick(e: MouseEvent) {
    const marker = markerAt(e);
    if (marker) {
      e.preventDefault();
      try {
        await api.toggleTask(props.row.file.path, marker.line);
        await refreshFromDisk();
      } catch { /* best-effort: leave the card as-is on failure */ }
      return;
    }
    const target = e.target as HTMLElement;
    const a = target.closest("a") as HTMLAnchorElement | null;
    if (!a) return;
    const wl = a.getAttribute("data-href");
    if (wl) {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent("oa-open", { detail: wl }));
      return;
    }
    const href = a.getAttribute("href");
    if (!href || href === "#") return;
    e.preventDefault();
    if (/^https?:\/\//.test(href)) window.open(href, "_blank", "noopener");
    else window.dispatchEvent(new CustomEvent("oa-open", { detail: href.endsWith(".md") ? href : `${href}.md` }));
  }

  // Right-click a task marker -> offer every status EXCEPT the current one (a no-current-mode
  // menu, per the spec). Reads the source line + current status straight off the marker, so it
  // works for any status ([ ]/[x]/[/]/[-]) in both body and tasks card modes.
  function onCardContextMenu(e: MouseEvent) {
    const marker = markerAt(e);
    if (!marker) return; // not a task marker — let the pane's own context menu handle it
    e.preventDefault();
    e.stopPropagation(); // don't also open the pane's "close pane" context menu underneath
    const items: MenuItem[] = taskStatusItems(marker.status, (char) => {
      void (async () => {
        try {
          await api.toggleTask(props.row.file.path, marker.line, char);
          await refreshFromDisk();
        } catch { /* best-effort */ }
      })();
    });
    setMenu({ x: e.clientX, y: e.clientY, items });
  }

  return (
    <div class={styles.bodyCard}>
      <div class={styles.cardTitle}>{renderValue(firstCol(), props.row)}</div>
      <Show when={loaded()} fallback={<div class={styles.cardKey}>Loading…</div>}>
        <div
          class={styles.cardMd}
          onClick={(e) => void onCardClick(e)}
          onContextMenu={(e) => onCardContextMenu(e)}
          innerHTML={parts().openHtml}
        />
        <Show when={parts().doneCount > 0}>
          <button class={styles.doneToggle} onClick={toggleDone}>
            {showDone() ? "▾" : "▸"} {parts().doneCount} completed
          </button>
          <Show when={showDone()}>
            <div
              class={`${styles.cardMd} ${styles.cardMdDone}`}
              onClick={(e) => void onCardClick(e)}
              onContextMenu={(e) => onCardContextMenu(e)}
              innerHTML={parts().doneHtml}
            />
          </Show>
        </Show>
      </Show>
      <Show when={menu()}>
        {(m) => (
          // Portal to <body> so the fixed-position menu escapes the card's masonry
          // (`.bodyGrid { column-count }`) + overflow — otherwise it's clipped/mis-placed,
          // the same reason EventChip portals its ContextMenu.
          <Portal>
            <ContextMenu x={m().x} y={m().y} items={m().items} onClose={() => setMenu(null)} />
          </Portal>
        )}
      </Show>
    </div>
  );
}
