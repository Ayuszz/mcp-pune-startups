# mcp-pune-startups

An interactive map of Pune's tech hubs, backed by an MCP (Model Context Protocol) server. Search or filter, and pins for matching startups plot live on a real map of the city.

**Data honesty note:** all 15 companies are real, gathered via web search (sources listed in `data/startups.json`'s `_sources` field, and per-company where available). Two confidence levels are tracked and shown in the UI itself:
- **✓ verified address** (FirstCry, OneCard/FPL Technologies, MindTickle) — real, sourced office addresses
- **≈ approximate area** (the rest) — real companies, genuinely Pune-based, but I couldn't verify their exact office address in the time available, so they're placed at a plausible real Pune tech-hub area as a visual approximation, not a confirmed location

Funding figures and stages change — re-verify before quoting any of this anywhere serious. Swapping in a live data API later only means changing `loadData()` in `src/createServer.js`; nothing else needs to change.

---

## Why MCP, and not just a normal REST backend?

This project could have been built as a plain Express app that reads `startups.json` directly. Instead, the data and search logic live behind an **MCP server** — a small, self-contained process that exposes a fixed set of *tools* (`search_startups`, `list_areas`, `get_startup`) and one *resource* (`startup://{id}`) over a standard protocol, rather than as ad-hoc REST routes baked into the web app.

The point of doing it that way: an MCP server doesn't know or care who's calling it. The exact same `src/server.js` process can be:
- driven by `webapp.js` (a plain Express backend, acting as an **MCP client**) to power this map, with zero AI involved, or
- pointed at directly from **Claude Desktop** (or any other MCP-compatible AI client) as a tool source, letting an LLM call `search_startups`/`get_startup` itself and reason over real results, or
- swapped onto a completely different frontend later (a CLI, a Slack bot, a different UI) without touching the server at all, because none of that logic is entangled with Express routing.

In other words: the "brain" (data access + business logic) and the "mouth" (however a caller talks to it) are fully decoupled. That separation is the entire reason MCP exists, and this project is built to actually demonstrate it rather than just claim it.

---

## Full architecture

```text
┌─────────────────────────────────────────────────────────────────┐
│  Browser  (public/index.html)                                   │
│  - Leaflet.js map + a results-list side panel                   │
│  - Plain fetch() calls to a REST API — no AI, no LLM             │
└───────────────────────────────┬─────────────────────────────────┘
                                 │  GET /api/search?sector=fintech&area=baner&query=...
                                 │  GET /api/areas
                                 │  GET /api/startup/:id
                                 │  GET /api/health
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│  webapp.js   —  Express server, and an MCP CLIENT                │
│                                                                   │
│  On boot:                                                        │
│    1. Spawns `node src/server.js` as a CHILD PROCESS              │
│    2. Opens an MCP "stdio" connection to it (StdioClientTransport)│
│    3. Keeps that one connection alive for the process lifetime    │
│                                                                   │
│  On each HTTP request:                                           │
│    - Translates query params into an MCP tool call                │
│      (client.callTool({ name: "search_startups", arguments }))    │
│    - Reads back result.structuredContent (real JSON, not text)    │
│    - Sends it to the browser as a normal JSON response            │
└───────────────────────────────┬─────────────────────────────────┘
                                 │  MCP protocol messages over stdin/stdout
                                 │  (JSON-RPC 2.0 under the hood)
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│  src/server.js  —  MCP SERVER, stdio transport                   │
│  - Creates a StdioServerTransport                                 │
│  - Hands it to the McpServer instance from createServer.js        │
│  - Blocks forever, reading/writing MCP frames on stdin/stdout      │
└───────────────────────────────┬─────────────────────────────────┘
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│  src/createServer.js  —  the actual MCP server definition         │
│                                                                   │
│  Tools registered on the McpServer instance:                      │
│    • search_startups(area?, sector?, stage?, query?)               │
│        → filters data/startups.json in memory, attaches each      │
│          matching startup's real area coordinates                 │
│    • list_areas()                                                 │
│        → returns the 9 Pune areas this dataset covers             │
│    • get_startup(id)                                              │
│        → full record for one startup, or an MCP error result      │
│                                                                   │
│  Resource registered:                                             │
│    • startup://{id}   — same data, addressable as a URI, for       │
│      MCP clients that prefer resource-style access over tool calls│
│                                                                   │
│  Every tool returns TWO things in its result:                     │
│    - content: a human-readable text summary (for an LLM/human)    │
│    - structuredContent: the real JSON (for a programmatic caller) │
│  webapp.js reads structuredContent directly — it never re-parses  │
│  the text summary. That's the correct MCP pattern when the caller │
│  needs actual data rather than a description of data.             │
└───────────────────────────────┬─────────────────────────────────┘
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│  data/startups.json  —  the data layer                            │
│  - 9 real Pune areas with real lat/lng coordinates                 │
│  - 15 real startups, each tagged with sector/stage/area/           │
│    locationConfidence/source                                      │
│  - Loaded once and cached in memory (loadData() in createServer.js)│
│  - This is the ONLY file you'd change to plug in a live data       │
│    source later (a startup directory API, a real database) —      │
│    every layer above it just calls loadData() and doesn't know     │
│    or care where the array came from                              │
└─────────────────────────────────────────────────────────────────┘
```

### Why a child process and stdio, specifically

MCP defines a few transport options. This project uses the **stdio transport**, the simplest and most common one: the client spawns the server as a subprocess and the two talk by writing newline-delimited JSON-RPC messages to each other's stdin/stdout. No network port, no HTTP server on the MCP side at all.

This is exactly how Claude Desktop itself launches MCP servers — when you configure an MCP server in Claude Desktop's settings, it does precisely what `webapp.js` does here: spawns your server binary and talks to it over stdio. That's deliberate — it means `src/server.js` in this repo is not a toy reimplementation of "MCP-like" behavior, it's a real MCP server that Claude Desktop (or any other MCP host) could point at directly, completely independent of this project's own web app.

### Why `structuredContent` matters

An MCP tool result is designed primarily for an LLM to read — hence every tool also returns a `content` array with a plain-English text summary ("FirstCry (ecommerce, Public) — Sangamvadi: India's largest baby..."). That's fine for an AI client, which reasons over text.

But `webapp.js` is not an AI — it's a plain Express server that needs real, structured data to serialize as JSON for the map. Re-parsing the text summary to pull out lat/lng and sector would be fragile and pointless. Instead every tool here also attaches `structuredContent`, the actual JSON object, and `webapp.js` reads that field directly. This is the difference between building something that merely "uses MCP" as a buzzword versus actually understanding what MCP tool results are supposed to contain and consuming them correctly.

---

## Step-by-step: what happens on a single search

Walking through one concrete request end to end — a user types "fintech" in the search box and hits Search:

1. **Browser (`public/index.html`)** — the `search()` function reads the sector dropdown, area dropdown, and free-text query, builds a query string, and calls `fetch("/api/search?sector=fintech")`.

2. **Express (`webapp.js`)** — the `/api/search` route handler receives the request, pulls `sector` out of `req.query`, and builds an MCP tool-call arguments object: `{ sector: "fintech" }`.

3. **MCP client call** — `webapp.js` calls `mcpClient.callTool({ name: "search_startups", arguments: { sector: "fintech" } })`. Under the hood, the MCP SDK serializes this into a JSON-RPC request and writes it to the child process's stdin.

4. **MCP server (`src/server.js` / `createServer.js`)** — the running `node src/server.js` process reads that JSON-RPC frame off its stdin, routes it to the registered `search_startups` tool handler, and runs the handler:
   - Calls `loadData()`, which returns the cached, already-parsed `startups.json` (parsed once on first call, reused after that)
   - Filters the `startups` array down to entries where `sector === "fintech"`
   - For each match, looks up its `area` id in the `areas` array and attaches the real `{ lat, lng, name }` for that area
   - Builds a text summary for `content`, and puts the enriched array into `structuredContent: { startups: [...] }`
   - Returns that result object, which the SDK serializes back into a JSON-RPC response and writes to stdout

5. **Back in `webapp.js`** — `callTool()`'s promise resolves with that result. The route handler does `res.json(result.structuredContent ?? { startups: [] })`, sending the real JSON straight through to the browser as an HTTP response.

6. **Browser again** — `search()`'s `fetch` call resolves, `plot(data.startups)` runs:
   - Clears any existing map markers
   - For each startup, adds a `L.circleMarker` at its area's coordinates, colored by sector, with a popup showing name/sector/stage/description and a confidence badge (✓ verified vs ≈ approximate)
   - Rebuilds the side-panel list of result cards (clicking a card re-centers the map on that startup and opens its popup — this exists because pins are small and can be genuinely hard to click directly at some zoom levels)
   - Calls `map.fitBounds(...)` so the view auto-zooms to fit all the matching pins

No LLM, no API key, and no network call beyond the one `fetch` touches this flow at all — the entire round trip (browser → Express → MCP stdio → tool handler → back) is deterministic and fully demoable offline once `npm install` has run.

---

## What each MCP tool does

| Tool | Purpose |
|---|---|
| `search_startups` | Filter by `area`, `sector`, `stage`, and/or free-text `query`; returns each result with its area's real map coordinates attached |
| `list_areas` | Lists the Pune areas this dataset covers |
| `get_startup` | Full detail for one startup by id |

Each tool returns both a human-readable text summary (`content`) and structured JSON (`structuredContent`) — the map's backend reads the structured form directly rather than re-parsing text, which is the correct MCP pattern when a caller needs real data, not just a description of it.

---

## Setup

```bash
npm install
npm start
```

Open **http://localhost:3200**.

## Deployment

Runs as a single long-lived Node process (`npm start`, which starts `webapp.js` — this in turn spawns the MCP server as its own child process on boot). Because it's a persistent process rather than a stateless function, it's deployed as a normal web service (e.g. Render) rather than as serverless functions. `webapp.js` already reads `process.env.PORT`, so no code changes are needed for most hosts — just point the platform at `npm install` as the build command and `npm start` as the start command.

---

## A real bug found and fixed while building this

**Symptom:** the map loaded, "15 results" showed correctly, the MCP connection was confirmed working — but the map itself showed a blank/placeholder world view with no tiles and no visible pins, and zero tile requests were firing at all.

**Diagnosis:** checked the browser console (no errors) and network requests (literally zero requests to the tile server — meaning Leaflet never even tried, ruling out a network/CORS problem). Checked the map container's actual computed size directly — it reported real dimensions after the fact. That pointed at a **timing** problem: `L.map("map")` reads its container's size once, immediately, at construction time. Inside a flexbox layout (`#map { flex: 1 }`), the container's final height isn't settled until the browser finishes a layout pass that happens right *after* the script that creates the map runs — so Leaflet was locking in a stale, effectively-zero size before the real layout existed, which broke both tile loading and the `fitBounds()` zoom calculation.

**Fix:** `setTimeout(() => map.invalidateSize(), 0)` right after creating the map, forcing Leaflet to re-measure on the next tick, once the real layout has settled. Also added a `window.addEventListener("resize", ...)` for the same reason if the window is resized later.

**How it was confirmed fixed:** called `map.invalidateSize()` manually in the browser console first to prove that was really the cause (tiles and pins appeared instantly), then applied the fix in code and reloaded the page fresh to confirm it works from a clean load, not just as a one-off console patch.

---

## What I'd add next

- A real data source (a startup directory API, or a small curated database) in place of the static JSON file
- Clustering for when many pins overlap at low zoom
- A "search near me" mode using the browser's geolocation
- A second MCP transport (Streamable HTTP, following the pattern used in `mcp-knowledge-base`) so the server could also run standalone without `webapp.js` spawning it
