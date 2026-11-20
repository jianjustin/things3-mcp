// ABOUTME: Compiles (never runs) generated AppleScript with osacompile to catch syntax errors
// ABOUTME: Skipped where osacompile or Things3 is unavailable (e.g. Linux CI)

import { execFileSync } from 'child_process';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as templates from '../../src/templates/applescript-templates';

const canCompile =
  process.platform === 'darwin' &&
  existsSync('/usr/bin/osacompile') &&
  existsSync('/Applications/Things3.app');

const scripts: Record<string, string> = {
  readItemStates: templates.readItemStates(['a', 'b"c']),
  findIdsByName: templates.findIdsByName('todo', 'Buy "milk"'),
  findProjectIdsByName: templates.findIdsByName('project', 'Plan'),
  checkContainers: templates.checkContainers('P', 'A'),
  checkContainersEmpty: templates.checkContainers(),
  trashTodos: templates.trashItems('todo', ['a', 'b"c']),
  trashProjects: templates.trashItems('project', ['p']),
  listTodosAll: templates.listTodos(),
  listTodosFiltered: templates.listTodos('today', 'open', 'x', { projectId: 'P', includeTags: true }),
  listTodosArea: templates.listTodos(undefined, 'completed', undefined, { areaId: 'A' }),
};

(canCompile ? describe : describe.skip)('generated AppleScript compiles', () => {
  const dir = mkdtempSync(join(tmpdir(), 'things3-mcp-compile-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it.each(Object.entries(scripts))('%s', (name, script) => {
    expect(() =>
      execFileSync('osacompile', ['-o', join(dir, `${name}.scpt`), '-e', script], { stdio: 'pipe' }),
    ).not.toThrow();
  });
});
