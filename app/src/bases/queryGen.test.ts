import { describe, test, expect } from "bun:test";
import { parse as yamlParse } from "yaml";
import {
  buildQueryBlockBody,
  parseQueryBlockBody,
  compileNotesRow,
  compileNotesWhere,
  compileTaskLeaves,
  looksLikeBaseConfig,
  isBuilderRepresentable,
  defaultBuilderState,
  defaultTaskFilters,
  type BuilderState,
  type NotesRow,
  type NotesOp,
} from "./queryGen";
import { parseQueryBlock } from "../../../core/src/bases/queryBlock";

const row = (prop: string, op: NotesOp, val = "", type: NotesRow["type"] = "string"): NotesRow => ({ prop, op, val, type });

function notesState(rows: NotesRow[], extra: Partial<BuilderState> = {}): BuilderState {
  return { ...defaultBuilderState(), source: "notes", notes: { connective: "and", rows }, ...extra };
}

describe("looksLikeBaseConfig", () => {
  test("config bodies vs flat specs", () => {
    expect(looksLikeBaseConfig("source: notes where x")).toBe(true);
    expect(looksLikeBaseConfig("views:\n  - type: table")).toBe(true);
    expect(looksLikeBaseConfig("of: [[Books]]")).toBe(false);
    expect(looksLikeBaseConfig("tasks: not done")).toBe(false);
  });
});

describe("compileNotesRow — each operator -> expr", () => {
  test("string ops", () => {
    expect(compileNotesRow(row("status", "equals", "done"))).toBe(`status == "done"`);
    expect(compileNotesRow(row("status", "not_equals", "done"))).toBe(`status != "done"`);
    expect(compileNotesRow(row("title", "contains", "rust"))).toBe(`title.contains("rust")`);
    expect(compileNotesRow(row("title", "starts_with", "A"))).toBe(`title.startsWith("A")`);
    expect(compileNotesRow(row("title", "ends_with", "z"))).toBe(`title.endsWith("z")`);
    expect(compileNotesRow(row("title", "matches", "^a.*"))).toBe(`title.matches("^a.*")`);
  });
  test("number ops emit bare numeric literals", () => {
    expect(compileNotesRow(row("rating", "gte", "4", "number"))).toBe("rating >= 4");
    expect(compileNotesRow(row("rating", "gt", "4", "number"))).toBe("rating > 4");
    expect(compileNotesRow(row("rating", "lt", "2", "number"))).toBe("rating < 2");
    expect(compileNotesRow(row("rating", "lte", "2", "number"))).toBe("rating <= 2");
    expect(compileNotesRow(row("rating", "equals", "5", "number"))).toBe("rating == 5");
  });
  test("tag + folder ops", () => {
    expect(compileNotesRow(row("tags", "has_tag", "book", "tag"))).toBe(`file.hasTag("book")`);
    expect(compileNotesRow(row("tags", "not_tag", "book", "tag"))).toBe(`!file.hasTag("book")`);
    expect(compileNotesRow(row("file.folder", "in_folder", "reading"))).toBe(`file.inFolder("reading")`);
    expect(compileNotesRow(row("file.folder", "folder_is", "reading"))).toBe(`file.folder == "reading"`);
  });
  test("date ops", () => {
    expect(compileNotesRow(row("due", "date_before", "today", "date"))).toBe("date(due) < today()");
    expect(compileNotesRow(row("due", "date_after", "today", "date"))).toBe("date(due) >= today()");
    expect(compileNotesRow(row("due", "date_before", "2026-01-01", "date"))).toBe(`date(due) < date("2026-01-01")`);
  });
  test("presence + boolean ops", () => {
    expect(compileNotesRow(row("done", "checked"))).toBe("done");
    expect(compileNotesRow(row("done", "unchecked"))).toBe("!done");
    expect(compileNotesRow(row("cover", "is_set"))).toBe("cover");
    expect(compileNotesRow(row("cover", "is_empty"))).toBe("!cover");
  });
  test("raw op passes through verbatim", () => {
    expect(compileNotesRow(row("", "raw", "rating * 2 > 8"))).toBe("rating * 2 > 8");
  });
});

describe("compileNotesWhere — multiple rows joined", () => {
  test("single row is unwrapped", () => {
    expect(compileNotesWhere({ connective: "and", rows: [row("tags", "has_tag", "book", "tag")] })).toBe(`file.hasTag("book")`);
  });
  test("AND of two rows", () => {
    const w = compileNotesWhere({
      connective: "and",
      rows: [row("tags", "has_tag", "book", "tag"), row("rating", "gte", "4", "number")],
    });
    expect(w).toBe(`(file.hasTag("book")) && (rating >= 4)`);
  });
  test("OR connective", () => {
    const w = compileNotesWhere({
      connective: "or",
      rows: [row("status", "equals", "todo"), row("status", "equals", "doing")],
    });
    expect(w).toBe(`(status == "todo") || (status == "doing")`);
  });
  test("rawWhere overrides rows", () => {
    expect(compileNotesWhere({ connective: "and", rows: [row("a", "is_set")], rawWhere: "custom.expr()" })).toBe("custom.expr()");
  });
});

describe("buildQueryBlockBody — notes -> FULL INLINE CONFIG", () => {
  test("no filters", () => {
    const body = buildQueryBlockBody(notesState([]));
    const cfg = yamlParse(body);
    expect(cfg.source).toBe("notes");
    expect(cfg.views).toEqual([{ type: "table", name: "Table" }]);
  });
  test("with filters, sort, group, limit", () => {
    const body = buildQueryBlockBody(
      notesState([row("tags", "has_tag", "book", "tag"), row("rating", "gte", "4", "number")], {
        view: "cards",
        sort: [{ property: "rating", direction: "DESC" }],
        group: "status",
        limit: 10,
      }),
    );
    const cfg = yamlParse(body);
    expect(cfg.source).toBe(`notes where (file.hasTag("book")) && (rating >= 4)`);
    expect(cfg.views[0]).toEqual({
      type: "cards",
      name: "Cards",
      sort: [{ property: "rating", direction: "DESC" }],
      groupBy: { property: "status" },
      limit: 10,
    });
  });
});

describe("compileTaskLeaves — presets", () => {
  test("status / priority / due / recurring / sort", () => {
    const tf = {
      ...defaultTaskFilters(),
      status: "open" as const,
      priority: "high",
      due: "week" as const,
      recurring: "no" as const,
      sortKey: "due",
      sortReverse: true,
    };
    // compileTaskLeaves returns FILTER leaves only — `sort by …` is emitted separately (on its own
    // line via a block scalar) because runTaskQuery only honors a sort that is a whole line.
    expect(compileTaskLeaves(tf)).toEqual([
      "not done",
      "priority is high",
      "due before in 7 days",
      "is not recurring",
    ]);
  });
  test("done + overdue + has", () => {
    expect(compileTaskLeaves({ ...defaultTaskFilters(), status: "done", due: "overdue" })).toEqual([
      "done",
      "due before today",
    ]);
    expect(compileTaskLeaves({ ...defaultTaskFilters(), due: "has" })).toEqual(["due after 1900-01-01"]);
    expect(compileTaskLeaves({ ...defaultTaskFilters(), due: "today" })).toEqual(["due today"]);
  });
  test("all/any defaults emit nothing", () => {
    expect(compileTaskLeaves(defaultTaskFilters())).toEqual([]);
  });
});

describe("buildQueryBlockBody — tasks -> FLAT", () => {
  test("filters joined with AND, optional from/view/group/limit", () => {
    const state: BuilderState = {
      ...defaultBuilderState(),
      source: "tasks",
      view: "cards",
      group: "due",
      limit: 5,
      tasks: { ...defaultTaskFilters(), status: "open", priority: "high", from: "[[Google Keep]]" },
    };
    const body = buildQueryBlockBody(state);
    expect(body).toBe(["tasks: not done AND priority is high", "from: [[Google Keep]]", "view: cards", "group: due", "limit: 5"].join("\n"));
  });
  test("list view omits the view: line", () => {
    const state: BuilderState = { ...defaultBuilderState(), source: "tasks", view: "list", tasks: { ...defaultTaskFilters(), status: "open" } };
    expect(buildQueryBlockBody(state)).toBe("tasks: not done");
  });
});

describe("buildQueryBlockBody — base -> FLAT", () => {
  test("of + where + view + limit", () => {
    const state: BuilderState = {
      ...defaultBuilderState(),
      source: "base",
      baseRef: "[[Books]]",
      baseWhere: `rating >= 4`,
      view: "cards",
      limit: 3,
    };
    expect(buildQueryBlockBody(state)).toBe(["of: [[Books]]", "where: rating >= 4", "view: cards", "limit: 3"].join("\n"));
  });
});

describe("parseQueryBlockBody — flat tasks/base", () => {
  test("base round-trip", () => {
    const s = parseQueryBlockBody("of: [[Books]]\nwhere: rating >= 4\nview: cards\nlimit: 3");
    expect(s.source).toBe("base");
    expect(s.baseRef).toBe("[[Books]]");
    expect(s.baseWhere).toBe("rating >= 4");
    expect(s.view).toBe("cards");
    expect(s.limit).toBe(3);
  });
  test("tasks presets are reversed; unknown leaves go to rawWhere", () => {
    const s = parseQueryBlockBody("tasks: not done AND priority is high AND tag includes foo\nfrom: [[Keep]]\nview: cards");
    expect(s.source).toBe("tasks");
    expect(s.tasks.status).toBe("open");
    expect(s.tasks.priority).toBe("high");
    expect(s.tasks.from).toBe("[[Keep]]");
    expect(s.tasks.rawWhere).toBe("tag includes foo");
    expect(s.view).toBe("cards");
  });
  test("tasks sort leaf is reversed", () => {
    const s = parseQueryBlockBody("tasks: done AND sort by due reverse");
    expect(s.tasks.status).toBe("done");
    expect(s.tasks.sortKey).toBe("due");
    expect(s.tasks.sortReverse).toBe(true);
  });
});

describe("parseQueryBlockBody — notes config", () => {
  test("reverses where into rows + reads view/sort/group/limit", () => {
    const s = parseQueryBlockBody(
      [
        `source: notes where (file.hasTag("book")) && (rating >= 4)`,
        "views:",
        "  - type: cards",
        "    name: Cards",
        "    sort:",
        "      - property: rating",
        "        direction: DESC",
        "    groupBy:",
        "      property: status",
        "    limit: 10",
      ].join("\n"),
    );
    expect(s.source).toBe("notes");
    expect(s.notes.connective).toBe("and");
    expect(s.notes.rows).toEqual([
      { prop: "tags", op: "has_tag", val: "book", type: "tag" },
      { prop: "rating", op: "gte", val: "4", type: "number" },
    ]);
    expect(s.notes.rawWhere).toBeUndefined();
    expect(s.view).toBe("cards");
    expect(s.sort).toEqual([{ property: "rating", direction: "DESC" }]);
    expect(s.group).toBe("status");
    expect(s.limit).toBe(10);
  });
  test("source: notes with no filter -> empty rows", () => {
    const s = parseQueryBlockBody("source: notes\nviews:\n  - type: table");
    expect(s.source).toBe("notes");
    expect(s.notes.rows).toEqual([]);
    expect(s.notes.rawWhere).toBeUndefined();
  });
  test("un-reversible expression fails open to rawWhere", () => {
    const s = parseQueryBlockBody(`source: notes where items.filter(x => x > 2).length > 0\nviews:\n  - type: table`);
    expect(s.source).toBe("notes");
    expect(s.notes.rows).toEqual([]);
    expect(s.notes.rawWhere).toBe("items.filter(x => x > 2).length > 0");
  });
  test("mixed AND/OR fails open to rawWhere", () => {
    const s = parseQueryBlockBody(`source: notes where a == 1 && b == 2 || c == 3\nviews:\n  - type: table`);
    expect(s.notes.rows).toEqual([]);
    expect(s.notes.rawWhere).toBe("a == 1 && b == 2 || c == 3");
  });
});

describe("build -> parse -> build idempotence (supported subset)", () => {
  function rebuild(state: BuilderState): string {
    return buildQueryBlockBody(state);
  }
  test("notes", () => {
    const s = notesState([row("tags", "has_tag", "book", "tag"), row("rating", "gte", "4", "number")], {
      view: "cards",
      sort: [{ property: "rating", direction: "DESC" }],
      group: "status",
      limit: 10,
    });
    const once = rebuild(s);
    const twice = rebuild(parseQueryBlockBody(once));
    expect(twice).toBe(once);
  });
  test("tasks", () => {
    const s: BuilderState = {
      ...defaultBuilderState(),
      source: "tasks",
      view: "cards",
      tasks: { ...defaultTaskFilters(), status: "open", priority: "high", due: "week", recurring: "no", from: "[[Keep]]" },
    };
    const once = rebuild(s);
    const twice = rebuild(parseQueryBlockBody(once));
    expect(twice).toBe(once);
  });
  test("base", () => {
    const s: BuilderState = { ...defaultBuilderState(), source: "base", baseRef: "[[Books]]", baseWhere: "rating >= 4", view: "cards", limit: 3 };
    const once = rebuild(s);
    const twice = rebuild(parseQueryBlockBody(once));
    expect(twice).toBe(once);
  });
  test("date filters", () => {
    const s = notesState([row("due", "date_before", "today", "date")], { view: "table" });
    const once = rebuild(s);
    const twice = rebuild(parseQueryBlockBody(once));
    expect(twice).toBe(once);
  });
});

describe("review fixes — task sort, date_within, builder-representable", () => {
  // #3: task `sort by …` must land on its OWN DSL line (a block scalar), not inside the AND-joined
  // filter value — else runTaskQuery treats it as an unrecognized filter and never sorts.
  test("task sort emits a multi-line block scalar runTaskQuery can honor", () => {
    const s: BuilderState = {
      ...defaultBuilderState(),
      source: "tasks",
      tasks: { ...defaultTaskFilters(), status: "open", sortKey: "due", sortReverse: true },
    };
    const body = buildQueryBlockBody(s);
    // `sort by …` is NOT glued onto the filter line with ` AND `.
    expect(body).not.toMatch(/AND sort by/);
    expect(body).toContain("tasks: |-");
    // parseQueryBlock carries the multi-line value, with `sort by due reverse` as its own line.
    const qb = parseQueryBlock(body);
    expect(qb.source?.kind).toBe("tasks");
    expect((qb.source?.where ?? "").split("\n")).toContain("sort by due reverse");
    // …and it round-trips back into the builder's sort controls.
    const back = parseQueryBlockBody(body);
    expect(back.tasks.sortKey).toBe("due");
    expect(back.tasks.sortReverse).toBe(true);
  });

  // #6: a "within N days" control round-trips as ONE row, not a split date_after+date_before pair.
  test("date_within round-trips as a single row", () => {
    const s = notesState([row("due", "date_within", "7", "date")]);
    const back = parseQueryBlockBody(buildQueryBlockBody(s));
    expect(back.notes.rows).toHaveLength(1);
    expect(back.notes.rows[0]).toMatchObject({ prop: "due", op: "date_within", val: "7" });
    const once = buildQueryBlockBody(s);
    expect(buildQueryBlockBody(parseQueryBlockBody(once))).toBe(once);
  });

  // A hand-edited `due before in N days` with N != 7 must NOT be collapsed to the "week" preset (which
  // re-emits "due before in 7 days") — only the exact 7-day form maps to `week`; any other N survives
  // verbatim in rawWhere so the round-trip is lossless.
  test("hand-edited 'due before in 30 days' round-trips unchanged (not collapsed to 7)", () => {
    const s = parseQueryBlockBody("tasks: not done AND due before in 30 days");
    expect(s.tasks.due).toBe("any");
    expect(s.tasks.rawWhere).toBe("due before in 30 days");
    const back = buildQueryBlockBody(s);
    expect(back).toContain("due before in 30 days");
    expect(back).not.toContain("due before in 7 days");
    // full build->parse->build idempotence
    expect(buildQueryBlockBody(parseQueryBlockBody(back))).toBe(back);
  });

  // Same class as above for the `has`-a-due-date sentinel: the builder emits the exact
  // "due after 1900-01-01"; only that exact string maps to `has`. A hand-edited real date
  // must survive verbatim in rawWhere, not be collapsed to `has` and re-emitted as 1900-01-01.
  test("hand-edited 'due after 2030-01-01' round-trips unchanged (not collapsed to the has-sentinel)", () => {
    const s = parseQueryBlockBody("tasks: not done AND due after 2030-01-01");
    expect(s.tasks.due).toBe("any");
    expect(s.tasks.rawWhere).toBe("due after 2030-01-01");
    const back = buildQueryBlockBody(s);
    expect(back).toContain("due after 2030-01-01");
    expect(back).not.toContain("due after 1900-01-01");
    expect(buildQueryBlockBody(parseQueryBlockBody(back))).toBe(back);
  });

  // #4: the builder's own output is always representable; a richer hand-authored config is NOT (so
  // the Pencil is hidden and the block isn't clobbered).
  test("isBuilderRepresentable gates rich configs", () => {
    expect(isBuilderRepresentable(buildQueryBlockBody(notesState([row("status", "equals", "open")])))).toBe(true);
    expect(isBuilderRepresentable("tasks: not done")).toBe(true);
    expect(isBuilderRepresentable("source: notes\nformulas:\n  x: 1\nviews:\n  - type: table")).toBe(false);
    expect(isBuilderRepresentable("source: notes\nviews:\n  - type: table\n  - type: cards")).toBe(false);
    expect(isBuilderRepresentable("source: tasks where not done\nviews:\n  - type: table")).toBe(false);
  });
});
