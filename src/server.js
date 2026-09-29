/**
 * stdio entrypoint — an MCP host (Claude Desktop, or this project's own
 * webapp.js backend) launches this directly as `node src/server.js`.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./createServer.js";

const { server } = createServer();
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[mcp-pune-startups] server running on stdio");
