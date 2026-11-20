// ABOUTME: Unit tests for write verification: expected state, state diffing and the WriteGuard
// ABOUTME: URL-scheme writes are fire-and-forget, so success must be confirmed by reading back

import {
  WriteGuard,
  ItemState,
  diffState,
  expectationFor,
  newIds,
} from '../../src/utils/write-guard';
import { Things3Error } from '../../src/types';

const TODAY = new Date(2026, 10, 20, 15, 30); // 2026-11-20 local

describe('expectationFor', () => {
  it('maps plain fields', () => {
    expect(expectationFor({ title: 'T', notes: 'N', tags: ['a'] }, TODAY)).toEqual({
      title: 'T',
      notes: 'N',
      tags: ['a'],
    });
  });

  it('resolves when keywords to the activation date Things3 will store', () => {
    expect(expectationFor({ whenDate: 'today' }, TODAY).activationDate).toBe('2026-11-20');
    expect(expectationFor({ whenDate: 'evening' }, TODAY).activationDate).toBe('2026-11-20');
    expect(expectationFor({ whenDate: 'tomorrow' }, TODAY).activationDate).toBe('2026-11-21');
    expect(expectationFor({ whenDate: '2026-12-01' }, TODAY).activationDate).toBe('2026-12-01');
    expect(expectationFor({ whenDate: 'anytime' }, TODAY).activationDate).toBeNull();
    expect(expectationFor({ whenDate: null }, TODAY).activationDate).toBeNull();
  });

  it('resolves deadlines the same way', () => {
    expect(expectationFor({ deadline: '2026-11-29' }, TODAY).deadline).toBe('2026-11-29');
    expect(expectationFor({ deadline: 'tomorrow' }, TODAY).deadline).toBe('2026-11-21');
    expect(expectationFor({ deadline: null }, TODAY).deadline).toBeNull();
  });

  it('moving to a project expects that project', () => {
    expect(expectationFor({ list: { projectId: 'P' } }, TODAY)).toEqual({ projectId: 'P' });
  });

  it('moving to an area expects the area and no project', () => {
    expect(expectationFor({ list: { areaId: 'A' } }, TODAY)).toEqual({ areaId: 'A', projectId: null });
  });

  it('moving to the inbox expects neither project nor area', () => {
    expect(expectationFor({ list: 'inbox' }, TODAY)).toEqual({ projectId: null, areaId: null });
  });
});

describe('diffState', () => {
  const base: ItemState = {
    id: '1',
    exists: true,
    kind: 'todo',
    status: 'open',
    title: 'T',
    notes: 'line1\nline2',
    tags: ['b', 'a'],
    projectId: 'P',
    deadline: '2026-11-29',
  };

  it('reports nothing when the state matches', () => {
    expect(
      diffState(
        { title: 'T', tags: ['a', 'b'], projectId: 'P', areaId: null, deadline: '2026-11-29' },
        base,
      ),
    ).toEqual([]);
  });

  it('ignores line-ending differences in notes', () => {
    expect(diffState({ notes: 'line1\r\nline2' }, { ...base, notes: 'line1\rline2' })).toEqual([]);
  });

  it('describes each mismatch', () => {
    const problems = diffState(
      { title: 'New', tags: ['a', 'c'], projectId: 'Q', deadline: null, status: 'completed' },
      base,
    );
    expect(problems).toEqual([
      'title: expected "New", got "T"',
      'tags: expected ["a","c"], got ["a","b"]',
      'projectId: expected "Q", got "P"',
      'deadline: expected none, got "2026-11-29"',
      'status: expected "completed", got "open"',
    ]);
  });

  it('reports a missing item', () => {
    expect(diffState({ title: 'T' }, { id: '1', exists: false })).toEqual(['item not found']);
  });
});

describe('newIds', () => {
  it('returns ids that were not there before', () => {
    expect(newIds(['a', 'b'], ['b', 'c', 'a', 'd'])).toEqual(['c', 'd']);
  });
});

/** Fake bridge: answers each script kind from a queue/handler */
function fakeBridge(handlers: { [marker: string]: (script: string) => unknown }) {
  const calls: string[] = [];
  return {
    calls,
    bridge: {
      execute: async (script: string) => {
        const marker = Object.keys(handlers).find((m) => script.includes(`things3-mcp:${m}`));
        if (!marker) throw new Error(`unexpected script: ${script.slice(0, 80)}`);
        calls.push(marker);
        return JSON.stringify(handlers[marker]!(script));
      },
    },
  };
}

const fastOpts = { timeoutMs: 50, intervalMs: 1, sleep: async () => undefined };

describe('WriteGuard', () => {
  const originalToken = process.env['THINGS3_AUTH_TOKEN'];
  afterEach(() => {
    if (originalToken === undefined) delete process.env['THINGS3_AUTH_TOKEN'];
    else process.env['THINGS3_AUTH_TOKEN'] = originalToken;
  });

  it('requireAuthToken throws a helpful error when the token is missing', () => {
    delete process.env['THINGS3_AUTH_TOKEN'];
    const guard = new WriteGuard(fakeBridge({}).bridge, fastOpts);
    expect(() => guard.requireAuthToken()).toThrow(/THINGS3_AUTH_TOKEN/);
  });

  it('assertItems rejects missing ids and wrong kinds before anything is written', async () => {
    const { bridge } = fakeBridge({
      readItemStates: () => [
        { id: 'ok', exists: true, kind: 'todo' },
        { id: 'gone', exists: false },
        { id: 'proj', exists: true, kind: 'project' },
      ],
    });
    const guard = new WriteGuard(bridge, fastOpts);

    await expect(guard.assertItems(['ok', 'gone', 'proj'], 'todo')).rejects.toThrow(
      /not found: gone.*project, not a to-do: proj/s,
    );
  });

  it('assertContainers rejects an unknown project or area', async () => {
    const { bridge } = fakeBridge({ checkContainers: () => ({ project: false, area: true }) });
    const guard = new WriteGuard(bridge, fastOpts);

    await expect(guard.assertContainers({ projectId: 'P', areaId: 'A' })).rejects.toThrow(
      /Project "P" not found/,
    );
  });

  it('waitForNewId returns the id that appears after the write', async () => {
    let polls = 0;
    const { bridge } = fakeBridge({
      findIdsByName: () => (++polls < 3 ? ['old'] : ['old', 'new']),
    });
    const guard = new WriteGuard(bridge, fastOpts);

    await expect(guard.waitForNewId('todo', 'T', ['old'])).resolves.toEqual({ id: 'new', others: [] });
  });

  it('waitForNewId fails instead of guessing when nothing new appears', async () => {
    const { bridge } = fakeBridge({ findIdsByName: () => ['old'] });
    const guard = new WriteGuard(bridge, fastOpts);

    const call = guard.waitForNewId('todo', 'T', ['old']);
    await expect(call).rejects.toBeInstanceOf(Things3Error);
    await expect(call).rejects.toThrow(/could not confirm/);
  });

  it('verify polls until the expected state shows up', async () => {
    let polls = 0;
    const { bridge } = fakeBridge({
      readItemStates: () => [
        { id: '1', exists: true, kind: 'todo', status: ++polls < 3 ? 'open' : 'completed' },
      ],
    });
    const guard = new WriteGuard(bridge, fastOpts);

    const result = await guard.verify([{ id: '1', expect: { status: 'completed' } }]);

    expect(result).toEqual({ applied: ['1'], failed: [] });
  });

  it('verify reports items that never reach the expected state', async () => {
    const { bridge } = fakeBridge({
      readItemStates: () => [
        { id: '1', exists: true, kind: 'todo', status: 'completed' },
        { id: '2', exists: true, kind: 'todo', status: 'open' },
      ],
    });
    const guard = new WriteGuard(bridge, fastOpts);

    const result = await guard.verify([
      { id: '1', expect: { status: 'completed' } },
      { id: '2', expect: { status: 'completed' } },
    ]);

    expect(result.applied).toEqual(['1']);
    expect(result.failed).toEqual([{ id: '2', problems: ['status: expected "completed", got "open"'] }]);
  });
});
