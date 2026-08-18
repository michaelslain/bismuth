// app/src/shell/TabRail.tsx
// The app's ONLY tab presentation — a right-edge vertical rail. Collapsed (48px) it shows just the
// action toolbar + tab icons; expanded (232px, via :hover / :focus-within) it widens leftward over
// the editor without reflowing it. Lifted out of App.tsx verbatim.
//
// CLASS NAMES ARE STILL BARE GLOBAL STRING LITERALS — this is the extraction half of the migration
// only (see the plan's THE RECIPE).
//
// SHARES `TabRail.module.css` WITH `TabRailRow.tsx` — do not give TabRailRow its own module once
// the CSS half lands. Hashes are per-file, and eight hover/focus selectors span both components
// (`.tab-rail:hover .tab-rail-label`, `.tab-rail:focus-within .tab-rail-row.pinned .tab-pin`, …);
// splitting the module would silently break every one of them behind a green build (Trap 4).
//
// `data-tabstrip="vertical"` is a real attribute `dnd/viewDrag.ts:92` reads via
// `closest('[data-tabstrip="vertical"]')` — an ATTRIBUTE selector, not a class, so it is untouched
// by this migration either half.
import type { JSX } from 'solid-js'

export function TabRail(props: {
    actions: JSX.Element
    children: JSX.Element
}) {
    return (
        <div class="tab-rail">
            <div class="tab-rail-inner">
                <div class="tab-rail-actions">{props.actions}</div>
                <div class="tab-rail-list" data-tabstrip="vertical">
                    {props.children}
                </div>
            </div>
        </div>
    )
}
