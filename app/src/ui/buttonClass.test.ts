import { describe, it, expect } from "bun:test";
import { buttonClass, searchBarClass } from "./buttonClass";

describe("buttonClass", () => {
  it("defaults to primary md with no extras", () => {
    expect(buttonClass({})).toBe("btn btn--primary");
  });
  it("applies variant, size, active, and extra class in order", () => {
    expect(buttonClass({ variant: "ghost", size: "sm", active: true, class: "x" }))
      .toBe("btn btn--ghost btn--sm is-active x");
  });
  it("omits size class for md", () => {
    expect(buttonClass({ variant: "danger", size: "md" })).toBe("btn btn--danger");
  });
  it("icon variant renders the icon chrome class", () => {
    expect(buttonClass({ variant: "icon" })).toBe("btn btn--icon");
  });
});

describe("searchBarClass", () => {
  it("defaults to the base search-bar class", () => {
    expect(searchBarClass()).toBe("search-bar");
  });
  it("appends an extra class", () => {
    expect(searchBarClass("wide")).toBe("search-bar wide");
  });
});
