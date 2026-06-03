/* @refresh reload */
import { render } from "solid-js/web";
// KaTeX CSS is now loaded lazily alongside the katex JS chunk (see editor/katexLoader.ts),
// so it no longer ships in the entry bundle.
// default fonts: Lora (prose) + Monaspace Xenon (monospace)
import "@fontsource/lora/400.css";
import "@fontsource/lora/700.css";
import "@fontsource/lora/400-italic.css";
import "@fontsource/monaspace-xenon/400.css";
import "@fontsource/monaspace-xenon/700.css";
import App from "./App";

render(() => <App />, document.getElementById("root") as HTMLElement);
