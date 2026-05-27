---
name: run-three-brains-dev
description: Use when starting the Three Brains dev server for UI testing or development
---

# Run Three Brains Dev Server

## Overview
Launches the full stack (Tauri app + backend server) with hot reload. Automatically resolves vault and memory paths from known locations.

## Quick Start

```bash
cd /Users/michaelslain/Documents/dev/obsidian-alternative/app
OA_VAULT="/Users/michaelslain/Documents/library of alexandria" \
OA_MEMORY="$HOME/.claude-bot/memory" \
bun run dev
```

The frontend (Vite) runs on **http://localhost:1420/** (may vary if port in use)
The backend runs on **http://localhost:4321/**

## Environment Variables

**Required before running dev:**
- `OA_VAULT` — Path to vault directory (contains .md files)
  - Default location: `/Users/michaelslain/Documents/library of alexandria`
- `OA_MEMORY` — Path to Claude-bot memory directory
  - Default location: `~/.claude-bot/memory`

**If paths are different on your machine:** Update them in the command above

## Alternatives

**Frontend only (no backend):**
```bash
cd app && bun start
```

**Backend server standalone:**
```bash
bun run core/src/server.ts --vault /path/to/vault --memory /path/to/memory
```

## Testing the Connection

After server starts:
```bash
# Check backend is running
curl http://localhost:4321/graph | jq

# Check frontend is running
curl http://localhost:1420
```

## Common Issues

| Issue | Fix |
|-------|-----|
| Port 1420 already in use | Vite will auto-increment port; check terminal output for actual port |
| `OA_VAULT` not set error | Set env var before running: `export OA_VAULT="/path/to/vault"` |
| Server starts but no graph displays | Check vault directory exists and contains `.md` files |
