/** Dropdown: an input-styled trigger with an ASCII caret, opening a PopoverList. */
export interface SelectOption { id: string | number; label: React.ReactNode; }
export interface SelectProps {
  options: SelectOption[];
  value?: string | number;
  placeholder?: string;
  onChange?: (id: string | number) => void;
  className?: string;
}
export declare function Select(props: SelectProps): JSX.Element;
