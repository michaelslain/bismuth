// app/src/editor/CodeHeader.tsx
//
// The header shown in place of a code block's opening ```lang fence when the
// cursor is outside the block: a dim language label on the left and an icon-only
// copy button (Lucide) on the right that fires a toast on success.
import { Icon } from "../icons/Icon";
import { pushToast } from "../Toast";

export function CodeHeader(props: { lang: string; body: string }) {
  const copy = (e: MouseEvent) => {
    // Don't let the click move the editor selection or reveal the raw fence.
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard
      ?.writeText(props.body)
      .then(() => pushToast("Copied to clipboard"))
      .catch(() => {});
  };

  return (
    <div class="cm-code-header">
      <span class="cm-code-lang">{props.lang || "text"}</span>
      <button class="cm-code-copy" type="button" title="Copy code" aria-label="Copy code" onMouseDown={(e) => e.preventDefault()} onClick={copy}>
        <Icon value="Copy" size={14} />
      </button>
    </div>
  );
}
