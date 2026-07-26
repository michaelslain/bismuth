/**
 * Search entry with a typed prompt lead. Used by the ⌘O switcher, ⌘K palette,
 * and the chat composer.
 *
 * @startingPoint section="Forms" subtitle="Prompt-led search input" viewport="700x90"
 */
export interface SearchBarProps {
  value?: string;
  placeholder?: string;
  /** The prompt character. ">" for search and chat; "⌘O" surfaces use ">" too. */
  lead?: string;
  onChange?: (value: string) => void;
  trailing?: React.ReactNode;
  className?: string;
}
export declare function SearchBar(props: SearchBarProps): JSX.Element;
