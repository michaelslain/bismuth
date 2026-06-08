import { For, Show } from "solid-js";
import type { ViewResult, BaseConfig, Row } from "../../../core/src/bases/types";
import { resolveProperty } from "../../../core/src/bases/query";
import { api } from "../api";
import { BodyCard } from "./BodyCard";
import { CardBody } from "./CardBody";
import styles from "./BaseView.module.css";

/** A value is already a usable image src (remote URL or inline data) vs a vault path. */
function isDirectUrl(s: string): boolean {
  return /^(https?:|data:|blob:)/i.test(s);
}

export function CardsView(props: { result: ViewResult; config: BaseConfig }) {
  const cols = () => props.result.columns;
  const isBody = () => props.result.view.cardContent === "body";
  // Title = first column; author = second column (used for the generated text cover).
  const titleCol = (): string => cols()[0] ?? "file.name";
  const authorCol = (): string | undefined => cols()[1];

  // Cover image config: which property holds the cover, plus fit/aspect-ratio.
  const imageProp = (): string | undefined => props.result.view.image;
  const imageFit = (): "cover" | "contain" => props.result.view.imageFit ?? "cover";
  const aspectRatio = (): number => props.result.view.imageAspectRatio ?? 0.667;

  // The cover src for a row, or null when no image is configured / the property is empty.
  // A bare value (e.g. "covers/x.jpg") is served through the vault asset endpoint; a full
  // URL (Google Books, data:) is used as-is.
  const coverUrl = (row: Row): string | null => {
    const prop = imageProp();
    if (!prop) return null;
    const v = resolveProperty(prop, row);
    if (v == null || typeof v === "object") return null;
    const s = String(v).trim();
    if (!s) return null;
    return isDirectUrl(s) ? s : api.assetUrl(s);
  };

  const coverTitle = (row: Row): string => {
    const v = resolveProperty(titleCol(), row);
    return v == null ? row.file.name : String(v);
  };
  const coverAuthor = (row: Row): string | null => {
    if (!authorCol()) return null;
    const v = resolveProperty(authorCol()!, row);
    return v == null || typeof v === "object" ? null : String(v);
  };

  // Click anywhere on a (non-body) card opens its note in a NEW tab.
  const openCard = (row: Row) =>
    window.dispatchEvent(new CustomEvent("oa-open", { detail: { path: row.file.path, newTab: true } }));

  return (
    <div class={styles.cards}>
      <For each={props.result.groups}>
        {(group) => (
          <>
            <Show when={group.key !== ""}>
              <div class={styles.groupHeader}>{group.key}</div>
            </Show>
            <div class={isBody() ? styles.bodyGrid : styles.cardGrid}>
              <For each={group.rows}>
                {(row) => (
                  <Show
                    when={isBody()}
                    fallback={
                      <div
                        class={styles.card}
                        role="button"
                        tabindex={0}
                        onClick={() => openCard(row)}
                        onKeyDown={(e) => { if (e.key === "Enter") openCard(row); }}
                      >
                        {/* An image cover (when configured + present) replaces the generated
                            text cover; title/author then move into the body below. A row whose
                            cover property is empty falls back to the text cover. */}
                        <Show
                          when={coverUrl(row)}
                          fallback={
                            <div class={styles.cardCover}>
                              <div class={styles.coverTitle}>{coverTitle(row)}</div>
                              <Show when={coverAuthor(row)}>
                                <div class={styles.coverAuthor}>{coverAuthor(row)}</div>
                              </Show>
                            </div>
                          }
                        >
                          {(url) => (
                            <div
                              class={styles.cardCoverImg}
                              style={{ "aspect-ratio": String(aspectRatio()) }}
                            >
                              <img
                                src={url()}
                                alt={coverTitle(row)}
                                loading="lazy"
                                style={{ "object-fit": imageFit() }}
                                onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
                              />
                            </div>
                          )}
                        </Show>
                        <div class={styles.cardBodyInner}>
                          {/* With an image cover the title/author aren't on the cover, so show
                              them as fields; with the text cover they already appear there. */}
                          <CardBody cols={cols()} row={row} config={props.config} titleAsField={!coverUrl(row)} plainTitle />
                        </div>
                      </div>
                    }
                  >
                    <BodyCard row={row} result={props.result} config={props.config} />
                  </Show>
                )}
              </For>
            </div>
          </>
        )}
      </For>
    </div>
  );
}
