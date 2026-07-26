# UI kit — Bismuth (ASCII direction)

An interactive recreation of the Bismuth desktop app in the ASCII/terminal direction.
Open `index.html`.

**Structure** — one persistent shell, six switchable views:

| File | Surface |
|---|---|
| `Shell.jsx` | Window frame: top strip, vault rail, main pane, right tab rail, status bar. |
| `GraphView.jsx` | Knowledge graph — ASCII field, provenance layers, 2D/3D, resolution zoom. |
| `EditorView.jsx` | Note editor — frontmatter, ruled prose, callout, task list, ASCII figure. |
| `BasesView.jsx` | `reading.base` — ASCII table with statuses, stars, progress meters. |
| `CalendarView.jsx` | Month / week / day spans. |
| `ChatView.jsx` | Agent session — context, ASCII edge-growth chart, prompt composer. |
| `DaemonView.jsx` | Daemon inbox — proposal cards with confidence meters and an ASCII diff. |

**Interactions that work:** tab rail (collapse/expand, switch view), vault tree selection,
calendar span switcher, graph provenance layers, 2D/3D, resolution zoom (scroll), pan (drag),
theme scope switching.

**Reference:** `app/src/App.tsx` for structure; `Bismuth ASCII - App.dc.html` at the project
root is the full-fidelity working prototype this kit abbreviates.
