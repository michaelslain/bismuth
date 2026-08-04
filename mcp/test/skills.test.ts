import { test, expect } from "bun:test";
import { resolve } from "node:path";
import { listSkills, readSkill } from "../src/skills";

// mcp/test → workspace root → repo root → skills/. Mirrors docs.test.ts's repoRoot resolution
// for the equivalent docsRoot fixture.
const skillsRoot = resolve(import.meta.dir, "..", "..", "skills");

test("listSkills finds authoring-bismuth-bases with a non-empty description", () => {
  const skills = listSkills(skillsRoot);
  const authoring = skills.find((s) => s.name === "authoring-bismuth-bases");
  expect(authoring).toBeDefined();
  expect(authoring!.description.length).toBeGreaterThan(0);
});

test("readSkill returns SKILL.md by default", () => {
  const text = readSkill(skillsRoot, "authoring-bismuth-bases");
  expect(text).toContain("Authoring Bismuth bases");
});

test("readSkill returns a reference file when asked", () => {
  const text = readSkill(skillsRoot, "authoring-bismuth-bases", "kanban");
  expect(text).toContain("groupBy");
});

test("path traversal in the reference param is rejected", () => {
  expect(() =>
    readSkill(skillsRoot, "authoring-bismuth-bases", "../../../etc/passwd"),
  ).toThrow();
});

// The traversal above targets a path that doesn't exist either way (no /etc/passwd.md), so on
// its own it can't tell "rejected by the traversal guard" apart from "rejected because the file
// isn't there". This one traverses to a file that DOES exist just outside skillsRoot (the repo's
// own CLAUDE.md, three levels up from skills/authoring-bismuth-bases/references/) — with the
// guard removed this would succeed and return its content instead of throwing.
test("path traversal to a file that actually exists outside the skill dir is still rejected", () => {
  expect(() =>
    readSkill(skillsRoot, "authoring-bismuth-bases", "../../../CLAUDE"),
  ).toThrow();
});

test("an unknown skill name throws rather than returning an empty success", () => {
  expect(() => readSkill(skillsRoot, "definitely-not-a-real-skill")).toThrow();
});
