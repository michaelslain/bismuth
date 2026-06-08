import { Show } from "solid-js";
import { resolveProperty } from "../../../core/src/bases/query";
import type { Row, BaseConfig } from "../../../core/src/bases/types";
import { renderTitle, isStatusColumn, isRatingColumn, bareName } from "./renderValue";
import { Stars } from "../ui/Stars";
import { StatusText } from "../ui/StatusDot";
import styles from "./BaseView.module.css";

/** Heuristic: which column is a page count (rendered as "N pages" on the right). */
function isPagesColumn(id: string): boolean {
  const n = bareName(id);
  return n === "pages" || n === "pagecount" || n === "page_count";
}

function findColumn(cols: string[], pred: (id: string) => boolean): string | undefined {
  return cols.find(pred);
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/**
 * Compact book-card body matching the design's Cards/Kanban layout: a serif title
 * (the cover already carries it on Cards, so `titleAsField` suppresses it), a faint
 * author line, then a single meta row — status word on the LEFT, star rating (or a
 * "N pages" count) on the RIGHT. Replaces the old label:value field dump.
 *
 * Used by CardsView (`titleAsField` — cover shows title/author) and KanbanView
 * (stacks its own title + author). Status/rating/pages columns are detected from
 * `cols`; title = first column, author = next non-status/rating/pages column.
 */
export function CardBody(props: { cols: string[]; row: Row; config: BaseConfig; titleAsField?: boolean; plainTitle?: boolean }) {
  const titleCol = (): string => props.cols[0] ?? "file.name";

  // Plain (non-link) title text — used when the whole card is already a click target
  // (CardsView), so the title isn't a competing inner link.
  const titleText = (): string => {
    const v = resolveProperty(titleCol(), props.row);
    return v == null || typeof v === "object" ? props.row.file.name : String(v);
  };

  const statusCol = (): string | undefined => findColumn(props.cols, isStatusColumn);
  const ratingCol = (): string | undefined => findColumn(props.cols, isRatingColumn);
  const pagesCol = (): string | undefined => findColumn(props.cols, isPagesColumn);

  // Author = first column that isn't the title or one of the meta columns.
  const authorCol = (): string | undefined =>
    props.cols.find(
      (c, i) =>
        (props.titleAsField || i !== 0) &&
        !isStatusColumn(c) &&
        !isRatingColumn(c) &&
        !isPagesColumn(c),
    );

  const status = (): string | null => {
    const c = statusCol();
    if (!c) return null;
    const v = resolveProperty(c, props.row);
    return v == null || typeof v === "object" ? null : String(v);
  };

  const rating = (): number | null => {
    const c = ratingCol();
    if (!c) return null;
    const n = asNumber(resolveProperty(c, props.row));
    return n != null && n > 0 ? n : null;
  };

  const pages = (): number | null => {
    const c = pagesCol();
    if (!c) return null;
    return asNumber(resolveProperty(c, props.row));
  };

  const author = (): string | null => {
    const c = authorCol();
    if (!c) return null;
    const v = resolveProperty(c, props.row);
    return v == null || typeof v === "object" ? null : String(v);
  };

  // The right-hand meta: stars when there's a rating, otherwise a page count.
  const hasMeta = (): boolean => status() != null || rating() != null || pages() != null;

  return (
    <>
      {/* Cards already shows the title on the cover; Kanban stacks its own. */}
      <Show when={!props.titleAsField}>
        <div class={styles.cardTitle}>{props.plainTitle ? titleText() : renderTitle(titleCol(), props.row)}</div>
      </Show>
      {/* Cards shows the author on the cover; Kanban stacks its own faint line. */}
      <Show when={!props.titleAsField && author()}>
        <div class={styles.cardAuthor}>{author()}</div>
      </Show>
      <Show when={hasMeta()}>
        <div class={styles.cardMeta}>
          <span class={styles.cardMetaLeft}>
            <Show when={status()}>{(s) => <StatusText status={s()} />}</Show>
          </span>
          <span class={styles.cardMetaRight}>
            <Show when={rating()} fallback={<Show when={pages()}>{(p) => <span class={styles.cardPages}>{p()} pages</span>}</Show>}>
              {(r) => <Stars value={r()} />}
            </Show>
          </span>
        </div>
      </Show>
    </>
  );
}
