/* @refresh reload */
import { render } from "solid-js/web";
import "katex/dist/katex.min.css";
// default fonts: Lora (prose) + Monaspace Xenon (monospace)
import "@fontsource/lora/400.css";
import "@fontsource/lora/700.css";
import "@fontsource/lora/400-italic.css";
import "@fontsource/monaspace-xenon/400.css";
import "@fontsource/monaspace-xenon/700.css";
import App from "./App";

render(() => <App />, document.getElementById("root") as HTMLElement);
