import { expect, test, describe } from "bun:test";
import { splitCardBody, splitCard } from "./cardBodySplit";

// Every case must satisfy the round-trip invariant: prefix + body === raw.
function roundtrips(raw: string, title?: string): ReturnType<typeof splitCardBody> {
  const split = splitCardBody(raw, title);
  expect(split.prefix + split.body).toBe(raw);
  return split;
}

describe("splitCardBody", () => {
  test("strips frontmatter into the prefix", () => {
    const raw = "---\ntags: [task]\n---\nsome body\n";
    const { prefix, body } = roundtrips(raw);
    expect(prefix).toBe("---\ntags: [task]\n---\n");
    expect(body).toBe("some body\n");
  });

  test("no frontmatter → whole input is the body", () => {
    const raw = "just a note\nwith lines\n";
    const { prefix, body } = roundtrips(raw);
    expect(prefix).toBe("");
    expect(body).toBe(raw);
  });

  test("strips a leading H1 that matches the title (frontmatter + blank line)", () => {
    const raw = "---\ntags: [task]\n---\n\n# My Note\n\nthe real body\n";
    const { prefix, body } = roundtrips(raw, "My Note");
    expect(body).toBe("the real body\n");
    expect(prefix).toBe("---\ntags: [task]\n---\n\n# My Note\n\n");
  });

  test("strips a leading H1 matching the title with no frontmatter", () => {
    const raw = "# My Note\n\nbody here\n";
    const { body } = roundtrips(raw, "My Note");
    expect(body).toBe("body here\n");
  });

  test("keeps a leading H1 that does NOT match the title", () => {
    const raw = "# Different Heading\n\nbody\n";
    const { prefix, body } = roundtrips(raw, "My Note");
    expect(prefix).toBe("");
    expect(body).toBe(raw);
  });

  test("title match is whitespace-insensitive", () => {
    const raw = "#   My Note  \nbody\n";
    const { body } = roundtrips(raw, "My Note");
    expect(body).toBe("body\n");
  });

  test("does not strip an H2 even when its text matches the title", () => {
    const raw = "## My Note\nbody\n";
    const { prefix, body } = roundtrips(raw, "My Note");
    expect(prefix).toBe("");
    expect(body).toBe(raw);
  });

  test("no title given → only frontmatter is stripped, heading stays", () => {
    const raw = "---\na: 1\n---\n# My Note\nbody\n";
    const { prefix, body } = roundtrips(raw);
    expect(prefix).toBe("---\na: 1\n---\n");
    expect(body).toBe("# My Note\nbody\n");
  });

  test("body that is only a matching title heading → empty editable body", () => {
    const raw = "---\na: 1\n---\n# My Note\n";
    const { body } = roundtrips(raw, "My Note");
    expect(body).toBe("");
  });

  test("empty input", () => {
    const { prefix, body } = roundtrips("", "My Note");
    expect(prefix).toBe("");
    expect(body).toBe("");
  });

  test("CRLF line endings round-trip and strip", () => {
    const raw = "---\r\na: 1\r\n---\r\n# My Note\r\n\r\nbody\r\n";
    const { body } = roundtrips(raw, "My Note");
    expect(body).toBe("body\r\n");
  });
});

// Every case must satisfy: prefix + body + suffix === raw.
function tasksSplit(raw: string, title?: string): ReturnType<typeof splitCard> {
  const split = splitCard(raw, title, "tasks");
  expect(split.prefix + split.body + split.suffix).toBe(raw);
  return split;
}

describe("splitCard (tasks mode)", () => {
  test("body mode is unchanged: whole body, empty suffix", () => {
    const raw = "---\na: 1\n---\n# T\n\nprose\n\n- [ ] one\n";
    const s = splitCard(raw, "T", "body");
    expect(s.prefix + s.body + s.suffix).toBe(raw);
    expect(s.suffix).toBe("");
    expect(s.body).toBe("prose\n\n- [ ] one\n");
  });

  test("narrows to the checklist: prose before → prefix, content after → suffix", () => {
    const raw = "---\na: 1\n---\n# T\n\nLock the roadmap first.\n\n- [ ] one\n- [x] two\n\nSee [[Notes]].\n";
    const { prefix, body, suffix } = tasksSplit(raw, "T");
    expect(body).toBe("- [ ] one\n- [x] two");
    expect(prefix.endsWith("Lock the roadmap first.\n\n")).toBe(true);
    expect(suffix).toBe("\n\nSee [[Notes]].\n");
  });

  test("contiguous checklist with no surrounding prose → body is just the tasks", () => {
    const raw = "---\na: 1\n---\n# T\n\n- [ ] one\n- [/] two\n- [x] three\n";
    const { body, suffix } = tasksSplit(raw, "T");
    expect(body).toBe("- [ ] one\n- [/] two\n- [x] three");
    expect(suffix).toBe("\n");
  });

  test("interspersed lines between first and last task stay in the editable region", () => {
    const raw = "- [ ] a\n## section\n- [ ] b\n";
    const { prefix, body, suffix } = tasksSplit(raw);
    expect(prefix).toBe("");
    expect(body).toBe("- [ ] a\n## section\n- [ ] b");
    expect(suffix).toBe("\n");
  });

  test("indented sub-tasks are recognized as task lines", () => {
    const raw = "- [ ] parent\n  - [ ] child\n";
    const { body } = tasksSplit(raw);
    expect(body).toBe("- [ ] parent\n  - [ ] child");
  });

  test("no task lines → falls back to editing the whole body (empty suffix)", () => {
    const raw = "---\na: 1\n---\n# T\n\njust prose, no tasks\n";
    const { body, suffix } = tasksSplit(raw, "T");
    expect(body).toBe("just prose, no tasks\n");
    expect(suffix).toBe("");
  });
});
