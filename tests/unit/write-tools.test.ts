// ABOUTME: Unit tests for write tools: inputs are validated before writing and results verified after
// ABOUTME: AppleScript bridge and URL-scheme handler are stubbed; no real Things3 access

import { TodosTools } from '../../src/tools/todos';
import { ProjectTools } from '../../src/tools/projects';
import { BulkTools } from '../../src/tools/bulk';
import { urlSchemeHandler } from '../../src/utils/url-scheme';

type Handler = (script: string) => unknown;

const fastOpts = { timeoutMs: 30, intervalMs: 1, sleep: async () => undefined };

/** Wire a tool instance to a fake bridge that answers by script marker */
function stub<T extends object>(tool: T, handlers: Record<string, Handler>): T {
  const target = tool as unknown as { bridge: unknown; guardOptions: unknown };
  target.guardOptions = fastOpts;
  target.bridge = {
    ensureThings3Running: async () => true,
    execute: async (script: string) => {
      const marker = Object.keys(handlers).find((m) => script.includes(`things3-mcp:${m}`));
      if (!marker) throw new Error(`unexpected script: ${script.slice(0, 80)}`);
      return JSON.stringify(handlers[marker]!(script));
    },
  };
  return tool;
}

const todo = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  exists: true,
  kind: 'todo',
  status: 'open',
  title: 'T',
  notes: '',
  tags: [],
  ...extra,
});

describe('write tools', () => {
  const originalToken = process.env['THINGS3_AUTH_TOKEN'];
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env['THINGS3_AUTH_TOKEN'] = 'test-token';
    consoleSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    consoleSpy.mockRestore();
    if (originalToken === undefined) delete process.env['THINGS3_AUTH_TOKEN'];
    else process.env['THINGS3_AUTH_TOKEN'] = originalToken;
  });

  describe('todos_create', () => {
    it('returns the id of the newly created to-do, not an older one with the same title', async () => {
      const add = jest.spyOn(urlSchemeHandler, 'createTodo').mockResolvedValue();
      let created = false;
      add.mockImplementation(async () => {
        created = true;
      });
      const tools = stub(new TodosTools(), {
        findIdsByName: () => (created ? ['older', 'new'] : ['older']),
        readItemStates: () => [todo('new', { title: 'Buy milk' })],
      });

      const result = await tools.createTodo({ title: 'Buy milk' });

      expect(result).toMatchObject({ success: true, id: 'new' });
      expect(result.warnings).toBeUndefined();
    });

    it('fails instead of reporting success when the to-do never appears', async () => {
      jest.spyOn(urlSchemeHandler, 'createTodo').mockResolvedValue();
      const tools = stub(new TodosTools(), { findIdsByName: () => ['older'] });

      await expect(tools.createTodo({ title: 'Buy milk' })).rejects.toThrow(/could not confirm/);
    });

    it('rejects an unknown area before creating anything', async () => {
      const add = jest.spyOn(urlSchemeHandler, 'createTodo').mockResolvedValue();
      const tools = stub(new TodosTools(), {
        checkContainers: () => ({ project: true, area: false }),
      });

      await expect(tools.createTodo({ title: 'X', areaId: 'nope' })).rejects.toThrow(
        /Area "nope" not found/,
      );
      expect(add).not.toHaveBeenCalled();
    });

    it('reports fields Things3 did not apply as warnings', async () => {
      let created = false;
      jest.spyOn(urlSchemeHandler, 'createTodo').mockImplementation(async () => {
        created = true;
      });
      const tools = stub(new TodosTools(), {
        findIdsByName: () => (created ? ['new'] : []),
        readItemStates: () => [todo('new', { title: 'X', tags: [] })],
      });

      const result = await tools.createTodo({ title: 'X', tags: ['missing-tag'] });

      expect(result.id).toBe('new');
      expect(result.warnings?.join('\n')).toMatch(/tags: expected \["missing-tag"\], got none/);
    });
  });

  describe('todos_update', () => {
    it('refuses to run without an auth token', async () => {
      delete process.env['THINGS3_AUTH_TOKEN'];
      const update = jest.spyOn(urlSchemeHandler, 'updateTodo').mockResolvedValue();
      const tools = stub(new TodosTools(), {});

      await expect(tools.updateTodo({ id: '1', title: 'New' })).rejects.toThrow(
        /THINGS3_AUTH_TOKEN/,
      );
      expect(update).not.toHaveBeenCalled();
    });

    it('refuses an update with nothing to change', async () => {
      const tools = stub(new TodosTools(), {});
      await expect(tools.updateTodo({ id: '1' })).rejects.toThrow(/Nothing to update/);
    });

    it('fails when Things3 did not apply the change', async () => {
      jest.spyOn(urlSchemeHandler, 'updateTodo').mockResolvedValue();
      const tools = stub(new TodosTools(), {
        readItemStates: () => [todo('1', { title: 'Old' })],
      });

      await expect(tools.updateTodo({ id: '1', title: 'New' })).rejects.toThrow(
        /applied 0 of 1[\s\S]*title: expected "New", got "Old"/,
      );
    });

    it('succeeds once the change is visible', async () => {
      let applied = false;
      jest.spyOn(urlSchemeHandler, 'updateTodo').mockImplementation(async () => {
        applied = true;
      });
      const tools = stub(new TodosTools(), {
        readItemStates: () => [todo('1', { title: applied ? 'New' : 'Old' })],
      });

      await expect(tools.updateTodo({ id: '1', title: 'New' })).resolves.toMatchObject({
        success: true,
      });
    });

    it('rejects a project id', async () => {
      const update = jest.spyOn(urlSchemeHandler, 'updateTodo').mockResolvedValue();
      const tools = stub(new TodosTools(), {
        readItemStates: () => [{ id: 'P', exists: true, kind: 'project' }],
      });

      await expect(tools.updateTodo({ id: 'P', title: 'x' })).rejects.toThrow(/not a to-do/);
      expect(update).not.toHaveBeenCalled();
    });
  });

  describe('todos_complete', () => {
    it('rejects missing ids without touching the others', async () => {
      const complete = jest.spyOn(urlSchemeHandler, 'completeTodos').mockResolvedValue();
      const tools = stub(new TodosTools(), {
        readItemStates: () => [todo('1'), { id: 'gone', exists: false }],
      });

      await expect(tools.completeTodos({ ids: ['1', 'gone'] })).rejects.toThrow(/not found: gone/);
      expect(complete).not.toHaveBeenCalled();
    });

    it('rejects an empty ids argument', async () => {
      const tools = stub(new TodosTools(), {});
      await expect(tools.completeTodos({ ids: [] })).rejects.toThrow(/ids must be/);
    });

    it('counts only to-dos that were really completed', async () => {
      let sent = false;
      jest.spyOn(urlSchemeHandler, 'completeTodos').mockImplementation(async () => {
        sent = true;
      });
      const tools = stub(new TodosTools(), {
        readItemStates: () => [
          todo('1', { status: sent ? 'completed' : 'open' }),
          todo('2', { status: sent ? 'completed' : 'open' }),
        ],
      });

      await expect(tools.completeTodos({ ids: ['1', '2'] })).resolves.toEqual({
        success: true,
        completedCount: 2,
      });
    });

    it('reports a partial failure', async () => {
      let sent = false;
      jest.spyOn(urlSchemeHandler, 'completeTodos').mockImplementation(async () => {
        sent = true;
      });
      const tools = stub(new TodosTools(), {
        readItemStates: () => [todo('1', { status: sent ? 'completed' : 'open' }), todo('2')],
      });

      await expect(tools.completeTodos({ ids: ['1', '2'] })).rejects.toThrow(
        /applied 1 of 2\. Applied: 1\.[\s\S]*2: status/,
      );
    });
  });

  describe('todos_uncomplete', () => {
    it('verifies the to-dos are open again', async () => {
      let sent = false;
      jest.spyOn(urlSchemeHandler, 'uncompleteTodos').mockImplementation(async () => {
        sent = true;
      });
      const tools = stub(new TodosTools(), {
        readItemStates: () => [todo('1', { status: sent ? 'open' : 'completed' })],
      });

      await expect(tools.uncompleteTodos({ ids: '1' })).resolves.toEqual({
        success: true,
        uncompletedCount: 1,
      });
    });
  });

  describe('projects', () => {
    it('projects_create returns the new project, not an older one with the same name', async () => {
      let created = false;
      jest.spyOn(urlSchemeHandler, 'createProject').mockImplementation(async () => {
        created = true;
      });
      const tools = stub(new ProjectTools(), {
        findIdsByName: () => (created ? ['old-done', 'new'] : ['old-done']),
        readItemStates: () => [{ id: 'new', exists: true, kind: 'project', title: 'Plan' }],
      });

      await expect(tools.createProject({ name: 'Plan' })).resolves.toMatchObject({
        success: true,
        id: 'new',
      });
    });

    it('projects_complete fails when Things3 did not complete the project', async () => {
      jest.spyOn(urlSchemeHandler, 'completeProject').mockResolvedValue();
      const tools = stub(new ProjectTools(), {
        readItemStates: () => [{ id: 'P', exists: true, kind: 'project', status: 'open' }],
      });

      await expect(tools.completeProject({ id: 'P' })).rejects.toThrow(
        /applied 0 of 1[\s\S]*status: expected "completed", got "open"/,
      );
    });

    it('projects_update verifies the new area', async () => {
      let sent = false;
      jest.spyOn(urlSchemeHandler, 'updateProject').mockImplementation(async () => {
        sent = true;
      });
      const tools = stub(new ProjectTools(), {
        checkContainers: () => ({ project: true, area: true }),
        readItemStates: () => [
          { id: 'P', exists: true, kind: 'project', ...(sent ? { areaId: 'A' } : {}) },
        ],
      });

      await expect(tools.updateProject({ id: 'P', areaId: 'A' })).resolves.toEqual({
        success: true,
      });
    });
  });

  describe('deletion (move to Trash)', () => {
    it('todos_delete moves to the Trash and counts what Things3 accepted', async () => {
      const scripts: string[] = [];
      const tools = stub(new TodosTools(), {
        readItemStates: () => [todo('1', { status: 'completed' }), todo('2')],
        trashItems: (script) => {
          scripts.push(script);
          return { trashed: ['1', '2'], failed: [] };
        },
      });

      await expect(tools.deleteTodos({ ids: ['1', '2'] })).resolves.toEqual({
        success: true,
        deletedCount: 2,
      });
      expect(scripts[0]).toContain('move to do id itemId to list id "TMTrashListSource"');
    });

    it('todos_delete rejects unknown ids and projects before deleting anything', async () => {
      let trashCalled = false;
      const tools = stub(new TodosTools(), {
        readItemStates: () => [todo('1'), { id: 'P', exists: true, kind: 'project' }],
        trashItems: () => {
          trashCalled = true;
          return { trashed: [], failed: [] };
        },
      });

      await expect(tools.deleteTodos({ ids: ['1', 'P'] })).rejects.toThrow(/not a to-do: P/);
      expect(trashCalled).toBe(false);
    });

    it('todos_delete reports items Things3 refused', async () => {
      const tools = stub(new TodosTools(), {
        readItemStates: () => [todo('1'), todo('2')],
        trashItems: () => ({ trashed: ['1'], failed: [{ id: '2', error: 'nope (-1728)' }] }),
      });

      await expect(tools.deleteTodos({ ids: ['1', '2'] })).rejects.toThrow(
        /moved 1 of 2 to the Trash[\s\S]*2: nope \(-1728\)/,
      );
    });

    it('projects_delete moves projects to the Trash', async () => {
      const scripts: string[] = [];
      const tools = stub(new ProjectTools(), {
        readItemStates: () => [{ id: 'P', exists: true, kind: 'project', status: 'completed' }],
        trashItems: (script) => {
          scripts.push(script);
          return { trashed: ['P'], failed: [] };
        },
      });

      await expect(tools.deleteProjects({ ids: 'P' })).resolves.toEqual({
        success: true,
        deletedCount: 1,
      });
      expect(scripts[0]).toContain('move project id itemId to list id "TMTrashListSource"');
    });
  });

  describe('bulk', () => {
    it('bulk_move rejects projectId and areaId together', async () => {
      const tools = stub(new BulkTools(), {});
      await expect(tools.move({ todoIds: ['1'], projectId: 'P', areaId: 'A' })).rejects.toThrow(
        /either projectId or areaId/,
      );
    });

    it('bulk_move counts verified moves', async () => {
      let sent = false;
      jest.spyOn(urlSchemeHandler, 'bulkMoveTodos').mockImplementation(async () => {
        sent = true;
      });
      const tools = stub(new BulkTools(), {
        checkContainers: () => ({ project: true, area: true }),
        readItemStates: () => [todo('1', sent ? { projectId: 'P' } : {})],
      });

      await expect(tools.move({ todoIds: ['1'], projectId: 'P' })).resolves.toEqual({ moved: 1 });
    });

    it('bulk_updateDates rejects a call with no dates', async () => {
      const tools = stub(new BulkTools(), {});
      await expect(tools.updateDates({ todoIds: ['1'] })).rejects.toThrow(/whenDate or deadline/);
    });
  });
});
