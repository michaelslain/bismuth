/**
 * Hairline surface card — no shadow in flow. `proposal` marks a daemon suggestion
 * with the 2px accent left edge (one of only two places that edge is used).
 *
 * @startingPoint section="Display" subtitle="Hairline card / daemon proposal" viewport="700x180"
 */
export interface CardProps {
  /** Inverse-video eyebrow: LINK, PRUNE, RECALL. */
  label?: React.ReactNode;
  /** Right-aligned micro meta, usually a timestamp. */
  meta?: React.ReactNode;
  proposal?: boolean;
  className?: string;
  children?: React.ReactNode;
}
export declare function Card(props: CardProps): JSX.Element;
