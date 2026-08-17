// The typed `[-] [+] [x]` titlebar buttons, lifted out of App.tsx verbatim.
//
// CLASS NAMES ARE STILL GLOBAL App.css LITERALS ON PURPOSE. This is the extraction half of a
// two-commit move: `bench/cssBaseline.ts` compares a story against its OWN earlier recording, so
// WindowControls.stories.tsx has to be recorded while `.win-controls` / `.win-btn` still resolve
// through App.css. Only then does a second commit that moves those rules into
// WindowControls.module.css (hashing every name) have something to be measured against. Writing the
// story after the CSS moved would bless whatever it happened to render, broken included.
//
// WHAT DELIBERATELY STAYED IN App.tsx: the `<Show when={isTauri() && !IS_MAC_PLATFORM}>` gate and
// the three dynamic `@tauri-apps/api/window` calls behind these props. Those are platform
// integration, not chrome — and keeping them out here is what lets the component mount in Storybook
// with no Tauri runtime present. macOS runs a transparent Overlay titlebar with native traffic
// lights instead, so on that platform these buttons never render at all.
export function WindowControls(props: {
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
}) {
  return (
    <div class="win-controls">
      <button type="button" class="win-btn" title="Minimize" onClick={props.onMinimize}>[-]</button>
      <button type="button" class="win-btn" title="Maximize" onClick={props.onToggleMaximize}>[+]</button>
      <button type="button" class="win-btn win-btn--close" title="Close" onClick={props.onClose}>[x]</button>
    </div>
  );
}
