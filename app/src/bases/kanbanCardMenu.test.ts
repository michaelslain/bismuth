import { test, expect } from "bun:test";
import { suppressCardContextMenu } from "./kanbanCardMenu";

// Regression guard for the bounce: a kanban card's contextmenu handler must swallow the event so
// right-clicking a card shows NOTHING — no native menu (preventDefault) AND no pane/split-pane menu
// bubbling up from the `.pane-leaf` ancestor (stopPropagation). Dropping either call reintroduces a
// visible menu on right-click, which is exactly what the user reported.
test("suppressCardContextMenu calls preventDefault (no native menu)", () => {
  let prevented = 0;
  suppressCardContextMenu({ preventDefault: () => prevented++, stopPropagation: () => {} });
  expect(prevented).toBe(1);
});

test("suppressCardContextMenu calls stopPropagation (no pane/split-pane menu underneath)", () => {
  let stopped = 0;
  suppressCardContextMenu({ preventDefault: () => {}, stopPropagation: () => stopped++ });
  expect(stopped).toBe(1);
});

test("suppressCardContextMenu calls BOTH, exactly once each", () => {
  let prevented = 0;
  let stopped = 0;
  suppressCardContextMenu({ preventDefault: () => prevented++, stopPropagation: () => stopped++ });
  expect(prevented).toBe(1);
  expect(stopped).toBe(1);
});
