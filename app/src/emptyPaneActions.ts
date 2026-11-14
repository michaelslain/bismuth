// app/src/emptyPaneActions.ts
// What an empty pane offers, in order. Pure data: EmptyPane renders it, App routes each id into the
// pane it was picked in (App.tsx fillEmptyLeaf). No keybinding hints: each action fills its own
// pane, while the look-alike shortcuts act elsewhere (docs/settings/keybindings.md).
export type EmptyPaneAction = 'file' | 'chat' | 'terminal'

export const emptyPaneActions: {
    id: EmptyPaneAction
    /** The icon button's accessible name and hover tooltip. */
    label: string
    icon: string
}[] = [
    {
        id: 'file',
        label: 'open a file in this pane',
        icon: 'Search',
    },
    {
        id: 'chat',
        label: 'new chat in this pane',
        icon: 'MessageSquare',
    },
    {
        id: 'terminal',
        label: 'new terminal in this pane',
        icon: 'SquareTerminal',
    },
]
