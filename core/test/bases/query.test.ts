import { test, expect } from "bun:test";
import { runView, canonicalId } from "../../src/bases/query";
import type { BaseConfig, Row } from "../../src/bases/types";

function row(name: string, note: Record<string, unknown>): Row {
  return {
    file: { name, basename: name, path: `${name}.md`, folder: "", ext: "md", size: 1, ctime: 0, mtime: 0, tags: (note.tags as string[]) ?? [], links: [] },
    note,
    formula: {},
  };
}

const rows: Row[] = [
  row("alpha", { status: "open", price: 10, age: 2, tags: ["book"] }),
  row("beta", { status: "done", price: 4, age: 1, tags: ["book"] }),
  row("gamma", { status: "open", price: 20, age: 4, tags: ["movie"] }),
];

const base: BaseConfig = {
  formulas: { ppu: "(price / age).toFixed(2)" },
  views: [
    {
      type: "table",
      name: "V",
      filters: 'status != "done"',
      order: ["file.name", "note.price", "formula.ppu"],
      sort: [{ property: "note.price", direction: "DESC" }],
      summaries: { "note.price": "Sum" },
    },
  ],
};

test("filters, computes formulas, sorts, resolves columns", () => {
  const res = runView(base, rows, 0);
  expect(res.columns).toEqual(["file.name", "note.price", "formula.ppu"]);
  const flat = res.groups[0].rows;
  expect(flat.map((r) => r.file.name)).toEqual(["gamma", "alpha"]); // price DESC, 'done' filtered out
  expect(flat[0].formula.ppu).toBe("5.00"); // 20/4
});

test("applies global + view filters with AND", () => {
  const b: BaseConfig = { filters: 'file.hasTag("book")', views: [{ type: "table", name: "V", filters: 'status == "open"', order: ["file.name"] }] };
  const res = runView(b, rows, 0);
  expect(res.groups[0].rows.map((r) => r.file.name)).toEqual(["alpha"]);
});

test("groups rows by a property", () => {
  const b: BaseConfig = { views: [{ type: "table", name: "V", order: ["file.name"], groupBy: { property: "note.status", direction: "ASC" } }] };
  const res = runView(b, rows, 0);
  const keys = res.groups.map((g) => g.key).sort();
  expect(keys).toEqual(["done", "open"]);
});

test("respects limit", () => {
  const b: BaseConfig = { views: [{ type: "table", name: "V", order: ["file.name"], limit: 1 }] };
  const res = runView(b, rows, 0);
  expect(res.groups[0].rows).toHaveLength(1);
});

test("computes Sum/Average/Min/Max/Count summaries", () => {
  const res = runView(base, rows, 0);
  expect(res.summaries["note.price"]).toBe("30"); // 10 + 20
});

test("auto-derives columns from frontmatter when order is absent", () => {
  const b: BaseConfig = { views: [{ type: "table", name: "V" }] };
  const res = runView(b, rows, 0);
  expect(res.columns[0]).toBe("file.name");
  expect(res.columns).toContain("note.status");
});

test("canonicalId normalizes bare frontmatter names to note.*", () => {
  expect(canonicalId("price")).toBe("note.price");
  expect(canonicalId("note.price")).toBe("note.price");
  expect(canonicalId("file.name")).toBe("file.name");
  expect(canonicalId("formula.ppu")).toBe("formula.ppu");
});

test("bare-id summary aligns with auto-derived note.* columns", () => {
  // order omitted -> columns derived as note.*, summary written with a bare id
  const b: BaseConfig = { views: [{ type: "table", name: "V", summaries: { price: "Sum" } }] };
  const res = runView(b, rows, 0);
  expect(res.columns).toContain("note.price");
  expect(res.summaries["note.price"]).toBe("34"); // 10 + 4 + 20 (no filter)
});

test("kanban with fixed columns keeps empty columns in declared order", () => {
  const b: BaseConfig = {
    views: [{
      type: "kanban",
      name: "Board",
      groupBy: { property: "note.status" },
      groupOrder: ["todo", "open", "done", "archived"],
    }],
  };
  const res = runView(b, rows, 0);
  expect(res.groups.map((g) => g.key)).toEqual(["todo", "open", "done", "archived"]);
  expect(res.groups[0].rows).toHaveLength(0);          // todo: empty (no data)
  expect(res.groups[1].rows.map((r) => r.file.name)).toEqual(["alpha", "gamma"]);
  expect(res.groups[3].rows).toHaveLength(0);          // archived: empty
});

test("kanban with fixed columns surfaces unexpected data keys as extras", () => {
  const b: BaseConfig = {
    views: [{
      type: "kanban",
      name: "Board",
      groupBy: { property: "note.status" },
      groupOrder: ["todo"],
    }],
  };
  const res = runView(b, rows, 0);
  // 'todo' first (declared, empty), then the two data keys in alpha order.
  expect(res.groups.map((g) => g.key)).toEqual(["todo", "done", "open"]);
});

test("properties.hidden drops the property from auto-derived columns", () => {
  // Bare-form hide.
  const b1: BaseConfig = {
    properties: { status: { hidden: true } },
    views: [{ type: "table", name: "V" }],
  };
  const res1 = runView(b1, rows, 0);
  expect(res1.columns).toContain("file.name");
  expect(res1.columns).toContain("note.price");
  expect(res1.columns).not.toContain("note.status");

  // Namespaced-form hide reads the same way.
  const b2: BaseConfig = {
    properties: { "note.price": { hidden: true } },
    views: [{ type: "table", name: "V" }],
  };
  const res2 = runView(b2, rows, 0);
  expect(res2.columns).not.toContain("note.price");
});

test("properties.hidden is overridden by an explicit view.order", () => {
  // The user wants `order`/`status` globally hidden, except this one table view
  // where they explicitly list status — that wins.
  const b: BaseConfig = {
    properties: { status: { hidden: true } },
    views: [{
      type: "table", name: "V",
      order: ["file.name", "note.price", "note.status"],
    }],
  };
  const res = runView(b, rows, 0);
  expect(res.columns).toEqual(["file.name", "note.price", "note.status"]);
});

test("hostThis flows into filters / formulas / groupBy as `this.*`", () => {
  // Embedded base: filter by `this.tier` from the host note's frontmatter.
  const b: BaseConfig = {
    formulas: { adj: "price * this.markup" },
    views: [{
      type: "table",
      name: "V",
      filters: "price >= this.minPrice",
      order: ["file.name", "formula.adj"],
    }],
  };
  const host = { minPrice: 10, markup: 2, tier: "open" };
  const res = runView(b, rows, 0, host);
  // Only alpha (price=10) and gamma (price=20) clear minPrice=10.
  expect(res.groups[0].rows.map((r) => r.file.name).sort()).toEqual(["alpha", "gamma"]);
  // Formula computed against host markup.
  const alpha = res.groups[0].rows.find((r) => r.file.name === "alpha")!;
  expect(alpha.formula.adj).toBe(20); // 10 * 2
});

// "Do Now" urgency buckets: a date formula grouped via formula.* — proves date
// arithmetic works in groupBy. Uses a string-literal duration (today() + "7d");
// note duration("7d") would NOT compose with + (it returns a number, not a Date).
test("urgency buckets via a date formula + groupBy formula.*", () => {
  function ymd(offsetDays: number): string {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + offsetDays);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  const taskRows: Row[] = [
    row("overdue", { description: "a", due: ymd(-3) }),
    row("soon", { description: "b", due: ymd(3) }),
    row("later", { description: "c", due: ymd(30) }),
    row("nodate", { description: "d" }),
  ];
  const cfg: BaseConfig = {
    formulas: {
      urgency: 'if(!due, "No date", if(date(due) < today(), "Overdue", if(date(due) <= today() + "7d", "This week", "Later")))',
    },
    views: [{ type: "list", name: "DoNow", groupBy: { property: "formula.urgency" } }],
  };
  const res = runView(cfg, taskRows, 0);
  const byKey = Object.fromEntries(res.groups.map((g) => [g.key, g.rows.map((r) => r.file.name)]));
  expect(byKey["Overdue"]).toEqual(["overdue"]);
  expect(byKey["This week"]).toEqual(["soon"]);
  expect(byKey["Later"]).toEqual(["later"]);
  expect(byKey["No date"]).toEqual(["nodate"]);
});

// duration() now composes with + (returns ms; Date + ms → shifted Date), so the
// natural `today() + duration("7d")` form buckets identically to the "7d" literal.
test("urgency buckets work with duration() too (composes with +)", () => {
  function ymd(offsetDays: number): string {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + offsetDays);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  const taskRows: Row[] = [
    row("overdue", { due: ymd(-3) }),
    row("soon", { due: ymd(3) }),
    row("later", { due: ymd(30) }),
  ];
  const cfg: BaseConfig = {
    formulas: {
      urgency: 'if(date(due) < today(), "Overdue", if(date(due) <= today() + duration("7d"), "This week", "Later"))',
    },
    views: [{ type: "list", name: "DoNow", groupBy: { property: "formula.urgency" } }],
  };
  const res = runView(cfg, taskRows, 0);
  const byKey = Object.fromEntries(res.groups.map((g) => [g.key, g.rows.map((r) => r.file.name)]));
  expect(byKey["Overdue"]).toEqual(["overdue"]);
  expect(byKey["This week"]).toEqual(["soon"]);
  expect(byKey["Later"]).toEqual(["later"]);
});

test("default group order is type-aware (numeric, not string-alphabetical)", () => {
  const r2 = row("a", { n: 2 });
  const r10 = row("b", { n: 10 });
  const r1 = row("c", { n: 1 });
  const cfg: BaseConfig = { views: [{ type: "table", name: "V", groupBy: { property: "note.n" } }] };
  const res = runView(cfg, [r10, r2, r1], 0);
  expect(res.groups.map((g) => g.key)).toEqual(["1", "2", "10"]); // numeric, not "1","10","2"
});

test("explicit columns order groups in a non-kanban (list) view", () => {
  const rows2: Row[] = [
    row("a", { bucket: "Later" }),
    row("b", { bucket: "Overdue" }),
    row("c", { bucket: "This week" }),
    row("d", { bucket: "Mystery" }), // not declared -> appended
  ];
  const cfg: BaseConfig = {
    views: [{ type: "list", name: "V", groupBy: { property: "note.bucket" }, groupOrder: ["Overdue", "This week", "Later"] }],
  };
  const res = runView(cfg, rows2, 0);
  expect(res.groups.map((g) => g.key)).toEqual(["Overdue", "This week", "Later", "Mystery"]);
});

test("non-kanban omits an empty declared group; kanban keeps it", () => {
  const rows3: Row[] = [row("a", { s: "todo" })];
  const listCfg: BaseConfig = {
    views: [{ type: "list", name: "V", groupBy: { property: "note.s" }, groupOrder: ["todo", "done"] }],
  };
  expect(runView(listCfg, rows3, 0).groups.map((g) => g.key)).toEqual(["todo"]); // "done" empty -> omitted
  const kanbanCfg: BaseConfig = {
    views: [{ type: "kanban", name: "V", groupBy: { property: "note.s" }, groupOrder: ["todo", "done"] }],
  };
  expect(runView(kanbanCfg, rows3, 0).groups.map((g) => g.key)).toEqual(["todo", "done"]); // "done" kept as drop target
});
