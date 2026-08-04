// Reusable Storybook harness that mounts a MINIMAL CodeMirror 6 `EditorView` and hands the live
// instance back to the caller. NOT a story file itself — the `*.stories.*` glob (see
// `.storybook/main.ts`) skips underscore-prefixed files, same convention as `_storyKit.tsx` /
// `_fakeTransport.ts` / `_baseFixtures.ts`.
//
// Why this exists: several components take a live `EditorView` as a prop rather than owning one
// themselves — e.g. `editor/ink/InkOverlay.tsx`'s `view: () => EditorView | undefined`, which
// reads `view().contentDOM` for its paint geometry and has no standalone render path (it renders
// nothing without a real CM view to sit on top of). A story for one of those components needs
// *some* EditorView to hand it, but pulling in the full `Editor.tsx` note surface (autosave,
// wikilink/tag completion, Harper, KaTeX, the table/embed/query extensions, …) just to get a
// view would coufple that story to the entire note-editing stack. This harness is the
// intentionally bare alternative: history + selection drawing + the default/history keymap +
// line wrapping, nothing note-specific (no vault facets, no autocomplete, no autosave). Layer on
// more via `extensions` when a story needs a specific CM feature (e.g. `markdown()`).
//
// Deliberately independent of `Editor.tsx` — no shared imports, no vault/API coupling — so it can
// host a bare editor for ANY story that needs one, not just note-editing ones.
import { onCleanup, onMount, createSignal, type Accessor, type JSX } from "solid-js";
import { EditorView, keymap, drawSelection } from "@codemirror/view";
import { EditorState, type Extension } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";

// Bare-bones legibility against the app's real theme tokens (injected by `.storybook/preview.ts`)
// — no note-editor chrome (no gutter, no prose column, no autocomplete popup styling).
const harnessTheme = EditorView.theme({
  "&": { backgroundColor: "var(--editor, var(--bg))", color: "var(--fg)", height: "100%" },
  ".cm-scroller": { fontFamily: "var(--editor-font)", fontSize: "var(--editor-font-size, 15px)", overflow: "auto" },
  ".cm-content": { caretColor: "var(--fg)", padding: "8px 0" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--fg)", borderLeftWidth: "2px" },
  ".cm-content ::selection": { backgroundColor: "color-mix(in srgb, var(--accent) 30%, transparent)" },
});

export interface CmHarnessProps {
  /** Initial document text. Defaults to "". Not reactive — the view is created once on mount
   *  (mirrors how `Editor.tsx` seeds a fresh `EditorState` per buffer rather than diffing props). */
  doc?: string;
  /** Extra CM6 extensions layered on top of the minimal base (history/selection/keymap/line
   *  wrapping/theme). Append `markdown()`, a language, a facet a widget under test reads, etc. */
  extensions?: Extension[];
  /** Inline style for the wrapping host div (position:relative, so an absolutely-positioned
   *  overlay — e.g. `<InkOverlay>` — can be rendered as a `children` sibling and fill it via
   *  `inset:0`). Default: fills available space; give the STORY a sized ancestor. */
  style?: JSX.CSSProperties;
  /** Render-prop receiving the live view accessor: `undefined` before mount and after unmount,
   *  the real `EditorView` in between. Use this to pass the view into a component under test,
   *  e.g. `<CmHarness>{(view) => <InkOverlay view={view} .../>}</CmHarness>`. */
  children?: (view: Accessor<EditorView | undefined>) => JSX.Element;
}

/**
 * Mount a minimal CodeMirror 6 `EditorView` for a story and expose it as a Solid accessor.
 *
 * Signature: `CmHarness(props: CmHarnessProps): JSX.Element`, where
 * `CmHarnessProps = { doc?: string; extensions?: Extension[]; style?: JSX.CSSProperties;
 * children?: (view: Accessor<EditorView | undefined>) => JSX.Element }`.
 *
 * Renders a wrapper div (position:relative) containing the CM scroller (fills the wrapper) and
 * then `props.children?.(view)` as a sibling — `children` is called with the view
 * accessor so a render-prop consumer sits as an absolutely-positioned sibling over it, the same
 * wrapper/host/overlay shape `Editor.tsx` uses for `InkOverlay`. The view is created in `onMount`
 * and destroyed in `onCleanup`; `doc`/`extensions` are read once at construction (not reactive).
 */
export function CmHarness(props: CmHarnessProps): JSX.Element {
  let host!: HTMLDivElement;
  const [view, setView] = createSignal<EditorView | undefined>(undefined);

  onMount(() => {
    const v = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: props.doc ?? "",
        extensions: [
          history(),
          drawSelection(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          harnessTheme,
          ...(props.extensions ?? []),
        ],
      }),
    });
    setView(v);
    onCleanup(() => {
      v.destroy();
      setView(undefined);
    });
  });

  return (
    <div style={{ position: "relative", height: "100%", width: "100%", overflow: "hidden", ...props.style }}>
      <div ref={host} style={{ height: "100%", overflow: "auto" }} />
      {props.children?.(view)}
    </div>
  );
}
