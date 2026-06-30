// app/src/ui/popover/rowDom.ts
// Vanilla-DOM builders for the popover row, for the IMPERATIVE surfaces that
// cannot mount the Solid <MenuRow> — i.e. anything living inside CodeMirror's
// own DOM (the autocomplete list and the yaml-fix hover tooltip). They emit the
// EXACT same `.bismuth-popover-row` / `.bismuth-popover-icon` / `.bismuth-popover-label` markup
// the Solid component does, so all three surfaces read one stylesheet and stay
// pixel-identical. The Lucide icon is loaded lazily (dynamic import) so importing
// these helpers in a test env — no DOM, no Solid client — never trips lucide-solid.

/** A `.bismuth-popover-icon` span whose Lucide SVG fills in once the chunk resolves. */
export function createPopoverIcon(name: string, size = 14): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = "bismuth-popover-icon";
  import("../../icons/iconMarkup")
    .then(({ lucideIconMarkup }) => {
      const markup = lucideIconMarkup(name, size);
      if (markup) span.innerHTML = markup;
    })
    .catch(() => {}); // chunk-load failure → degrade to an icon-less row
  return span;
}

/** A full `.bismuth-popover-row` element. `onSelect` omitted ⇒ a disabled (non-clickable)
 *  row. Click is wired on mousedown+preventDefault so applying it never steals editor
 *  focus, and hover toggles the shared selected class. */
export function createPopoverRow(opts: {
  label: string;
  icon?: string;
  onSelect?: () => void;
}): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "bismuth-popover-row" + (opts.onSelect ? "" : " bismuth-popover-row--disabled");

  if (opts.icon) row.appendChild(createPopoverIcon(opts.icon));

  const lbl = document.createElement("span");
  lbl.className = "bismuth-popover-label";
  lbl.textContent = opts.label;
  row.appendChild(lbl);

  if (opts.onSelect) {
    row.addEventListener("mousedown", (e) => { e.preventDefault(); opts.onSelect!(); });
    row.addEventListener("mouseenter", () => row.classList.add("bismuth-popover-row--selected"));
    row.addEventListener("mouseleave", () => row.classList.remove("bismuth-popover-row--selected"));
  }
  return row;
}
