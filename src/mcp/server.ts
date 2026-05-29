/**
 * videoclaw MCP server — exposes read-only project introspection to
 * MCP-aware agent hosts (Claude Code, Codex, Cursor, Antigravity).
 *
 * Transport: stdio. Boot via `vclaw mcp serve`.
 *
 * Tools (all read-only):
 *  - list_projects
 *  - get_project_status
 *  - get_artifacts
 *  - get_event_log
 *  - list_provider_routes
 *
 * Writes go through the CLI, not MCP — per the agent-integration
 * research, the CLI is the deterministic action surface; MCP is for
 * live-state queries.
 *
 * Implementation note: we use the low-level `Server` + `setRequestHandler`
 * API (not the high-level `McpServer.registerTool`) so we can declare tool
 * input schemas as plain JSON Schema rather than coupling to a specific
 * Zod major version. The exported request schemas (ListToolsRequestSchema /
 * CallToolRequestSchema) are stable across the 1.x SDK line.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  listProjectsTool,
  getProjectStatusTool,
  getArtifactsTool,
  getEventLogTool,
  listProviderRoutesTool,
} from './tools.js';

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

const rootProp = {
  root: {
    type: 'string',
    description:
      'Workspace root directory (defaults to the server process cwd).',
  },
} as const;

const slugProp = {
  slug: {
    type: 'string',
    description: 'Project slug (the directory name under projects/).',
  },
} as const;

const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'list_projects',
    description:
      'List every videoclaw project in the workspace with its ops status, score, and stage progress.',
    inputSchema: {
      type: 'object',
      properties: { ...rootProp },
      additionalProperties: false,
    },
    handler: (args) =>
      listProjectsTool({ root: args.root as string | undefined }),
  },
  {
    name: 'get_project_status',
    description:
      'Get the full status report for one project: current stage, checkpoint states, and storyboardReviewState.',
    inputSchema: {
      type: 'object',
      properties: { ...slugProp, ...rootProp },
      required: ['slug'],
      additionalProperties: false,
    },
    handler: (args) =>
      getProjectStatusTool({
        slug: args.slug as string,
        root: args.root as string | undefined,
      }),
  },
  {
    name: 'get_artifacts',
    description:
      "Read all canonical JSON artifacts under a project's artifacts/ directory, keyed by artifact name.",
    inputSchema: {
      type: 'object',
      properties: { ...slugProp, ...rootProp },
      required: ['slug'],
      additionalProperties: false,
    },
    handler: (args) =>
      getArtifactsTool({
        slug: args.slug as string,
        root: args.root as string | undefined,
      }),
  },
  {
    name: 'get_event_log',
    description:
      "Read a project's append-only event timeline (events.jsonl). Pass limit to cap to the most recent N events.",
    inputSchema: {
      type: 'object',
      properties: {
        ...slugProp,
        ...rootProp,
        limit: {
          type: 'integer',
          minimum: 1,
          description: 'Return only the most recent N events.',
        },
      },
      required: ['slug'],
      additionalProperties: false,
    },
    handler: (args) =>
      getEventLogTool({
        slug: args.slug as string,
        root: args.root as string | undefined,
        limit: args.limit as number | undefined,
      }),
  },
  {
    name: 'list_provider_routes',
    description:
      'List the provider routes (veo-useapi, seedance-direct, runway-useapi, dreamina-useapi, veo-direct) and their current availability.',
    inputSchema: {
      type: 'object',
      properties: { ...rootProp },
      additionalProperties: false,
    },
    handler: (args) =>
      listProviderRoutesTool({ root: args.root as string | undefined }),
  },
];

export function buildMcpServer(): Server {
  const server = new Server(
    { name: 'videoclaw', version: '3.0.0-alpha.1' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = TOOL_DEFINITIONS.find(
      (candidate) => candidate.name === request.params.name,
    );
    if (!tool) {
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              code: 'unknown_tool',
              message: `Unknown tool '${request.params.name}'.`,
            }),
          },
        ],
      };
    }
    try {
      const args = (request.params.arguments ?? {}) as Record<string, unknown>;
      const result = await tool.handler(args);
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(result, null, 2) },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ code: 'tool_error', message }),
          },
        ],
      };
    }
  });

  return server;
}

export async function startMcpServer(): Promise<void> {
  const server = buildMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Server runs until stdin closes.
}
