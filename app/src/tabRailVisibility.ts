// app/src/tabRailVisibility.ts
// Pure visibility predicate for the vertical tab rail (`ui.verticalTabs`, App.tsx's `.tab-rail`).
//
// BUG #40: the Cmd+O quick switcher (`switcherOpen()` in App.tsx) is a full-window search takeover —
// a graph backdrop + big top search bar that already hides the LEFT file-tree sidebar via the
// `.layout.sidebar-hidden` class (`!sidebarVisible() || switcherOpen()`). The right-edge vertical tab
// rail never followed that same condition: it was shown purely on `settings.ui.verticalTabs`, so with
// vertical tabs enabled, opening the switcher left the tab rail floating on top of the takeover while
// the file tree correctly disappeared — the asymmetry the user reported. `tabRailVisible` is the one
// place both App.tsx's `<Show>` (which mount/unmounts the rail) and its CSS column-collapse
// (`.switcher-active`, App.css) key off, so they can never drift out of sync again.
export function tabRailVisible(opts: { verticalTabs: boolean; switcherOpen: boolean }): boolean {
  return opts.verticalTabs && !opts.switcherOpen;
}
