// Visual spec for <FlashcardsView> — the spaced-repetition review UI. Unlike the other Bases
// views it takes a flat `rows: Row[]` (not a `ViewResult`) plus a `BaseConfig` whose
// `views[0]` carries the flashcards field config (frontField/backField/dueField/...). `rows`
// need real front/back/due columns, which `_baseFixtures`' curated dataset doesn't carry, so
// this story mints its own small deck (real FileMeta shape).
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import type { BaseConfig, Row } from "../../../core/src/bases/types";
import { FlashcardsView } from "./FlashcardsView";
import { saveSession } from "./flashcardsQueue";
import { todayISO, addDaysISO } from "../../../core/src/dates";

const meta = {
  title: "Bases/FlashcardsView",
  component: FlashcardsView,
  parameters: { layout: "padded" },
} satisfies Meta<typeof FlashcardsView>;

export default meta;
type Story = StoryObj<typeof meta>;

function cardRow(name: string, note: Record<string, unknown>): Row {
  return {
    file: { name, basename: name, path: `vocab/${name}.md`, folder: "vocab", ext: "md", size: 256, ctime: 0, mtime: 0, tags: [], links: [] },
    note,
    formula: {},
  };
}

const today = todayISO();
const DECK: Row[] = [
  cardRow("card-1", { front: "capital of France", back: "Paris", due: today }),
  cardRow("card-2", { front: "capital of Japan", back: "Tokyo", due: addDaysISO(today, -3) }), // overdue
  cardRow("card-3", { front: "capital of Kenya", back: "Nairobi", due: null }), // new card, always due
  cardRow("card-4", { front: "capital of Iceland", back: "Reykjavik", due: addDaysISO(today, 14) }), // future — excluded from the normal queue
];

const config: BaseConfig = { views: [{ type: "flashcards", name: "Vocabulary" }] };

/** Normal mode: only cards due today or earlier (3 of the 4 sample cards — the 14-days-out
 *  "Iceland" card is excluded until cram). */
export const Default: Story = {
  render: () => <FlashcardsView rows={DECK} config={config} onReviewed={() => {}} />,
};

// A distinct basePath keys the module-level session store (flashcardsQueue.ts's `sessions`
// map), so seeding `cram: true` there before mount is picked up by FlashcardsView's own
// `loadSession()` call on render — the same restore path a real tab-switch-and-back exercises,
// not a fabricated prop.
const CRAM_BASE_PATH = "stories/flashcards-cram-demo.md";
saveSession(CRAM_BASE_PATH, { cram: true, pos: 0, good: 0, hard: 0, easy: 0, retired: [] });

/** Cram mode (seeded via the real session store): reviews every card regardless of due date,
 *  including the future-dated "Iceland" card the normal queue excludes. */
export const CramMode: Story = {
  render: () => <FlashcardsView rows={DECK} config={config} basePath={CRAM_BASE_PATH} onReviewed={() => {}} />,
};
