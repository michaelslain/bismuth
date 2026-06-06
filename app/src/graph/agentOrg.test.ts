import { describe, expect, it } from "bun:test";
import { commChannels } from "./agentOrg";

// s1 → {a1, a2}; s2 → {a3}
const sessions = ["s1", "s2"];
const subs = [
  { id: "a1", parent: "s1" },
  { id: "a2", parent: "s1" },
  { id: "a3", parent: "s2" },
];
const has = (e: [string, string][], a: string, b: string) =>
  e.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

describe("commChannels", () => {
  it("dictatorship: no lateral communication at all", () => {
    expect(commChannels(sessions, subs, "dictatorship")).toEqual([]);
  });

  it("democracy: every agent communicates with every other (full mesh)", () => {
    const e = commChannels(sessions, subs, "democracy");
    expect(e).toHaveLength(10); // C(5,2) over s1,s2,a1,a2,a3
    expect(has(e, "s1", "s2")).toBe(true);
    expect(has(e, "a1", "a3")).toBe(true); // cross-group link EXISTS in democracy
    expect(has(e, "s1", "a3")).toBe(true);
  });

  it("republic: sessions mesh + per-session subagent mesh, no cross-group", () => {
    const e = commChannels(sessions, subs, "republic");
    expect(has(e, "s1", "s2")).toBe(true);  // sessions talk
    expect(has(e, "a1", "a2")).toBe(true);  // s1's subagents talk
    expect(has(e, "a1", "a3")).toBe(false); // different sessions' subagents do NOT
    expect(has(e, "s1", "a1")).toBe(false); // session↔its own subagent is ownership, not comm
    expect(e).toHaveLength(2); // [s1,s2] + [a1,a2]; s2 has one sub so no pair
  });

  it("empty / single-agent networks produce no channels", () => {
    expect(commChannels([], [], "democracy")).toEqual([]);
    expect(commChannels(["s1"], [], "republic")).toEqual([]);
  });
});
