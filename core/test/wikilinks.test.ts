import { test, expect } from "bun:test";
import { extractWikilinks } from "../src/wikilinks";

test("extracts targets, strips alias and heading, dedupes", () => {
  const md = `See [[internship]] and [[housing|my place]] and [[essay#intro]] and [[internship]].`;
  expect(extractWikilinks(md).sort()).toEqual(["essay", "housing", "internship"]);
});

test("no links returns empty array", () => {
  expect(extractWikilinks("plain text")).toEqual([]);
});
