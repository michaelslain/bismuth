import { test, expect, describe, afterEach } from "bun:test";
import {
  MAIN_WINDOW_ID,
  windowIdFromSearch,
  tabsStorageKey,
  withWindowId,
  resolveWindowId,
} from "./windowId";

describe("windowIdFromSearch", () => {
  test("reads ?w= from the search string", () => {
    expect(windowIdFromSearch("?w=abc123")).toBe("abc123");
    expect(windowIdFromSearch("?api=http://x&w=z9")).toBe("z9");
  });
  test("absent / blank / malformed → main", () => {
    expect(windowIdFromSearch("")).toBe(MAIN_WINDOW_ID);
    expect(windowIdFromSearch(undefined)).toBe(MAIN_WINDOW_ID);
    expect(windowIdFromSearch("?api=http://x")).toBe(MAIN_WINDOW_ID);
    expect(windowIdFromSearch("?w=")).toBe(MAIN_WINDOW_ID);
  });
});

describe("tabsStorageKey", () => {
  test("main window keeps the historical key (backward compatible)", () => {
    expect(tabsStorageKey(MAIN_WINDOW_ID)).toBe("bismuth-tabs-v1");
  });
  test("other windows are namespaced by id", () => {
    expect(tabsStorageKey("abc123")).toBe("bismuth-tabs-v1:abc123");
  });
  test("distinct windows get distinct keys", () => {
    expect(tabsStorageKey("a")).not.toBe(tabsStorageKey("b"));
    expect(tabsStorageKey("a")).not.toBe(tabsStorageKey(MAIN_WINDOW_ID));
  });
});

describe("withWindowId", () => {
  test("adds ?w= when absent, preserving other params", () => {
    const out = withWindowId("http://localhost:1420/?api=http://localhost:4321", "win-1");
    const u = new URL(out);
    expect(u.searchParams.get("w")).toBe("win-1");
    expect(u.searchParams.get("api")).toBe("http://localhost:4321");
  });
  test("does not overwrite an existing ?w=", () => {
    const out = withWindowId("http://localhost:1420/?w=keep", "win-2");
    expect(new URL(out).searchParams.get("w")).toBe("keep");
  });
  test("round-trips through windowIdFromSearch", () => {
    const url = withWindowId("http://localhost:1420/", "round-trip");
    expect(windowIdFromSearch(new URL(url).search)).toBe("round-trip");
  });

  // Packaged-app case (github issue #5): the origin is the tauri:// custom protocol, and
  // an absolute tauri://localhost/… url handed to WebviewWindow is treated as an external
  // URL rather than the app's own embedded asset, dropping the query string that pins the
  // new window's backend. The fix is to pass a relative url instead — these cases cover it.
  test("a relative url gets ?w= added and stays relative", () => {
    const out = withWindowId("/?api=http://localhost:61162", "win-3", "tauri://localhost/");
    expect(out.startsWith("tauri://")).toBe(false);
    expect(out.startsWith("http://")).toBe(false);
    const u = new URL(out, "tauri://localhost/");
    expect(u.searchParams.get("w")).toBe("win-3");
    expect(u.searchParams.get("api")).toBe("http://localhost:61162");
  });
  test("a relative url with an existing ?w= keeps it", () => {
    const out = withWindowId("/?w=keep", "win-4", "tauri://localhost/");
    expect(new URL(out, "tauri://localhost/").searchParams.get("w")).toBe("keep");
  });
  test("parses against a tauri://localhost/ base and the result stays relative", () => {
    const out = withWindowId("/?api=http://localhost:4321", "win-5", "tauri://localhost/");
    expect(out.startsWith("/")).toBe(true);
  });
  test("the api param survives withWindowId unchanged (the property the bug violates)", () => {
    const out = withWindowId("/?api=http://localhost:61162", "win-6", "tauri://localhost/");
    expect(new URL(out, "tauri://localhost/").searchParams.get("api")).toBe(
      "http://localhost:61162",
    );
  });
});

describe("resolveWindowId (reads live location)", () => {
  const realLocation = globalThis.location;
  afterEach(() => {
    // @ts-expect-error restore the real location after each case
    globalThis.location = realLocation;
  });
  test("derives the id (and thus a distinct key) from window.location.search", () => {
    // @ts-expect-error minimal location stub
    globalThis.location = { search: "?w=win-7" };
    expect(resolveWindowId()).toBe("win-7");
    expect(tabsStorageKey(resolveWindowId())).toBe("bismuth-tabs-v1:win-7");

    // @ts-expect-error minimal location stub
    globalThis.location = { search: "?api=http://x" };
    expect(resolveWindowId()).toBe(MAIN_WINDOW_ID);
    expect(tabsStorageKey(resolveWindowId())).toBe("bismuth-tabs-v1");
  });
});
