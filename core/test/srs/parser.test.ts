import { test, expect } from "bun:test";
import { parseCards, deckPathsFromTags } from "../../src/srs/parser";

test("single-line basic card", () => {
  const cards = parseCards("Capital of France::Paris");
  expect(cards.length).toBe(1);
  expect(cards[0].type).toBe("single-basic");
  expect(cards[0].front).toBe("Capital of France");
  expect(cards[0].back).toBe("Paris");
  expect(cards[0].subCount).toBe(1);
  expect(cards[0].inlineSchedule).toBe(true);
});

test("single-line reversed card has 2 sub-cards", () => {
  const cards = parseCards("dog:::perro");
  expect(cards.length).toBe(1);
  expect(cards[0].type).toBe("single-reversed");
  expect(cards[0].subCount).toBe(2);
  expect(cards[0].front).toBe("dog");
  expect(cards[0].back).toBe("perro");
});

test("does not treat ::: as ::", () => {
  const cards = parseCards("dog:::perro");
  expect(cards[0].type).toBe("single-reversed");
});

test("multi-line basic card", () => {
  const md = "What is the mitochondria?\n?\nThe powerhouse of the cell";
  const cards = parseCards(md);
  expect(cards.length).toBe(1);
  expect(cards[0].type).toBe("multi-basic");
  expect(cards[0].front).toBe("What is the mitochondria?");
  expect(cards[0].back).toBe("The powerhouse of the cell");
  expect(cards[0].inlineSchedule).toBe(false);
});

test("multi-line reversed card has 2 sub-cards", () => {
  const md = "Front line\n??\nBack line";
  const cards = parseCards(md);
  expect(cards[0].type).toBe("multi-reversed");
  expect(cards[0].subCount).toBe(2);
});

test("cloze with highlight, curly, and bold counts deletions", () => {
  const cards = parseCards("The ==sun== is a {{star}} and very **hot**");
  expect(cards.length).toBe(1);
  expect(cards[0].type).toBe("cloze");
  expect(cards[0].subCount).toBe(3);
});

test("blocks separated by blank lines parse independently", () => {
  const md = "a::b\n\nc::d";
  const cards = parseCards(md);
  expect(cards.length).toBe(2);
});

test("non-card blocks are ignored", () => {
  const md = "# Just a heading\n\nSome prose with no card markers.";
  expect(parseCards(md).length).toBe(0);
});

test("parses existing inline SR comment", () => {
  const cards = parseCards("a::b <!--SR:!2026-06-01,4,270-->");
  expect(cards[0].scheduling).toEqual([{ due: "2026-06-01", interval: 4, ease: 270 }]);
  expect(cards[0].front).toBe("a");
  expect(cards[0].back).toBe("b");
});

test("parses standalone SR comment after multi-line card", () => {
  const md = "Q\n?\nA\n<!--SR:!2026-06-01,4,270-->";
  const cards = parseCards(md);
  expect(cards[0].scheduling).toEqual([{ due: "2026-06-01", interval: 4, ease: 270 }]);
  expect(cards[0].back).toBe("A");
  expect(cards[0].scheduleLine).toBe(3);
});

test("deckPathsFromTags strips base tag and yields sub-deck path", () => {
  expect(deckPathsFromTags(["flashcards/math/algebra"])).toEqual(["math/algebra"]);
  expect(deckPathsFromTags(["flashcards"])).toEqual([""]);
  expect(deckPathsFromTags(["other", "flashcards/spanish"])).toEqual(["spanish"]);
});

test("note without any flashcards tag yields no deck paths", () => {
  expect(deckPathsFromTags(["projects", "todo"])).toEqual([]);
});
