// ABOUTME: Builds the Things3 MCP server (SDK v2 McpServer) and registers every tool
// ABOUTME: Input validation, unknown-tool and thrown-error handling are done by the SDK

import { McpServer } from '@modelcontextprotocol/server';
import { BaseTool } from './base/tool-base.js';
import { TodosTools } from './tools/todos.js';
import { ProjectTools } from './tools/projects.js';
import { AreaTools } from './tools/areas.js';
import { TagTools } from './tools/tags.js';
import { BulkTools } from './tools/bulk.js';
import { LogbookTools } from './tools/logbook.js';
import { SystemTools } from './tools/system.js';
import { VERSION } from './version.js';

export const SERVER_INSTRUCTIONS = `Controls the Things 3 task manager on this Mac.

- Ids: get to-do, project, area and tag ids from the list/get tools; never guess them. Project ids are not to-do ids (use projects_* tools for projects).
- Dates: use YYYY-MM-DD for a calendar day. whenDate also accepts today, tomorrow, evening, anytime, someday; deadline also accepts today, tomorrow. Pass null to clear a date in update tools.
- Writes are verified: a tool only reports success after reading the change back from Things3. If it reports an error, nothing (or only the listed part) was changed.
- Updates (update, complete, move, change dates) need THINGS3_AUTH_TOKEN in the server environment; without it they are refused.
- Tags must exist before they can be assigned (tags_create); unknown tags are reported, not silently dropped.
- todos_delete / projects_delete move items to the Trash. projects_complete also completes the project's open to-dos.`;

export function defaultTools(): BaseTool[] {
  return [
    new TodosTools(),
    new ProjectTools(),
    new AreaTools(),
    new TagTools(),
    new BulkTools(),
    new LogbookTools(),
    new SystemTools(),
  ];
}

/**
 * Create a server instance. `tools` can be replaced in tests.
 */
export function createServer(tools: BaseTool[] = defaultTools()): McpServer {
  const server = new McpServer(
    {
      name: 'things3-mcp',
      title: 'Things 3',
      version: VERSION,
      description: 'Read and manage to-dos, projects, areas and tags in Things 3 (macOS).',
    },
    {
      capabilities: { tools: {} },
      instructions: SERVER_INSTRUCTIONS,
    },
  );

  for (const tool of tools.flatMap((t) => t.getToolDefinitions())) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      },
      async (args) => {
        const result = await tool.handler(args);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      },
    );
  }

  return server;
}
