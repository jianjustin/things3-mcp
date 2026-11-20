// ABOUTME: Protocol-level tests: a real MCP client talks to the server over an in-memory transport
// ABOUTME: Covers tool listing (titles, annotations, schemas), errors, validation and server metadata

import { readFileSync } from 'fs';
import { join } from 'path';
import * as z from 'zod';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer, SERVER_INSTRUCTIONS } from '../../src/server';
import { BaseTool, ToolDefinition } from '../../src/base/tool-base';
import { READ_ONLY } from '../../src/base/annotations';

async function connect(tools?: BaseTool[]): Promise<{ client: Client; close: () => Promise<void> }> {
  const server = createServer(tools);
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

/** A tool class with hand-made definitions, so no AppleScript runs */
function fakeTools(definitions: ToolDefinition[]): BaseTool {
  return { getToolDefinitions: () => definitions } as unknown as BaseTool;
}

const READ_ONLY_TOOLS = [
  'todos_list',
  'todos_get',
  'projects_list',
  'projects_get',
  'areas_list',
  'tags_list',
  'logbook_search',
];

const DESTRUCTIVE_TOOLS = [
  'todos_update',
  'todos_delete',
  'projects_update',
  'projects_delete',
  'areas_delete',
  'tags_remove',
  'tags_delete',
  'bulk_move',
  'bulk_updateDates',
];

describe('MCP server (real tools, listing only)', () => {
  let consoleSpy: jest.SpyInstance;
  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'error').mockImplementation();
  });
  afterEach(() => consoleSpy.mockRestore());

  it('reports its version from package.json and sends instructions', async () => {
    const { client, close } = await connect();
    const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8'));

    expect(client.getServerVersion()).toMatchObject({ name: 'things3-mcp', version: pkg.version });
    expect(client.getInstructions()).toBe(SERVER_INSTRUCTIONS);
    await close();
  });

  it('lists 25 tools, each with a title, description and annotations', async () => {
    const { client, close } = await connect();
    const { tools } = await client.listTools();

    expect(tools).toHaveLength(25);
    for (const tool of tools) {
      expect(tool.title).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.annotations?.openWorldHint).toBe(false);
      expect(typeof tool.annotations?.readOnlyHint).toBe('boolean');
    }
    await close();
  });

  it('marks exactly the read-only and destructive tools', async () => {
    const { client, close } = await connect();
    const { tools } = await client.listTools();

    const readOnly = tools.filter((t) => t.annotations?.readOnlyHint).map((t) => t.name);
    const destructive = tools
      .filter((t) => !t.annotations?.readOnlyHint && t.annotations?.destructiveHint)
      .map((t) => t.name);

    expect(readOnly.sort()).toEqual([...READ_ONLY_TOOLS].sort());
    expect(destructive.sort()).toEqual([...DESTRUCTIVE_TOOLS].sort());
    await close();
  });

  it('publishes JSON Schemas with required fields and nullable dates', async () => {
    const { client, close } = await connect();
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((t) => [t.name, t]));

    expect(byName.get('todos_create')?.inputSchema.required).toEqual(['title']);
    const update = byName.get('todos_update')?.inputSchema.properties as Record<string, unknown>;
    expect(JSON.stringify(update['whenDate'])).toContain('null');
    const complete = byName.get('todos_complete')?.inputSchema.properties as Record<string, unknown>;
    expect(JSON.stringify(complete['ids'])).toContain('array');
    await close();
  });

  it('rejects invalid arguments before the tool runs', async () => {
    const { client, close } = await connect();

    const result = await client.callTool({ name: 'todos_get', arguments: {} });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toMatch(/Input validation error/);
    await close();
  });

  it('answers an unknown tool with a protocol error', async () => {
    const { client, close } = await connect();

    await expect(client.callTool({ name: 'no_such_tool', arguments: {} })).rejects.toThrow(
      /no_such_tool/,
    );
    await close();
  });
});

describe('MCP server (fake tools)', () => {
  const echo: ToolDefinition = {
    name: 'echo',
    title: 'Echo',
    description: 'Return the input',
    inputSchema: z.object({ value: z.string() }),
    annotations: READ_ONLY,
    handler: async (args: { value: string }) => ({ echoed: args.value }),
  };
  const boom: ToolDefinition = {
    name: 'boom',
    title: 'Boom',
    description: 'Always fails',
    inputSchema: z.object({}),
    annotations: READ_ONLY,
    handler: async () => {
      throw new Error('Project with id "x" not found');
    },
  };

  it('wraps a handler result as JSON text content', async () => {
    const { client, close } = await connect([fakeTools([echo, boom])]);

    const result = await client.callTool({ name: 'echo', arguments: { value: 'hi' } });

    expect(result.isError).toBeFalsy();
    expect(result.content).toEqual([
      { type: 'text', text: JSON.stringify({ echoed: 'hi' }, null, 2) },
    ]);
    await close();
  });

  it('returns a thrown error as an isError result with the message', async () => {
    const { client, close } = await connect([fakeTools([echo, boom])]);

    const result = await client.callTool({ name: 'boom', arguments: {} });

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: 'text', text: 'Project with id "x" not found' }]);
    await close();
  });
});
