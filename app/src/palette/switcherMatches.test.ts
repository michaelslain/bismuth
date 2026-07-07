import { describe, expect, test } from "bun:test";
import { switcherMatchNodeIds } from "./switcherMatches";

describe("switcherMatchNodeIds", () => {
  test("strips the .md extension so paths become graph node ids", () => {
    expect(switcherMatchNodeIds(["a.md", "reading/quotes/x.md"])).toEqual([
      "a",
      "reading/quotes/x",
    ]);
  });

  test("drops non-.md results (settings / .sheet / .draw are not graph nodes)", () => {
    expect(
      switcherMatchNodeIds([".settings", "budget.sheet", "sketch.draw", "note.md"]),
    ).toEqual(["note"]);
  });

  test("preserves the ranked input order of the surviving matches", () => {
    expect(switcherMatchNodeIds(["z.md", "a.md", "m.md"])).toEqual(["z", "a", "m"]);
  });

  test("empty input → empty set (nothing highlighted)", () => {
    expect(switcherMatchNodeIds([])).toEqual([]);
  });
});
