/**
 * Mutually exclusive button row. Segments butt together and share one border;
 * labels are UPPERCASE chrome, never bracketed.
 *
 * @startingPoint section="Core" subtitle="Mutually exclusive chrome switcher" viewport="700x100"
 */
export interface SegmentedOption<T> { id: T; label: React.ReactNode; title?: string; }
export interface SegmentedToggleProps<T> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (id: T) => void;
  size?: "sm" | "md" | "lg";
  className?: string;
}
export declare function SegmentedToggle<T>(props: SegmentedToggleProps<T>): JSX.Element;
