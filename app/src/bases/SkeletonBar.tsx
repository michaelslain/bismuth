import styles from './SkeletonBar.module.css'

export type SkeletonBarProps = {
    class?: string
}

/** A single placeholder bar — the shared unit TableSkeleton and CardsSkeleton compose their
 *  silhouettes from. `class` layers on the caller's sizing (height/width/flex/margin). */
export function SkeletonBar(props: SkeletonBarProps) {
    return <div class={props.class ? `${styles.block} ${props.class}` : styles.block} />
}
