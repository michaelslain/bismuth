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
    expect(tabsStorageKey(MAIN_WINDOW_ID)).toBe("oa-tabs-v1");
  });
  test("other windows are namespaced by id", () => {
    expect(tabsStorageKey("abc123")).toBe("oa-tabs-v1:abc123");
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
    expect(tabsStorageKey(resolveWindowId())).toBe("oa-tabs-v1:win-7");

    // @ts-expect-error minimal location stub
    globalThis.location = { search: "?api=http://x" };
    expect(resolveWindowId()).toBe(MAIN_WINDOW_ID);
    expect(tabsStorageKey(resolveWindowId())).toBe("oa-tabs-v1");
  });
});
