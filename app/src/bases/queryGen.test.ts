import { describe, test, expect } from "bun:test";
import { parse as yamlParse } from "yaml";
import {
  buildQueryBlockBody,
  parseQueryBlockBody,
  compileNotesRow,
  compileNotesWhere,
  compileTaskLeaves,
  looksLikeBaseConfig,
  defaultBuilderState,
  defaultTaskFilters,
  type BuilderState,
  type NotesRow,
  type NotesOp,
} from "./queryGen";

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
    expect(compileTaskLeaves(tf)).toEqual([
      "not done",
      "priority is high",
      "due before in 7 days",
      "is not recurring",
      "sort by due reverse",
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
