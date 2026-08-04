// Visual spec for <CardsView> — the book-cover grid renderer (`cardContent: properties`, the
// default). Exercises `sampleViewResult` end to end: real rows, run through the real query
// engine (core/src/bases/query.ts `runView`), rendered by the real CardsView component.
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import type { Row } from "../../../core/src/bases/types";
import { CardsView } from "./CardsView";
import { sampleBaseConfig, sampleViewResult } from "../ui/_baseFixtures";

const meta = {
  title: "Bases/CardsView",
  component: CardsView,
  parameters: { layout: "padded" },
} satisfies Meta<typeof CardsView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Properties mode (default): generated text covers (gradient + spine), status word + tags
 *  in the meta row. */
export const Default: Story = {
  render: () => <CardsView result={sampleViewResult()} config={sampleBaseConfig()} />,
};

// A tiny inline placeholder "cover" — a flat rect, not a design token — so the image-cover
// path (`image:`) has a real, self-contained src to load with no network dependency.
const COVER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="360"><rect width="100%" height="100%" fill="#5b7c99"/></svg>`;
const PLACEHOLDER_COVER = `data:image/svg+xml,${encodeURIComponent(COVER_SVG)}`;

/** Build a full-shaped `Partial<Row>` for a "book" — the fixture's own row rows don't carry
 *  cover art, so this story mints its own small dataset (real FileMeta shape) rather than
 *  reaching into `_baseFixtures`' unexported row builder. */
function bookRow(name: string, note: Record<string, unknown>): Partial<Row> {
  return {
    file: { name, basename: name, path: `reading/${name}.md`, folder: "reading", ext: "md", size: 512, ctime: 0, mtime: 0, tags: [], links: [] },
    note,
  };
}

/** `image:` configured — real cover art replaces the generated text cover; title/author move
 *  into the body row below (per cards.md: an image cover means title/author aren't overlaid).
 *  One row has no `cover` value, so it falls back to the generated text cover — both paths
 *  visible at once. */
export const WithCoverImages: Story = {
  render: () => {
    const views = [
      {
        type: "cards" as const,
        name: "Reading List",
        image: "cover",
        order: ["file.name", "note.author", "note.status", "note.rating"],
      },
    ];
    const rows: Partial<Row>[] = [
      bookRow("The Fifth Season", { author: "N. K. Jemisin", status: "Doing", rating: 5, cover: PLACEHOLDER_COVER }),
      bookRow("Piranesi", { author: "Susanna Clarke", status: "Todo", rating: 4, cover: PLACEHOLDER_COVER }),
      bookRow("A Fire Upon the Deep", { author: "Vernor Vinge", status: "Done", rating: 4 }), // no cover -> text fallback
    ];
    return <CardsView result={sampleViewResult(rows, { views })} config={sampleBaseConfig({ views })} />;
  },
};
