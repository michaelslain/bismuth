import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeNote, readNote } from "../../src/files";
import { collectCards, collectDecks, dueCards, applyReview } from "../../src/srs/cards";

async function vaultWith(files: Record<string, string>): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "oa-srs-"));
  for (const [path, contents] of Object.entries(files)) {
    await writeNote(dir, path, contents);
  }
  return dir;
}

const TODAY = "2026-05-27";

test("collectCards finds cards only in notes tagged #flashcards", async () => {
  const vault = await vaultWith({
    "math.md": "#flashcards/math\n\n2+2::4\n\ndog:::perro",
    "notes.md": "no tag here\n\nshould::not appear",
  });
  const cards = await collectCards(vault);
  expect(cards.length).toBe(3);
  expect(cards.every((c) => c.deck === "math")).toBe(true);
  expect(cards.every((c) => c.notePath === "math.md")).toBe(true);
});

test("reversed sub-cards swap question/answer", async () => {
  const vault = await vaultWith({ "a.md": "#flashcards\n\ndog:::perro" });
  const cards = await collectCards(vault);
  const fwd = cards.find((c) => c.id.endsWith("::0"))!;
  const rev = cards.find((c) => c.id.endsWith("::1"))!;
  expect(fwd.question).toBe("dog");
  expect(fwd.answer).toBe("perro");
  expect(rev.question).toBe("perro");
  expect(rev.answer).toBe("dog");
});

test("new cards are due; future cards are not", async () => {
  const vault = await vaultWith({
    "a.md": "#flashcards\n\nnew::card\n\nscheduled::later <!--SR:!2099-01-01,5,250-->",
  });
  const due = await dueCards(vault, TODAY);
  expect(due.length).toBe(1);
  expect(due[0].question).toBe("new");
});

test("collectDecks aggregates totals and due counts", async () => {
  const vault = await vaultWith({
    "m.md": "#flashcards/math\n\na::b\n\nc::d <!--SR:!2099-01-01,5,250-->",
    "s.md": "#flashcards/spanish\n\ndog:::perro",
  });
  const decks = await collectDecks(vault, TODAY);
  const math = decks.find((d) => d.name === "math")!;
  const spanish = decks.find((d) => d.name === "spanish")!;
  expect(math.total).toBe(2);
  expect(math.due).toBe(1);
  expect(spanish.total).toBe(2);
  expect(spanish.due).toBe(2);
});

test("applyReview writes an inline SR comment to a single-line card", async () => {
  const vault = await vaultWith({ "a.md": "#flashcards\n\n2+2::4" });
  const cards = await collectCards(vault);
  await applyReview(vault, cards[0].id, "good", TODAY);
  const text = await readNote(vault, "a.md");
  expect(text).toContain("2+2::4 <!--SR:!2026-05-28,1,250-->");
});

test("applyReview appends standalone SR comment to a multi-line card", async () => {
  const vault = await vaultWith({ "a.md": "#flashcards\n\nQ\n?\nA" });
  const cards = await collectCards(vault);
  await applyReview(vault, cards[0].id, "easy", TODAY);
  const text = await readNote(vault, "a.md");
  expect(text).toContain("Q\n?\nA\n<!--SR:!2026-05-31,4,270-->");
});

test("applyReview updates only the reviewed sub-card of a reversed card", async () => {
  const vault = await vaultWith({ "a.md": "#flashcards\n\ndog:::perro" });
  const cards = await collectCards(vault);
  const fwd = cards.find((c) => c.id.endsWith("::0"))!;
  await applyReview(vault, fwd.id, "good", TODAY);
  const text = await readNote(vault, "a.md");
  expect(text).toMatch(/<!--SR:!2026-05-28,1,250!/);
});

test("applyReview re-review updates existing comment in place (no duplication)", async () => {
  const vault = await vaultWith({ "a.md": "#flashcards\n\n2+2::4 <!--SR:!2020-01-01,1,250-->" });
  const cards = await collectCards(vault);
  await applyReview(vault, cards[0].id, "good", TODAY);
  const text = await readNote(vault, "a.md");
  const matches = text.match(/<!--SR:/g) || [];
  expect(matches.length).toBe(1);
  // good review of a 1-day card: interval = round(1 * 250/100) = 3, due = today + 3 = 2026-05-30
  expect(text).toContain("<!--SR:!2026-05-30,3,250-->");
});

test("cloze sub-cards hide one deletion each", async () => {
  const vault = await vaultWith({ "a.md": "#flashcards\n\nThe ==sun== is a {{star}}" });
  const cards = await collectCards(vault);
  expect(cards.length).toBe(2);
  const c0 = cards.find((c) => c.id.endsWith("::0"))!;
  const c1 = cards.find((c) => c.id.endsWith("::1"))!;
  expect(c0.question).toBe("The [...] is a star");
  expect(c0.answer).toBe("The sun is a star");
  expect(c1.question).toBe("The sun is a [...]");
  expect(c1.answer).toBe("The sun is a star");
});

test("applyReview throws when the expected question no longer matches", async () => {
  const vault = await vaultWith({ "a.md": "#flashcards\n\n2+2::4" });
  const cards = await collectCards(vault);
  await expect(
    applyReview(vault, cards[0].id, "good", TODAY, "totally different question"),
  ).rejects.toThrow(/content changed/);
});

test("applyReview succeeds when the expected question matches", async () => {
  const vault = await vaultWith({ "a.md": "#flashcards\n\n2+2::4" });
  const cards = await collectCards(vault);
  await applyReview(vault, cards[0].id, "good", TODAY, cards[0].question);
  const text = await readNote(vault, "a.md");
  expect(text).toContain("<!--SR:!2026-05-28,1,250-->");
});
