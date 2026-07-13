import { test, expect } from "bun:test";
import { parseBase, parseBaseFile } from "../../src/bases/parse";

test("parses the canonical obsidian example", () => {
  const yaml = `
filters:
  or:
    - file.hasTag("tag")
    - and:
        - file.hasTag("book")
        - file.hasLink("Textbook")
formulas:
  ppu: "(price / age).toFixed(2)"
properties:
  status:
    displayName: Status
views:
  - type: table
    name: My table
    limit: 10
    order:
      - file.name
      - formula.ppu
    summaries:
      formula.ppu: Average
`;
  const base = parseBase(yaml);
  expect(base.views).toHaveLength(1);
  expect(base.views[0].type).toBe("table");
  expect(base.views[0].name).toBe("My table");
  expect(base.views[0].limit).toBe(10);
  expect(base.views[0].order).toEqual(["file.name", "formula.ppu"]);
  expect(base.formulas?.ppu).toBe("(price / age).toFixed(2)");
  expect(base.properties?.status?.displayName).toBe("Status");
  expect((base.filters as { or: unknown[] }).or).toHaveLength(2);
});

test("defaults a view name and type when missing", () => {
  const base = parseBase(`views:\n  - {}\n`);
  expect(base.views[0].type).toBe("table");
  expect(base.views[0].name).toBe("Untitled view");
});

test("synthesizes a default table view when views is absent", () => {
  const base = parseBase(`filters: 'file.hasTag(\"x\")'`);
  expect(base.views).toHaveLength(1);
  expect(base.views[0].type).toBe("table");
});

test("normalizes groupBy given as a bare string", () => {
  const base = parseBase(`views:\n  - type: table\n    name: V\n    groupBy: note.status\n`);
  expect(base.views[0].groupBy).toEqual({ property: "note.status", direction: "ASC" });
});

test("returns a safe empty base on malformed yaml", () => {
  const base = parseBase(":\n::\n  - broken");
  expect(base.views).toHaveLength(1);
  expect(base.views[0].type).toBe("table");
});

test("kanban view type is preserved as-is", () => {
  const base = parseBase(`views:\n  - type: kanban\n    name: Board\n`);
  expect(base.views[0].type).toBe("kanban");
});

test("kanban view with groupBy parses groupBy correctly", () => {
  const base = parseBase(`views:\n  - type: kanban\n    name: Board\n    groupBy: note.status\n`);
  expect(base.views[0].type).toBe("kanban");
  expect(base.views[0].groupBy).toEqual({ property: "note.status", direction: "ASC" });
});

test("cards view with cardContent: body parses to cardContent === 'body'", () => {
  const base = parseBase(`views:\n  - type: cards\n    name: Todos\n    cardContent: body\n`);
  expect(base.views[0].type).toBe("cards");
  expect(base.views[0].cardContent).toBe("body");
});

test("cards view with cardContent: properties parses to cardContent === 'properties'", () => {
  const base = parseBase(`views:\n  - type: cards\n    name: Notes\n    cardContent: properties\n`);
  expect(base.views[0].cardContent).toBe("properties");
});

test("cards view without cardContent leaves it undefined", () => {
  const base = parseBase(`views:\n  - type: cards\n    name: Cards\n`);
  expect(base.views[0].cardContent).toBeUndefined();
});

test("cards view with unknown cardContent value leaves it undefined", () => {
  const base = parseBase(`views:\n  - type: cards\n    name: Cards\n    cardContent: something-else\n`);
  expect(base.views[0].cardContent).toBeUndefined();
});

test("kanban view: columns: [...] parses into a string array", () => {
  const base = parseBase(`views:\n  - type: kanban\n    name: Board\n    groupBy: status\n    columns: [todo, reading, done]\n`);
  expect(base.views[0].groupOrder).toEqual(["todo", "reading", "done"]);
});

test("properties.hidden parses to a boolean flag", () => {
  const base = parseBase(`properties:\n  order:\n    hidden: true\n  status:\n    displayName: Status\n    hidden: false\nviews:\n  - type: table\n    name: V\n`);
  expect(base.properties?.order?.hidden).toBe(true);
  // Anything other than true (missing / false / non-bool) is normalised to undefined.
  expect(base.properties?.status?.hidden).toBeUndefined();
  expect(base.properties?.status?.displayName).toBe("Status");
});

test("map view: type, lat/lng keys, zoom, center parse", () => {
  const base = parseBase(`views:\n  - type: map\n    name: Atlas\n    lat: latitude\n    lng: longitude\n    zoom: 6\n    center: { lat: 40.7, lng: -74 }\n`);
  expect(base.views[0].type).toBe("map");
  expect(base.views[0].lat).toBe("latitude");
  expect(base.views[0].lng).toBe("longitude");
  expect(base.views[0].zoom).toBe(6);
  expect(base.views[0].center).toEqual({ lat: 40.7, lng: -74 });
});

test("parses chart view fields", () => {
  const cfg = parseBase(`views:\n  - type: heatmap\n    name: HM\n    x: date\n    y: glasses\n    aggregate: avg\n    bin: week\n`);
  const v = cfg.views[0];
  expect(v.type).toBe("heatmap");
  expect(v.x).toBe("date");
  expect(v.y).toBe("glasses");
  expect(v.aggregate).toBe("avg");
  expect(v.bin).toBe("week");
});

test("parses chart fields at top level of a type:base note (flat persistence)", () => {
  const { config } = parseBaseFile(`---\ntype: base\nview: bar\nx: day\ny: count\naggregate: sum\nbin: month\n---\n`, { name: "T", path: "T.md" });
  const v = config.views[0];
  expect(v.type).toBe("bar");
  expect(v.x).toBe("day");
  expect(v.y).toBe("count");
  expect(v.aggregate).toBe("sum");
  expect(v.bin).toBe("month");
});

test("promotes top-level flashcards field bindings into the default view (flat persistence)", () => {
  const { config } = parseBaseFile(
    `---\ntype: base\nview: flashcards\nfrontField: term\nbackField: definition\ndueField: due\neaseField: ease\nintervalField: interval\n---\n`,
    { name: "T", path: "T.md" },
  );
  const v = config.views[0];
  expect(v.type).toBe("flashcards");
  expect(v.frontField).toBe("term");
  expect(v.backField).toBe("definition");
  expect(v.dueField).toBe("due");
  expect(v.easeField).toBe("ease");
  expect(v.intervalField).toBe("interval");
});

test("rejects invalid chart enum values", () => {
  const cfg = parseBase(`views:\n  - type: bar\n    name: B\n    aggregate: median\n    bin: quarter\n`);
  expect(cfg.views[0].aggregate).toBeUndefined();
  expect(cfg.views[0].bin).toBeUndefined();
});

// ── Per-base declared properties (`properties:` in LIST form) ─────────────────────────

test("list-form properties declares the base's own property set in order", () => {
  const base = parseBase(`
properties:
  - status
  - name: priority
    type: number
    default: 1
  - name: description
    displayName: Notes
views:
  - type: table
    name: V
`);
  expect(base.declaredProperties).toEqual(["status", "priority", "description"]);
  expect(base.properties?.status).toEqual({ displayName: undefined, hidden: undefined, type: undefined, default: undefined });
  expect(base.properties?.priority?.type).toBe("number");
  expect(base.properties?.priority?.default).toBe(1);
  expect(base.properties?.description?.displayName).toBe("Notes");
});

test("map-form properties never sets declaredProperties (classic metadata semantics)", () => {
  const base = parseBase(`properties:\n  status:\n    displayName: Status\n  order:\n    hidden: true\nviews:\n  - type: table\n    name: V\n`);
  expect(base.declaredProperties).toBeUndefined();
  expect(base.properties?.status?.displayName).toBe("Status");
  expect(base.properties?.order?.hidden).toBe(true);
});

test("map-form properties now also tolerates type/default as metadata", () => {
  const base = parseBase(`properties:\n  price:\n    type: number\n    default: 0\nviews:\n  - type: table\n    name: V\n`);
  expect(base.declaredProperties).toBeUndefined();
  expect(base.properties?.price?.type).toBe("number");
  expect(base.properties?.price?.default).toBe(0);
});

test("list-form entries: unknown type drops to undefined, falsey defaults are kept, null default is not", () => {
  const base = parseBase(`
properties:
  - name: done
    type: checkbox
    default: false
  - name: weird
    type: banana
    default: null
views:
  - type: table
    name: V
`);
  expect(base.properties?.done?.type).toBe("checkbox");
  expect(base.properties?.done?.default).toBe(false);
  expect(base.properties?.weird?.type).toBeUndefined();
  expect(base.properties?.weird?.default).toBeUndefined();
});

test("list-form entries without a usable name are skipped; duplicates keep the first", () => {
  const base = parseBase(`
properties:
  - ""
  - name: ""
  - 42
  - name: status
    default: Todo
  - status
views:
  - type: table
    name: V
`);
  expect(base.declaredProperties).toEqual(["status"]);
  expect(base.properties?.status?.default).toBe("Todo");
});

test("an empty properties list keeps declaredProperties undefined", () => {
  const base = parseBase(`properties: []\nviews:\n  - type: table\n    name: V\n`);
  expect(base.declaredProperties).toBeUndefined();
  expect(base.properties).toBeUndefined();
});

test("list-form properties parses inside a type:base file's frontmatter", () => {
  const { config } = parseBaseFile(
    `---\ntype: base\nproperties:\n  - status\n  - name: worktree\n    type: text\nviews:\n  - type: kanban\n    name: Board\n    groupBy: status\n---\n`,
    { name: "B", path: "B.md" },
  );
  expect(config.declaredProperties).toEqual(["status", "worktree"]);
  expect(config.properties?.worktree?.type).toBe("text");
});
