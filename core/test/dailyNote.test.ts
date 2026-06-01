import { describe, expect, it } from "bun:test";
import { dailyNotePath, dailyNoteContent, type DailyNoteConfig } from "../src/dailyNote";

const NOON = new Date("2026-05-31T12:00:00"); // local noon → date never tz-shifts

function cfg(over: Partial<DailyNoteConfig> = {}): DailyNoteConfig {
  return { id: "journal", label: "Journal", icon: "BookOpen", folder: "Journal", fileName: "{{date}} journal", template: "", ...over };
}

describe("dailyNotePath", () => {
  it("expands fileName tokens, joins folder, appends .md", () => {
    expect(dailyNotePath(cfg(), NOON)).toBe("Journal/2026-05-31 journal.md");
  });
  it("uses the vault root when folder is empty", () => {
    expect(dailyNotePath(cfg({ folder: "" }), NOON)).toBe("2026-05-31 journal.md");
  });
  it("tolerates a trailing slash on folder", () => {
    expect(dailyNotePath(cfg({ folder: "Journal/" }), NOON)).toBe("Journal/2026-05-31 journal.md");
  });
});

describe("dailyNoteContent", () => {
  it("returns empty string when there is no template", () => {
    expect(dailyNoteContent(cfg(), NOON, null)).toBe("");
  });
  it("expands {{date}} and {{title}} (title = filename base) in the template", () => {
    expect(dailyNoteContent(cfg(), NOON, "# {{title}}\n{{date}}\n"))
      .toBe("# 2026-05-31 journal\n2026-05-31\n");
  });
});
