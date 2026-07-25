import { describe, expect, it } from "bun:test";
import { applyNewNoteTemplate, newNoteContent, type NewNoteTemplateIO } from "../src/newNoteTemplate";
import { noteStem } from "../src/pathUtils";

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

describe("noteStem — the title a template's {{title}} expands to", () => {
  it("strips the hidden extension and any folders", () => {
    expect(noteStem("reading/quotes/Grocery List.md")).toBe("Grocery List");
    expect(noteStem("Untitled.md")).toBe("Untitled");
    expect(noteStem("config.yaml")).toBe("config");
  });

  it("strips only the ONE trailing hidden extension", () => {
    expect(noteStem("notes.v2.md")).toBe("notes.v2");
  });

  it("leaves a name with no hidden extension alone", () => {
    expect(noteStem("Untitled.sheet")).toBe("Untitled.sheet");
  });
});

// ---------------------------------------------------------------------------
// applyNewNoteTemplate — the ORDERING contract
//
// A new note is created under a placeholder name ("Untitled.md") and dropped straight into the
// file tree's inline rename; the user's Enter MOVES it. Expanding + writing the template at
// CREATE time therefore binds every output — {{title}}, the {{cursor}} offset, the primed
// note-cache entry — to a path that stops existing a keystroke later:
//   • {{title}} renders "Untitled" for ~every note the user actually names;
//   • the caret offset is keyed to the pre-rename path, so the editor's takePendingCursor(final)
//     always misses;
//   • the note cache re-keys itself on `bismuth-moved` BEFORE the move resolves, so a create-time
//     prime is overwritten by the stale empty body and the real one lands at a dead key.
// These tests pin the fix: nothing is expanded or written until `settledPath` resolves with the
// note's FINAL path. They fail against a create-time implementation.
// ---------------------------------------------------------------------------

/** A recording fake of the injected IO, plus the template file's contents. */
function makeIO(template: string | Error = "") {
  const calls: {
    reads: string[];
    writes: { path: string; text: string }[];
    primes: { path: string; text: string }[];
    cursors: { path: string; offset: number }[];
  } = { reads: [], writes: [], primes: [], cursors: [] };
  const io: NewNoteTemplateIO = {
    readTemplate: async (p) => {
      calls.reads.push(p);
      if (template instanceof Error) throw template;
      return template;
    },
    write: async (p, text) => { calls.writes.push({ path: p, text }); },
    primeCache: (p, text) => { calls.primes.push({ path: p, text }); },
    setCursor: (p, offset) => { calls.cursors.push({ path: p, offset }); },
  };
  return { io, calls };
}

/** A deferred stand-in for "the inline rename settled at this path". */
function deferredPath() {
  let settle!: (p: string) => void;
  const promise = new Promise<string>((r) => { settle = r; });
  return { promise, settle };
}

const TEMPLATE = "---\ndate: {{date}}\ntitle: {{title}}\n---\n# {{title}}\n\n{{cursor}}\n";

describe("applyNewNoteTemplate — expands against the note's FINAL name", () => {
  it("uses the name the USER typed, not the 'Untitled' placeholder it was created under", async () => {
    const { io, calls } = makeIO(TEMPLATE);
    const settled = deferredPath();
    const done = applyNewNoteTemplate({
      templatePath: "_templates/Note.md", now: NOON, settledPath: settled.promise, io,
    });
    // The note was CREATED as "Untitled.md"; the user renamed it to "Grocery List.md".
    settled.settle("Grocery List.md");
    await done;

    expect(calls.writes).toHaveLength(1);
    expect(calls.writes[0].path).toBe("Grocery List.md");
    expect(calls.writes[0].text).toBe(
      "---\ndate: 2026-05-31\ntitle: Grocery List\n---\n# Grocery List\n\n\n",
    );
    // The regression this pins: no "Untitled" anywhere in the body.
    expect(calls.writes[0].text).not.toContain("Untitled");
  });

  it("titles from the basename when the rename also moved the note into a folder", async () => {
    const { io, calls } = makeIO("# {{title}}\n");
    const settled = deferredPath();
    const done = applyNewNoteTemplate({
      templatePath: "_templates/Note.md", now: NOON, settledPath: settled.promise, io,
    });
    settled.settle("reading/quotes/Deep Work.md");
    await done;
    expect(calls.writes[0]).toEqual({ path: "reading/quotes/Deep Work.md", text: "# Deep Work\n" });
  });

  it("writes NOTHING until the rename settles (so the write can never race the move)", async () => {
    const { io, calls } = makeIO(TEMPLATE);
    const settled = deferredPath();
    const done = applyNewNoteTemplate({
      templatePath: "_templates/Note.md", now: NOON, settledPath: settled.promise, io,
    });
    // Let every already-resolvable microtask drain — the template read has had every chance to
    // finish, but with no final path there is still nothing to write to.
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(calls.writes).toEqual([]);
    expect(calls.primes).toEqual([]);
    expect(calls.cursors).toEqual([]);
    // The read, on the other hand, is already in flight — it overlaps the user's typing.
    expect(calls.reads).toEqual(["_templates/Note.md"]);

    settled.settle("Grocery List.md");
    await done;
    expect(calls.writes).toHaveLength(1);
  });

  it("primes the note cache + records the caret under the FINAL path", async () => {
    const { io, calls } = makeIO(TEMPLATE);
    const settled = deferredPath();
    const done = applyNewNoteTemplate({
      templatePath: "_templates/Note.md", now: NOON, settledPath: settled.promise, io,
    });
    settled.settle("Grocery List.md");
    await done;

    const text = calls.writes[0].text;
    // The cache must hold the TEMPLATED body at the final key — not the stale empty string the
    // `bismuth-moved` re-key carries over from the create-time prime.
    expect(calls.primes).toEqual([{ path: "Grocery List.md", text }]);
    // …and the caret offset must be keyed to the path the editor will actually open.
    expect(calls.cursors).toEqual([{ path: "Grocery List.md", offset: text.length - 1 }]);
  });

  it("primes the cache with exactly what it wrote", async () => {
    const { io, calls } = makeIO(TEMPLATE);
    const settled = deferredPath();
    const done = applyNewNoteTemplate({
      templatePath: "_templates/Note.md", now: NOON, settledPath: settled.promise, io,
    });
    settled.settle("Notes/Later.md");
    await done;
    expect(calls.primes[0].text).toBe(calls.writes[0].text);
    expect(calls.primes[0].path).toBe(calls.writes[0].path);
  });
});

describe("applyNewNoteTemplate — abandoned renames still get the template", () => {
  it("Escape / kept 'Untitled' settles at the created path and still writes", async () => {
    const { io, calls } = makeIO(TEMPLATE);
    const settled = deferredPath();
    const done = applyNewNoteTemplate({
      templatePath: "_templates/Note.md", now: NOON, settledPath: settled.promise, io,
    });
    settled.settle("Untitled.md"); // the user bailed out of the rename
    await done;
    expect(calls.writes).toHaveLength(1);
    expect(calls.writes[0].path).toBe("Untitled.md");
    expect(calls.writes[0].text).toContain("# Untitled");
  });

  it("a failed move settles back at the original path and templates THAT", async () => {
    const { io, calls } = makeIO("# {{title}}\n");
    const settled = deferredPath();
    const done = applyNewNoteTemplate({
      templatePath: "_templates/Note.md", now: NOON, settledPath: settled.promise, io,
    });
    settled.settle("Untitled 2.md"); // api.move rejected; the note is still where it was created
    await done;
    expect(calls.writes).toEqual([{ path: "Untitled 2.md", text: "# Untitled 2\n" }]);
  });
});

describe("applyNewNoteTemplate — no template configured or usable", () => {
  it("unset (the default) does NO io at all — byte-identical to having no such setting", async () => {
    const { io, calls } = makeIO(TEMPLATE);
    const settled = deferredPath();
    await applyNewNoteTemplate({ templatePath: "", now: NOON, settledPath: settled.promise, io });
    // Notably it also does not await settledPath — an unconfigured create finishes immediately.
    expect(calls).toEqual({ reads: [], writes: [], primes: [], cursors: [] });
  });

  it("whitespace-only setting is treated as unset", async () => {
    const { io, calls } = makeIO(TEMPLATE);
    const settled = deferredPath();
    await applyNewNoteTemplate({ templatePath: "   ", now: NOON, settledPath: settled.promise, io });
    expect(calls.reads).toEqual([]);
    expect(calls.writes).toEqual([]);
  });

  it("a missing/unreadable template never throws and never writes", async () => {
    const { io, calls } = makeIO(new Error("ENOENT: no such file"));
    const settled = deferredPath();
    const done = applyNewNoteTemplate({
      templatePath: "_templates/Gone.md", now: NOON, settledPath: settled.promise, io,
    });
    settled.settle("Grocery List.md");
    await expect(done).resolves.toBeUndefined();
    expect(calls.writes).toEqual([]);
    expect(calls.primes).toEqual([]);
    expect(calls.cursors).toEqual([]);
  });

  it("an empty template file writes nothing (the note stays the empty file the create made)", async () => {
    const { io, calls } = makeIO("");
    const settled = deferredPath();
    const done = applyNewNoteTemplate({
      templatePath: "_templates/Empty.md", now: NOON, settledPath: settled.promise, io,
    });
    settled.settle("Grocery List.md");
    await done;
    expect(calls.writes).toEqual([]);
    expect(calls.cursors).toEqual([]);
  });

  it("a failing WRITE rejects (so the caller can surface it) and skips cache/caret", async () => {
    const { io, calls } = makeIO(TEMPLATE);
    io.write = async () => { throw new Error("EACCES"); };
    const settled = deferredPath();
    const done = applyNewNoteTemplate({
      templatePath: "_templates/Note.md", now: NOON, settledPath: settled.promise, io,
    });
    settled.settle("Grocery List.md");
    await expect(done).rejects.toThrow("EACCES");
    expect(calls.primes).toEqual([]);
    expect(calls.cursors).toEqual([]);
  });
});
