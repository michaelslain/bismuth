// Shared base class for CodeMirror WidgetType instances that mount a Solid.js
// component into a DOM container.
//
// The boilerplate repeated across widgets like QueryBlockWidget is:
//   1. create a <div> with a className
//   2. call solid-js/web `render()` and stash the dispose fn on the element
//   3. in destroy(), read it back and call it
//   4. ignoreEvent() → true  (keep the widget interactive)
//
// Usage:
//   class MyWidget extends SolidWidget {
//     constructor(private src: string) { super("bismuth-my-block"); }
//     eq(other: MyWidget) { return other.src === this.src; }
//     protected renderSolid(container: HTMLElement): void {
//       render(() => <MyComponent src={this.src} />, container);
//     }
//   }

import { WidgetType, type EditorView } from "@codemirror/view";
import { render } from "solid-js/web";
import type { JSX } from "solid-js";

type DisposableDom = HTMLElement & { __dispose?: () => void };

/** Mount a Solid component into `container` and stash the dispose fn. */
export function mountSolid(container: HTMLElement, component: () => JSX.Element): void {
  const dispose = render(component, container);
  (container as DisposableDom).__dispose = dispose;
}

/** Call the stashed Solid dispose fn (if any) on `dom`. */
export function disposeSolid(dom: HTMLElement): void {
  const dispose = (dom as DisposableDom).__dispose;
  if (typeof dispose === "function") dispose();
}

/**
 * Base class for CodeMirror widgets that mount a single Solid component.
 *
 * Subclasses must implement:
 *   - `eq(other)` — identity check (used by CodeMirror to skip unnecessary redraws)
 *   - `renderSolid(container)` — call `mountSolid(container, () => <YourComponent />)` here
 *   - `get className()` — CSS class for the wrapper div (or override `toDOM`)
 */
export abstract class SolidWidget extends WidgetType {
  constructor(protected readonly containerClass: string) {
    super();
  }

  /** Subclass must call `mountSolid(container, ...)` to mount the component. */
  protected abstract renderSolid(container: HTMLElement): void;

  // `_view` is optional/unused by the base mount, but the signature accepts it so
  // subclasses (e.g. NoteTitleWidget) can override with the view in hand and still
  // chain `super.toDOM(view)`.
  toDOM(_view?: EditorView): HTMLElement {
    const container = document.createElement("div");
    container.className = this.containerClass;
    this.renderSolid(container);
    return container;
  }

  destroy(dom: HTMLElement): void {
    disposeSolid(dom);
  }

  // Keep the rendered Solid UI interactive (kanban drag, calendar clicks, etc.).
  ignoreEvent(): boolean {
    return true;
  }
}
