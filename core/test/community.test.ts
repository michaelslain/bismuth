import { test, expect } from "bun:test";
import { detectCommunities } from "../src/community";

test("two disconnected triangles → two communities", () => {
  const nodes = ["a","b","c","x","y","z"].map((id) => ({ id, label: id }));
  const edges = [
    ["a","b"],["b","c"],["c","a"],
    ["x","y"],["y","z"],["z","x"],
  ].map(([from,to]) => ({ from, to }));
  const m = detectCommunities(nodes, edges);
  expect(m.get("a")!.community).toBe(m.get("b")!.community);
  expect(m.get("a")!.community).toBe(m.get("c")!.community);
  expect(m.get("x")!.community).toBe(m.get("y")!.community);
  expect(m.get("a")!.community).not.toBe(m.get("x")!.community);
});

test("deterministic across runs", () => {
  const nodes = ["a","b","c","d"].map((id) => ({ id, label: id }));
  const edges = [["a","b"],["b","c"],["c","d"]].map(([from,to]) => ({ from, to }));
  const a = JSON.stringify([...detectCommunities(nodes, edges)]);
  const b = JSON.stringify([...detectCommunities(nodes, edges)]);
  expect(a).toBe(b);
});

test("isolated node gets its own community + self label", () => {
  const m = detectCommunities([{ id: "lonely", label: "Lonely" }], []);
  expect(m.get("lonely")!.label).toBe("Lonely");
});

test("empty graph → empty map", () => {
  expect(detectCommunities([], []).size).toBe(0);
});

test("exemplar label is the highest-degree member", () => {
  // star: hub connected to 3 leaves → hub is exemplar for the whole community
  const nodes = ["hub","l1","l2","l3"].map((id) => ({ id, label: id.toUpperCase() }));
  const edges = [["hub","l1"],["hub","l2"],["hub","l3"]].map(([from,to]) => ({ from, to }));
  const m = detectCommunities(nodes, edges);
  for (const id of ["hub","l1","l2","l3"]) expect(m.get(id)!.label).toBe("HUB");
});
