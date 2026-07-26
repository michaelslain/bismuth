// Visual spec for <AsciiTree> — the vault file tree drawn with typed ASCII connectors
// ("|--" / "`--"), one surface glyph per row, hover wash, active-row accent.
//
// Props: rows (id, label, depth?, last?, glyph?, meta?), activeId?, onSelect?, class?.
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createSignal } from "solid-js";
import { AsciiTree, type AsciiTreeRow } from "./AsciiTree";
import { Row } from "../_storyKit";

const meta = {
  title: "UI/Ascii/AsciiTree",
  parameters: { layout: "centered" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const vaultRows: AsciiTreeRow[] = [
  { id: "journal", label: "journal/", glyph: "▸" },
  { id: "j15", label: "2029-09-15", glyph: "✎", depth: 1 },
  { id: "j16", label: "2029-09-16", glyph: "✎", depth: 1, last: true },
  { id: "reading", label: "reading/", glyph: "▸" },
  { id: "quotes", label: "quotes/", glyph: "▸", depth: 1 },
  { id: "q1", label: "borges", glyph: "✎", depth: 2, last: true },
  { id: "books", label: "books", glyph: "▤", depth: 1, last: true, meta: "(12)" },
  { id: "bismuth", label: "bismuth.base", glyph: "▤", last: true },
];

/** A vault tree with an active row, hover wash, and click-to-select wired up. */
export const Vault: Story = {
  render: () => {
    const [active, setActive] = createSignal("j15");
    return (
      <Row label="Vault tree">
        <AsciiTree rows={vaultRows} activeId={active()} onSelect={setActive} />
      </Row>
    );
  },
};

/** Depth 0–3 with alternating last/not-last, to eyeball the connector shapes. */
export const Depths: Story = {
  render: () => (
    <Row label="Depths 0-3">
      <AsciiTree
        rows={[
          { id: "d0", label: "root", depth: 0 },
          { id: "d1", label: "child", depth: 1 },
          { id: "d1l", label: "last child", depth: 1, last: true },
          { id: "d2", label: "grandchild", depth: 2 },
          { id: "d2l", label: "last grandchild", depth: 2, last: true },
          { id: "d3", label: "great-grandchild", depth: 3 },
          { id: "d3l", label: "last great-grandchild", depth: 3, last: true },
        ]}
      />
    </Row>
  ),
};

/** Rows with right-aligned meta counts. */
export const WithMeta: Story = {
  render: () => (
    <Row label="With meta">
      <AsciiTree
        rows={[
          { id: "a", label: "projects/", glyph: "▸", meta: "(5)" },
          { id: "b", label: "archive/", glyph: "▸", depth: 1, last: true, meta: "(128)" },
        ]}
      />
    </Row>
  ),
};
