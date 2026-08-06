import { test, expect } from "bun:test";
import { windowChromeOptions } from "./windowChrome";

test("windowChromeOptions on macOS matches build_main_window's overlay titlebar", () => {
  expect(windowChromeOptions(true)).toEqual({ titleBarStyle: "overlay", hiddenTitle: true });
});

test("windowChromeOptions off macOS matches build_main_window's undecorated window", () => {
  expect(windowChromeOptions(false)).toEqual({ decorations: false });
});
