import { describe, expect, it } from "bun:test";
import { newNoteContent } from "../src/newNoteTemplate";

const NOON = new Date("2026-05-31T12:00:00"); // local noon → date never tz-shifts

describe("newNoteContent", () => {
  it("(a) unset/no template -> empty note, unchanged behavior", () => {
    expect(newNoteContent(null, NOON, "Untitled")).toEqual({ text: "", cursorOffset: 0 });
  });

  it("(b) configured template -> frontmatter/body appear with {{date}}/{{title}} expanded", () => {
    const raw = "---\ndate: {{date}}\n---\n# {{title}}\n";
    const result = newNoteContent(raw, NOON, "Grocery List");
    expect(result.text).toBe("---\ndate: 2026-05-31\n---\n# Grocery List\n");
  });

  it("(c) missing/unreadable template -> caller passes null -> falls back to an empty note without throwing", () => {
    // The caller (server/frontend) resolves templateRaw to null when the configured path is
    // missing or unreadable — this module never touches the filesystem, so it can't throw on a
    // bad path; it just treats null as "no template" like case (a).
    expect(() => newNoteContent(null, NOON, "Untitled")).not.toThrow();
    expect(newNoteContent(null, NOON, "Untitled")).toEqual({ text: "", cursorOffset: 0 });
  });

  it("(d) cursorOffset is respected: lands at the first {{cursor}} token", () => {
    const raw = "---\ndate: {{date}}\n---\n# {{title}}\n\n{{cursor}}\n";
    const result = newNoteContent(raw, NOON, "Grocery List");
    const expectedText = "---\ndate: 2026-05-31\n---\n# Grocery List\n\n\n";
    expect(result.text).toBe(expectedText);
    // {{cursor}} sits right before the template's final "\n", so the caret lands one
    // character short of the end — everything up to and including "# Grocery List\n\n".
    expect(result.cursorOffset).toBe(expectedText.length - 1);
  });

  it("(d) cursorOffset defaults to text.length when the template has no {{cursor}} token", () => {
    const raw = "# {{title}}\n";
    const result = newNoteContent(raw, NOON, "Grocery List");
    expect(result.cursorOffset).toBe(result.text.length);
  });

  it("an empty template file resolves to an empty note (cursorOffset 0)", () => {
    expect(newNoteContent("", NOON, "Untitled")).toEqual({ text: "", cursorOffset: 0 });
  });
});
