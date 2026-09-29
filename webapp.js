/**
 * The map's backend. This is an MCP CLIENT — it spawns src/server.js and
 * talks to it exactly like Claude Desktop would, then re-exposes the real
 * tool results as plain REST endpoints the map's frontend JS can call.
 *
 * No LLM/API key needed: the search box directly maps to the search_startups
 * tool's filters (area/sector/stage/query) with no natural-language step —
 * a deliberate choice so this is fully demoable without any external service.
 */
import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = join(__dirname, "src", "server.js");

let mcpClient;
async function connect() {
  const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER_PATH] });
  const client = new Client({ name: "pune-startups-webapp", version: "1.0.0" });
  await client.connect(transport);
  console.log("[webapp] connected to MCP server");
  return client;
}

const app = express();
app.use(express.static(join(__dirname, "public")));

app.get("/api/health", (req, res) => res.json({ status: "ok", mcpConnected: Boolean(mcpClient) }));

app.get("/api/areas", async (req, res) => {
  try {
    const result = await mcpClient.callTool({ name: "list_areas", arguments: {} });
    res.json(result.structuredContent ?? {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/search", async (req, res) => {
  try {
    const { area, sector, stage, query } = req.query;
    const args = {};
    if (area) args.area = area;
    if (sector) args.sector = sector;
    if (stage) args.stage = stage;
    if (query) args.query = query;

    const result = await mcpClient.callTool({ name: "search_startups", arguments: args });
    res.json(result.structuredContent ?? { startups: [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/startup/:id", async (req, res) => {
  try {
    const result = await mcpClient.callTool({ name: "get_startup", arguments: { id: req.params.id } });
    if (result.isError) return res.status(404).json({ error: "Not found" });
    res.json(result.structuredContent ?? {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3200;
connect()
  .then((client) => {
    mcpClient = client;
    app.listen(PORT, () => console.log(`[webapp] listening on http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error("[webapp] failed to connect to MCP server:", err);
    process.exit(1);
  });
