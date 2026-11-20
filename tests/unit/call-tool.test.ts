// ABOUTME: Unit tests for converting tool handler outcomes into MCP CallToolResult
// ABOUTME: Covers success wrapping, execution errors (isError) and unknown tools (protocol error)

import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { ToolRegistry } from '../../src/base/tool-registry';
import { BaseTool, ToolRegistration } from '../../src/base/tool-base';
import { callTool } from '../../src/server';

function registryWith(registrations: ToolRegistration[]): ToolRegistry {
  const registry = new ToolRegistry();
  registry.registerTool({ getToolRegistrations: () => registrations } as unknown as BaseTool);
  return registry;
}

function tool(name: string, handler: ToolRegistration['handler']): ToolRegistration {
  return { name, handler, toolDefinition: { name, inputSchema: { type: 'object' } } };
}

describe('callTool', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('wraps a handler result as JSON text content', async () => {
    const registry = registryWith([tool('ok', async () => ({ projects: [{ id: '1' }] }))]);

    const result = await callTool(registry, 'ok', {});

    expect(result.isError).toBeUndefined();
    expect(result.content).toEqual([
      { type: 'text', text: JSON.stringify({ projects: [{ id: '1' }] }, null, 2) },
    ]);
  });

  it('returns a thrown handler error as an isError result the model can read', async () => {
    const registry = registryWith([
      tool('boom', async () => {
        throw new Error('Project with id "x" not found');
      }),
    ]);

    const result = await callTool(registry, 'boom', { id: 'x' });

    expect(result).toEqual({
      isError: true,
      content: [{ type: 'text', text: 'Project with id "x" not found' }],
    });
  });

  it('handles non-Error throwables', async () => {
    const registry = registryWith([
      tool('weird', async () => {
        throw 'plain string failure';
      }),
    ]);

    const result = await callTool(registry, 'weird', {});

    expect(result).toEqual({
      isError: true,
      content: [{ type: 'text', text: 'plain string failure' }],
    });
  });

  it('rejects an unknown tool with a JSON-RPC InvalidParams protocol error', async () => {
    const registry = registryWith([]);

    const call = callTool(registry, 'no_such_tool', {});

    await expect(call).rejects.toBeInstanceOf(McpError);
    await expect(call).rejects.toMatchObject({ code: ErrorCode.InvalidParams });
  });
});
