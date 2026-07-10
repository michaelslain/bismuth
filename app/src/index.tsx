/* @refresh reload */
import { render } from "solid-js/web";
import { lazy } from "solid-js";
// KaTeX CSS is now loaded lazily alongside the katex JS chunk (see editor/katexLoader.ts),
// so it no longer ships in the entry bundle.
// default fonts: Lora (prose) + Monaspace Xenon (monospace)
import "@fontsource/lora/400.css";
import "@fontsource/lora/700.css";
import "@fontsource/lora/400-italic.css";
import "@fontsource/monaspace-xenon/400.css";
import "@fontsource/monaspace-xenon/700.css";
import { isTauri } from "./nativeMenu";

// First-run takeover: when the bundled app launches with no vault yet, lib.rs injects
// `window.__BISMUTH_FIRST_RUN__` and does NOT start a backend — so we render the intro instead
// of App (which would fire API calls against a backend that isn't there). `?intro=1` forces
// it in dev/browser for previewing. The two branches are code-split so first-run never
// loads App, and a normal launch never loads the intro.
const firstRun =
  (isTauri() && (window as unknown as { __BISMUTH_FIRST_RUN__?: boolean }).__BISMUTH_FIRST_RUN__ === true) ||
  new URLSearchParams(window.location.search).has("intro");

const Root = lazy(() => (firstRun ? import("./intro/VaultIntro") : import("./App")));

render(() => <Root />, document.getElementById("root") as HTMLElement);

// First run renders the intro takeover instead of App, so App's boot-ready signal (which dismisses
// the index.html splash) never fires. The intro is its own full-screen themed takeover, so drop the
// splash shortly after it mounts. Normal launches let App dismiss it when its initial data lands.
if (firstRun) {
  setTimeout(
    () => (window as unknown as { __bismuthBootReady?: () => void }).__bismuthBootReady?.(),
    350,
  );
}
