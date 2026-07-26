/** Colored dot, optionally with its word. Never a pill — statuses are dot + word. */
export declare const STATUS_COLOR: Record<string, string>;
export declare function statusColor(s: string): string;
export interface StatusDotProps { color?: string; status?: string; }
export declare function StatusDot(props: StatusDotProps): JSX.Element;
export interface StatusTextProps { status: string; }
export declare function StatusText(props: StatusTextProps): JSX.Element;
