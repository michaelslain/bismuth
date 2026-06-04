import { splitProps, type JSX } from "solid-js";
import "./ui.css";

export type TextInputProps = {
  value: string;
  onInput: (value: string) => void;
  /** Render a multi-line `<textarea>` instead of a single-line `<input>`. */
  multiline?: boolean;
  class?: string;
} & Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "value" | "onInput" | "class">;

/**
 * The standard single- or multi-line text field. Shares the `.ui-input` chrome
 * (surface fill, soft border, accent focus ring) with every other form control so
 * inputs/selects look identical. Pass `type="date"`/`"time"` etc. through `rest`.
 */
export function TextInput(props: TextInputProps) {
  const [local, rest] = splitProps(props, ["value", "onInput", "multiline", "class"]);
  const cls = () => `ui-input ${local.class ?? ""}`;
  if (local.multiline) {
    return (
      <textarea
        class={cls()}
        value={local.value}
        onInput={(e) => local.onInput(e.currentTarget.value)}
        {...(rest as JSX.TextareaHTMLAttributes<HTMLTextAreaElement>)}
      />
    );
  }
  return (
    <input
      class={cls()}
      value={local.value}
      onInput={(e) => local.onInput(e.currentTarget.value)}
      {...rest}
    />
  );
}
