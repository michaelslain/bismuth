// app/src/editor/keepaliveSave.ts
//
// The `fetch` a page-unload flush makes has to survive the page going away — `keepalive: true`
// is what does that — but the pre-fix version of this PUT also omitted the owner token header
// every other write in api.ts carries. On an owner-gated vault (any vault marking content
// chat-only/hidden) that 403s silently: the request goes out, the tab is already closing so
// nothing can observe the response, and the last edit before close is simply never written.
//
// Pulled out of Editor.tsx so the request shape — body, headers, keepalive — is one plain object
// a test can inspect without a DOM or a real `fetch`.

import { ownerTokenHeaders } from '../api'

export function keepaliveSaveInit(path: string, contents: string): RequestInit {
    return {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            ...ownerTokenHeaders(),
        },
        body: JSON.stringify({ path, contents }),
        keepalive: true,
    }
}
