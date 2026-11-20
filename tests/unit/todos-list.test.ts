// ABOUTME: Unit tests for todos_list filtering in TodosTools (AppleScript bridge stubbed)
// ABOUTME: Ensures projectId/areaId/tags filters are applied instead of silently ignored

import { TodosTools } from '../../src/tools/todos';
import { Things3Error } from '../../src/types';

function toolsReturning(rows: unknown[]) {
  const tools = new TodosTools();
  const scripts: string[] = [];
  (tools as unknown as { bridge: unknown }).bridge = {
    ensureThings3Running: async () => true,
    execute: async (script: string) => {
      scripts.push(script);
      return JSON.stringify(rows);
    },
  };
  return { tools, scripts };
}

describe('TodosTools.listTodos filters', () => {
  it('queries the project when projectId is given', async () => {
    const { tools, scripts } = toolsReturning([{ id: '1', title: 'a', completed: false }]);

    await tools.listTodos({ projectId: 'P1' });

    expect(scripts[0]).toContain('to dos of project id "P1"');
  });

  it('queries the area when areaId is given', async () => {
    const { tools, scripts } = toolsReturning([]);

    await tools.listTodos({ areaId: 'A1' });

    expect(scripts[0]).toContain('to dos of area id "A1"');
  });

  it('rejects projectId and areaId together', async () => {
    const { tools } = toolsReturning([]);

    await expect(tools.listTodos({ projectId: 'P1', areaId: 'A1' })).rejects.toThrow(Things3Error);
  });

  it('keeps only to dos that have every requested tag', async () => {
    const { tools, scripts } = toolsReturning([
      { id: '1', title: 'both', completed: false, tags: ['work', 'urgent'] },
      { id: '2', title: 'one', completed: false, tags: ['work'] },
      { id: '3', title: 'none', completed: false, tags: [] },
    ]);

    const result = await tools.listTodos({ tags: ['work', 'urgent'] });

    expect(scripts[0]).toContain('forKey:"tags"');
    expect(result.map((t) => t.id)).toEqual(['1']);
  });

  it('applies pagination after filtering', async () => {
    const { tools } = toolsReturning([
      { id: '1', title: 'a', completed: false, tags: ['x'] },
      { id: '2', title: 'b', completed: false, tags: [] },
      { id: '3', title: 'c', completed: false, tags: ['x'] },
    ]);

    const result = await tools.listTodos({ tags: ['x'], offset: 1, limit: 1 });

    expect(result.map((t) => t.id)).toEqual(['3']);
  });
});
