// app/src/tabRailVisibility.ts
// Pure visibility predicate for the tab rail (App.tsx's `.tab-rail`) — the app's only tab
// presentation since the horizontal strip and its `ui.verticalTabs` opt-out were removed.
//
// BUG #40: the Cmd+O quick switcher is a full-window search TAKEOVER. It already hides the file-tree
// sidebar (`sidebar-hidden`), but the rail used to keep floating over the takeover instead of hiding
// with it. The grid column collapses to 0 in lockstep via `.layout.switcher-active` (App.css).
export function tabRailVisible(opts: { switcherOpen: boolean }): boolean {
  return !opts.switcherOpen;
}
