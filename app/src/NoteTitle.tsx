// app/src/NoteTitle.tsx
// Inline, display-only note title rendered as a `# <title>` heading at the very
// top of a `.md` editor. The title is a pure function of the file path (see
// noteTitle.ts) and is NEVER written into the markdown body. Editing it and
// committing (Enter or blur) renames the file, reusing the same flow the file
// tree uses: dispatch an `oa-moved` event (App.tsx retargets open tabs) and
// call `api.move`. On failure / empty / unchanged the field reverts.
//
// The `#` glyph lives in its own DOM node, separate from the editable input, so
// select-all + delete or repeated backspace inside the field can never remove
// it — the title text is the only thing the user can edit.
import { createMemo, createSignal, createEffect } from "solid-js";
import { api } from "./api";
import { pushToast } from "./Toast";
import { deriveTitle, renamedPath } from "./noteTitleOps";
import "./NoteTitle.css";

export function NoteTitle(props: { path: string }) {
  let inputRef: HTMLTextAreaElement | undefined;
  // Title is derived from the path; re-derives automatically when the path
  // changes (e.g. renamed from the file tree).
  const title = createMemo(() => deriveTitle(props.path));

  // Long titles must wrap onto multiple lines instead of being clipped, so the
  // field is a <textarea> whose height auto-grows to fit its content. Reset to
  // `auto` first so it can also shrink when the title gets shorter.
  const autosize = () => {
    if (!inputRef) return;
    inputRef.style.height = "auto";
    inputRef.style.height = `${inputRef.scrollHeight}px`;
  };

  // Local edit buffer. Kept in sync with the derived title whenever the path
  // (and thus the title) changes, so an external rename is reflected here too.
  const [draft, setDraft] = createSignal(title());
  createEffect(() => { draft(); autosize(); });
  createEffect(() => setDraft(title()));

  // setEditing-style guard: blur fires after Enter (which blurs the input), so
  // without this the rename would run twice. Reset whenever the title changes.
  let done = false;
  createEffect(() => { title(); done = false; });

  // The `#` glyph shows only while the title field is focused (clicked into) —
  // mirroring how body-heading `#`s reveal only on the cursor line.
  const [focused, setFocused] = createSignal(false);

  const revert = () => { setDraft(title()); if (inputRef) inputRef.value = title(); };

  const commit = async () => {
    if (done) return;
    done = true;
    const from = props.path;
    const to = renamedPath(from, draft()); // null = empty/whitespace/unchanged
    if (!to) { revert(); return; }
    // Reuse the file-tree rename flow: retarget open tabs immediately, then
    // persist. On failure, revert the field and surface the error like the tree.
    window.dispatchEvent(new CustomEvent("oa-moved", { detail: { from, to } }));
    try {
      await api.move(from, to);
    } catch (e) {
      revert();
      pushToast(`Rename failed: ${(e as Error).message}`);
    }
  };

  return (
    <div class="note-title" classList={{ focused: focused() }}>
      {/* Non-editable heading glyph — separate DOM from the field. Hidden until
          the field is focused (see CSS), then revealed in mono accent. */}
      <span class="note-title-hash" aria-hidden="true">#</span>
      <textarea
        ref={(el) => (inputRef = el)}
        class="note-title-input"
        rows={1}
        value={draft()}
        spellcheck={false}
        onInput={(e) => setDraft(e.currentTarget.value)}
        onFocus={() => setFocused(true)}
        onKeyDown={(e) => {
          // Enter commits (renames) rather than inserting a newline — the title
          // is a single logical string that merely wraps visually.
          if (e.key === "Enter") { e.preventDefault(); inputRef?.blur(); } // commit via blur
          else if (e.key === "Escape") { revert(); inputRef?.blur(); }
        }}
        onBlur={() => { setFocused(false); commit(); }}
      />
    </div>
  );
}
