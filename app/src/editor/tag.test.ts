// app/src/editor/tag.test.ts
import { test, expect } from "bun:test";
import { matchTagPrefix } from "./tag";

test("matches a lone # (empty query)", () => {
  expect(matchTagPrefix("#")).toEqual({ from: 1, query: "" });
});

test("matches a partial tag", () => {
  expect(matchTagPrefix("#sch")).toEqual({ from: 1, query: "sch" });
});

test("matches a tag after whitespace mid-line", () => {
  expect(matchTagPrefix("see #pro")).toEqual({ from: 5, query: "pro" });
});

test("matches a nested tag", () => {
  expect(matchTagPrefix("#parent/child")).toEqual({ from: 1, query: "parent/child" });
});

test("matches the rightmost tag when an earlier one is complete", () => {
  expect(matchTagPrefix("see #a #b")).toEqual({ from: 8, query: "b" });
});

test("does not match a heading (# space)", () => {
  expect(matchTagPrefix("# ")).toBeNull();
});

test("does not match heading markers (##)", () => {
  expect(matchTagPrefix("##")).toBeNull();
});

test("does not match a mid-word # like C#", () => {
  expect(matchTagPrefix("C#")).toBeNull();
});

test("returns null for plain text", () => {
  expect(matchTagPrefix("just text")).toBeNull();
});
