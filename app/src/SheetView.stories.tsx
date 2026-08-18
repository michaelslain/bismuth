// Visual spec for <SheetView> — the Univer spreadsheet surface behind a `.sheet` file. Unlike
// most storied components, SheetView takes NO data prop: it calls `api.read(props.path)` itself
// inside `onMount`, parses the result with `sheet/snapshot.ts`'s `parseSnapshot`, and only then
// dynamic-imports the (heavy, code-split) Univer chunk via `sheet/univerSheet.ts`'s
// `mountSheet()`. That IO dependency is why this component was previously considered too hard to
// story — with the shared fakeTransport (.storybook/preview.ts) now installed globally, `api.read`
// resolves against a plain in-memory Map, so this is an ordinary story: seed a `.sheet` file's
// TEXT (the real on-disk format — `JSON.stringify` of a Univer `IWorkbookData` snapshot) and
// mount SheetView at that path. SheetView's only other IO is `api.write` (debounced autosave) —
// no WebSocket, so nothing about it is Storybook-unfriendly once the transport is faked.
//
// `preview.ts`'s global fakeTransport is seeded from the shared bases fixture (_baseFixtures.ts's
// SAMPLE_ROWS), which has no `.sheet` files — so each story below layers its OWN
// `setTransport(fakeTransport({ files: {...} }))` on top before mounting, the same pattern
// Backlinks.stories.tsx and InboxPageView.stories.tsx use for a scoped fixture.
//
// The workbook fixture is a hand-built IWorkbookData/IWorksheetData/ICellData snapshot (shape
// read from @univerjs/core's `lib/types/sheets/typedef.d.ts`), with the handful of Univer enums
// it needs inlined as their literal values so this file doesn't import Univer at all — matching
// sheet/snapshot.ts's own "Univer-free" stance (it types WorkbookSnapshot as a plain
// `Record<string, unknown>` so parse/serialize unit-test under Bun with no canvas):
//   - `t: 1 | 2` = CellValueType.STRING / NUMBER
//   - `hidden`/`showGridlines`/`rightToLeft`: `0 | 1` = BooleanNumber.FALSE / TRUE
//   - `locale: "enUS"` = LocaleType.EN_US
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { SheetView } from './SheetView'
import { setTransport } from './api'
import { fakeTransport } from './ui/_fakeTransport'
import type { WorkbookSnapshot } from './sheet/snapshot'

const meta = {
    title: 'App/SheetView',
    component: SheetView,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof SheetView>

export default meta
type Story = StoryObj<typeof meta>

// Fixed px, not vh — see GraphView.stories.tsx's own note: the Storybook preview iframe is short
// with the Controls panel open, and SheetView (like `.graph-root`) fills its parent via a plain
// `width/height: 100%` on its own root div.
const STORY_H = '640px'

/** A tiny order-total sheet: a header row, two data rows with a per-row `Total` formula
 *  (`=B2*C2`), and a grand-total `SUM` formula — real cell content AND a real formula, not just
 *  a blank grid. */
function sampleWorkbook(): WorkbookSnapshot {
    const sheetId = 'sheet-01'
    return {
        id: 'story-workbook',
        name: 'Budget',
        appVersion: '0.25.0',
        locale: 'enUS',
        styles: {},
        sheetOrder: [sheetId],
        sheets: {
            [sheetId]: {
                id: sheetId,
                name: 'Sheet1',
                tabColor: '',
                hidden: 0,
                freeze: { xSplit: 0, ySplit: 0, startRow: 0, startColumn: 0 },
                rowCount: 20,
                columnCount: 10,
                defaultColumnWidth: 88,
                defaultRowHeight: 24,
                mergeData: [],
                cellData: {
                    0: {
                        0: { v: 'Item', t: 1 },
                        1: { v: 'Qty', t: 1 },
                        2: { v: 'Price', t: 1 },
                        3: { v: 'Total', t: 1 },
                    },
                    1: {
                        0: { v: 'Widget', t: 1 },
                        1: { v: 4, t: 2 },
                        2: { v: 2.5, t: 2 },
                        3: { v: 10, t: 2, f: '=B2*C2' },
                    },
                    2: {
                        0: { v: 'Gadget', t: 1 },
                        1: { v: 2, t: 2 },
                        2: { v: 9.99, t: 2 },
                        3: { v: 19.98, t: 2, f: '=B3*C3' },
                    },
                    3: {
                        0: { v: 'Grand total', t: 1 },
                        3: { v: 29.98, t: 2, f: '=SUM(D2:D3)' },
                    },
                },
                rowData: {},
                columnData: {},
                rowHeader: { width: 46, hidden: 0 },
                columnHeader: { height: 20, hidden: 0 },
                showGridlines: 1,
                rightToLeft: 0,
            },
        },
    }
}

/** Real cell content read back from a seeded `.sheet` file — the ordinary case: opening an
 *  existing spreadsheet note. */
export const Default: Story = {
    render: () => {
        setTransport(
            fakeTransport({
                files: { 'budget.sheet': JSON.stringify(sampleWorkbook()) },
            }),
        )
        return (
            <div style={{ height: STORY_H, width: '100%' }}>
                <SheetView path="budget.sheet" />
            </div>
        )
    },
}

/** A brand-new spreadsheet note: blank file text on disk, exactly what `note create` leaves.
 *  `parseSnapshot` maps blank text to `{}` (sheet/snapshot.ts's documented empty-text case), and
 *  `mountSheet` treats a `{}` snapshot as "fresh blank workbook" (its own `opts.data ?? {}`
 *  fallback) — so this exercises the same code path a truly new `.sheet` file takes, not a
 *  fabricated special case. */
export const Empty: Story = {
    render: () => {
        setTransport(fakeTransport({ files: { 'new.sheet': '' } }))
        return (
            <div style={{ height: STORY_H, width: '100%' }}>
                <SheetView path="new.sheet" />
            </div>
        )
    },
}
