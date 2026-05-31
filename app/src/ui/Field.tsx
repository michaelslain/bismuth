import { type JSX } from "solid-js";
import "./ui.css";

export type FieldProps = {
  label: JSX.Element;
  class?: string;
  children: JSX.Element;
};

/**
 * A label that wraps its control (label > span + control), the idiom repeated
 * across EventModal and BaseSettings (was .event-modal label / .srs-field /
 * .card-add-field). Pass `class` to keep a site-specific layout class.
 */
export function Field(props: FieldProps) {
  return (
    <label class={`ui-field ${props.class ?? ""}`}>
      <span>{props.label}</span>
      {props.children}
    </label>
  );
}
