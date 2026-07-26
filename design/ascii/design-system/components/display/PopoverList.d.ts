/**
 * Floating list surface for menus, the ⌘O switcher and the ⌘K palette.
 *
 * @startingPoint section="Display" subtitle="Floating command list" viewport="700x220"
 */
export interface PopoverListProps { label?: React.ReactNode; style?: React.CSSProperties; className?: string; children?: React.ReactNode; }
export declare function PopoverList(props: PopoverListProps): JSX.Element;
