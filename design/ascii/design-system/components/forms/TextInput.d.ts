/** Text entry. Values and placeholders are both mono — the whole system is. */
export interface TextInputProps {
  multiline?: boolean;
  value?: string;
  placeholder?: string;
  onChange?: (value: string) => void;
  className?: string;
}
export declare function TextInput(props: TextInputProps): JSX.Element;
