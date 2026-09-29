/**
 * MCP server factory for the Pune startups map.
 *
 * Data is SAMPLE/ILLUSTRATIVE (see data/startups.json's "_note") — real Pune
 * area coordinates, fictional startup entries. Swapping in a real data
 * source later (a live API, a database) only means changing loadData()
 * below; the tool definitions and everything that calls them stay the same.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = process.env.STARTUPS_DATA_FILE || join(__dirname, "..", "data", "startups.json");

let cachedData = null;
async function loadData() {
  if (cachedData) return cachedData;
  const raw = await readFile(DATA_PATH, "utf8");
  cachedData = JSON.parse(raw);
  return cachedData;
}

function matchesQuery(startup, query) {
  const q = query.toLowerCase();
  return (
    startup.name.toLowerCase().includes(q) ||
    startup.description.toLowerCase().includes(q) ||
    startup.sector.toLowerCase().includes(q)
  );
}

export function createServer() {
  const server = new McpServer({ name: "pune-startups-map", version: "1.0.0" });

  server.registerTool(
    "search_startups",
    {
      title: "Search startups",
      description:
        "Search sample startups across Pune's tech hubs. Filter by area, sector, funding " +
        "stage, and/or a free-text query matched against name/description/sector. " +
        "Returns each startup with its area's real map coordinates, ready to plot.",
      inputSchema: {
        area: z.string().optional().describe("Area id from list_areas, e.g. 'baner'"),
        sector: z
          .enum(["fintech", "healthtech", "saas", "ecommerce", "ai-ml", "logistics"])
          .optional()
          .describe("Startup sector to filter by"),
        stage: z.string().optional().describe("Funding stage, e.g. 'Seed', 'Series A'"),
        query: z.string().optional().describe("Free-text search over name/description/sector"),
      },
    },
    async ({ area, sector, stage, query }) => {
      const data = await loadData();
      const areaById = Object.fromEntries(data.areas.map((a) => [a.id, a]));

      let results = data.startups;
      if (area) results = results.filter((s) => s.area === area);
      if (sector) results = results.filter((s) => s.sector === sector);
      if (stage) results = results.filter((s) => s.stage.toLowerCase() === stage.toLowerCase());
      if (query) results = results.filter((s) => matchesQuery(s, query));

      const withLocation = results.map((s) => ({ ...s, location: areaById[s.area] }));

      return {
        content: [
          {
            type: "text",
            text:
              withLocation.length === 0
                ? "No matching startups found."
                : withLocation
                    .map(
                      (s) =>
                        `${s.name} (${s.sector}, ${s.stage}) — ${s.location.name}: ${s.description}`
                    )
                    .join("\n"),
          },
        ],
        // structuredContent lets a programmatic caller (like our map backend)
        // get the real data back without re-parsing the text summary above.
        structuredContent: { startups: withLocation },
      };
    }
  );

  server.registerTool(
    "list_areas",
    {
      title: "List Pune areas covered",
      description: "Lists the Pune tech-hub areas this dataset covers, with their real coordinates.",
      inputSchema: {},
    },
    async () => {
      const data = await loadData();
      return {
        content: [
          {
            type: "text",
            text: data.areas.map((a) => `${a.name}: ${a.description}`).join("\n"),
          },
        ],
        structuredContent: { areas: data.areas },
      };
    }
  );

  server.registerTool(
    "get_startup",
    {
      title: "Get startup details",
      description: "Get full details for one startup by id.",
      inputSchema: { id: z.string().describe("Startup id, e.g. 's1'") },
    },
    async ({ id }) => {
      const data = await loadData();
      const startup = data.startups.find((s) => s.id === id);
      if (!startup) {
        return { content: [{ type: "text", text: `No startup found with id ${id}` }], isError: true };
      }
      const location = data.areas.find((a) => a.id === startup.area);
      return {
        content: [{ type: "text", text: `${startup.name}: ${startup.description}` }],
        structuredContent: { ...startup, location },
      };
    }
  );

  server.registerResource(
    "startup",
    new ResourceTemplate("startup://{id}", {
      list: async () => {
        const data = await loadData();
        return {
          resources: data.startups.map((s) => ({
            uri: `startup://${s.id}`,
            name: s.name,
            mimeType: "application/json",
          })),
        };
      },
    }),
    { title: "Startup", description: "A single startup's full details as JSON." },
    async (uri, { id }) => {
      const data = await loadData();
      const startup = data.startups.find((s) => s.id === id);
      if (!startup) throw new Error(`No startup found with id ${id}`);
      const location = data.areas.find((a) => a.id === startup.area);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify({ ...startup, location }, null, 2),
          },
        ],
      };
    }
  );

  return { server };
}
