// ABOUTME: Main MCP server implementation for Things3 integration
// ABOUTME: Handles tool registration and request routing

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  CallToolResult,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
// No legacy tool types needed anymore
import { ToolRegistry } from './base/tool-registry.js';
import { TodosTools } from './tools/todos.js';
import { ProjectTools } from './tools/projects.js';
import { AreaTools } from './tools/areas.js';
import { TagTools } from './tools/tags.js';
import { BulkTools } from './tools/bulk.js';
import { LogbookTools } from './tools/logbook.js';
import { SystemTools } from './tools/system.js';
import { createLogger } from './utils/logger.js';

/**
 * Run a tool and convert the outcome into an MCP CallToolResult.
 *
 * - Success: the handler's return value is serialized as JSON text content.
 * - Errors thrown while running the tool are returned as `isError: true`
 *   results, so the model sees the message and can self-correct (MCP spec:
 *   tool execution errors belong in the result, not in a JSON-RPC error).
 * - An unknown tool name is a protocol error (JSON-RPC -32602 InvalidParams).
 */
export async function callTool(
  registry: ToolRegistry,
  name: string,
  args: unknown,
): Promise<CallToolResult> {
  if (!registry.getHandler(name)) {
    throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${name}`);
  }

  try {
    const result = await registry.executeTool(name, args);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    return {
      isError: true,
      content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
    };
  }
}

export class Things3Server {
  private server: Server;
  private transport: StdioServerTransport;
  private logger = createLogger('things3');
  private registry: ToolRegistry;
  public todosTools: TodosTools;
  public projectTools: ProjectTools;
  public areaTools: AreaTools;
  public tagTools: TagTools;
  public bulkTools: BulkTools;
  public logbookTools: LogbookTools;
  public systemTools: SystemTools;

  constructor() {
    this.server = new Server(
      {
        name: 'things3-mcp',
        version: '0.2.0',
      },
      {
        capabilities: {
          tools: {},
        },
      },
    );

    this.transport = new StdioServerTransport();
    this.registry = new ToolRegistry();

    // Initialize tool handlers
    this.todosTools = new TodosTools();
    this.projectTools = new ProjectTools();
    this.areaTools = new AreaTools();
    this.tagTools = new TagTools();
    this.bulkTools = new BulkTools();
    this.logbookTools = new LogbookTools();
    this.systemTools = new SystemTools();

    this.registerTools();
  }

  private registerTools(): void {
    this.logger.info('Registering Things3 tools...');

    // Register refactored tools with the registry
    this.registry.registerTool(this.todosTools);
    this.registry.registerTool(this.projectTools);
    this.registry.registerTool(this.areaTools);
    this.registry.registerTool(this.tagTools);
    this.registry.registerTool(this.bulkTools);
    this.registry.registerTool(this.logbookTools);
    this.registry.registerTool(this.systemTools);

    // All tools are now refactored! No legacy tools remaining.

    // All tools are managed by the registry now
    const allTools = this.registry.getToolDefinitions();

    // Update server capabilities
    this.server.registerCapabilities({
      tools: Object.fromEntries(allTools.map((tool) => [tool.name, tool])),
    });

    // Register handler for tools/list request
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: allTools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      };
    });

    // Register the handler for all tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      return callTool(this.registry, name, args);
    });

    this.logger.info(`Registered ${this.registry.getToolCount()} tools via registry`);
    this.logger.info(`Total tools registered: ${allTools.length}`);
    this.logger.info('🎉 All tools successfully migrated to registry pattern!');
  }

  async start(): Promise<void> {
    await this.server.connect(this.transport);
  }

  async stop(): Promise<void> {
    await this.server.close();
  }
}
