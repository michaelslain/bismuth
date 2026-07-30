/**
 * The empty / all-done block. `art` takes an ASCII drawing — the system's
 * empty states are typed, never illustrated.
 */
export interface EmptyStateProps { title?: string; art?: string; className?: string; children?: React.ReactNode; }
export declare function EmptyState(props: EmptyStateProps): JSX.Element;
export declare function Loading(props: { children?: React.ReactNode }): JSX.Element;
