/**
 * Note-editing surface — YAML frontmatter block plus ruled prose.
 *
 * @startingPoint section="Forms" subtitle="Frontmatter + ruled prose" viewport="700x260"
 */
export interface MarkdownFieldProps {
  /** Rendered as an aligned YAML block with a 2px accent left edge. */
  frontmatter?: Record<string, string | number>;
  className?: string;
  children?: React.ReactNode;
}
export declare function MarkdownField(props: MarkdownFieldProps): JSX.Element;
