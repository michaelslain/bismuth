/* @refresh reload */
import { render } from "solid-js/web";
import "katex/dist/katex.min.css";
import App from "./App";

render(() => <App />, document.getElementById("root") as HTMLElement);
