/**
 * The canonical 46px view header: eyebrow crumb, meta, spacer, then controls.
 * Every content view has exactly one.
 *
 * @startingPoint section="Display" subtitle="46px view header" viewport="700x90"
 */
export interface ViewBarProps { className?: string; children?: React.ReactNode; }
export declare function ViewBar(props: ViewBarProps): JSX.Element;
export interface CrumbProps { label: React.ReactNode; meta?: React.ReactNode; }
export declare function Crumb(props: CrumbProps): JSX.Element;
export declare function ViewBarSpacer(): JSX.Element;
export interface VBtnProps { active?: boolean; title?: string; onClick?: (e: React.MouseEvent) => void; children?: React.ReactNode; }
export declare function VBtn(props: VBtnProps): JSX.Element;
