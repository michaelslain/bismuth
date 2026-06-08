import { describe, expect, it } from "bun:test";
import { RowCache } from "./rowCache";

describe("RowCache", () => {
  it("peek returns the last set value", () => {
    const c = new RowCache<number>();
    expect(c.peek("a")).toBeUndefined();
    c.set("a", 1, 10);
    expect(c.peek("a")).toBe(1);
  });

  it("isFresh is true only for the version it was set at", () => {
    const c = new RowCache<number>();
    c.set("a", 1, 10);
    expect(c.isFresh("a", 10)).toBe(true);
    expect(c.isFresh("a", 11)).toBe(false); // version moved on
    expect(c.isFresh("missing", 10)).toBe(false);
  });

  it("invalidate marks older entries stale but keeps the value for instant paint", () => {
    const c = new RowCache<number>();
    c.set("a", 1, 10);
    c.invalidate(11); // a vault change at v11
    expect(c.isFresh("a", 11)).toBe(false); // must revalidate
    expect(c.isFresh("a", 10)).toBe(false); // stale flag overrides version match
    expect(c.peek("a")).toBe(1); // value retained for the stale-while-revalidate paint
  });

  it("invalidate does not stale an entry already at the new version", () => {
    const c = new RowCache<number>();
    c.set("a", 1, 11); // resolved at v11
    c.invalidate(11); // same version — nothing to revalidate
    expect(c.isFresh("a", 11)).toBe(true);
  });

  it("re-setting at the new version clears the stale flag", () => {
    const c = new RowCache<number>();
    c.set("a", 1, 10);
    c.invalidate(11);
    expect(c.isFresh("a", 11)).toBe(false);
    c.set("a", 2, 11); // revalidated
    expect(c.isFresh("a", 11)).toBe(true);
    expect(c.peek("a")).toBe(2);
  });
});
