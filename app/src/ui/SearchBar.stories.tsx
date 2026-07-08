// Visual spec for <SearchBar> — the leading-icon input used by the command palette,
// quick switcher, and Find panels.
//
// Props: value + onInput (controlled), placeholder?, onEnter? / onKeyDown? (the
// latter wins — for list-navigating search boxes), leadingIcon? (default "Search"),
// autofocus?, children (trailing adornments — toggles/buttons rendered after the
// input), class? / inputClass? / inputStyle?.
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createSignal, type JSX } from "solid-js";
import { SearchBar } from "./SearchBar";
import { Chip } from "./Chip";

const meta = {
  title: "UI/SearchBar",
  component: SearchBar,
  parameters: { layout: "centered" },
} satisfies Meta<typeof SearchBar>;

export default meta;
type Story = StoryObj<typeof meta>;

function Controlled(props: { initial?: string; placeholder?: string; leadingIcon?: string; children?: JSX.Element }) {
  const [v, setV] = createSignal(props.initial ?? "");
  return (
    <div style={{ width: "320px" }}>
      <SearchBar value={v()} onInput={setV} placeholder={props.placeholder} leadingIcon={props.leadingIcon}>
        {props.children}
      </SearchBar>
    </div>
  );
}

/** Empty, showing the default "Search" icon + placeholder. */
export const Placeholder: Story = {
  render: () => <Controlled placeholder="Search notes…" />,
};

/** With a typed value. */
export const Filled: Story = {
  render: () => <Controlled initial="meeting notes" placeholder="Search notes…" />,
};

/** A custom leading icon (e.g. the quick switcher uses a different glyph per mode). */
export const CustomLeadingIcon: Story = {
  render: () => <Controlled leadingIcon="Command" placeholder="Type a command…" />,
};

/** Trailing adornments after the input — the Find panel's match-case/whole-word/regex
 *  chip toggles. */
export const WithTrailingChips: Story = {
  render: () => {
    const [matchCase, setMatchCase] = createSignal(false);
    const [wholeWord, setWholeWord] = createSignal(true);
    return (
      <Controlled initial="TODO" placeholder="Find…">
        <Chip icon="CaseSensitive" selected={matchCase()} onClick={() => setMatchCase((v) => !v)} title="Match case" />
        <Chip icon="Check" selected={wholeWord()} onClick={() => setWholeWord((v) => !v)} title="Whole word" />
        <Chip icon="Regex" title="Regex" />
      </Controlled>
    );
  },
};
