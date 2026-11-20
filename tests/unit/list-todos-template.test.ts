// ABOUTME: Unit tests for the todos_list AppleScript generator
// ABOUTME: Ensures project/area/tag filters actually reach the generated script

import { listTodos } from '../../src/templates/applescript-templates';

describe('listTodos template', () => {
  it('reads all to dos when no source is given', () => {
    const script = listTodos();
    expect(script).toContain('set todoList to to dos\n');
  });

  it('reads the to dos of a project when projectId is given', () => {
    const script = listTodos(undefined, undefined, undefined, { projectId: 'P1' });
    expect(script).toContain('set todoList to to dos of project id "P1"');
  });

  it('reads the to dos of an area when areaId is given', () => {
    const script = listTodos(undefined, undefined, undefined, { areaId: 'A1' });
    expect(script).toContain('set todoList to to dos of area id "A1"');
  });

  it('intersects a project with a built-in list filter', () => {
    const script = listTodos('today', undefined, undefined, { projectId: 'P1' });
    expect(script).toContain('set todoList to to dos of project id "P1"');
    expect(script).toContain('set allowedIds to id of to dos of list "Today"');
    expect(script).toContain('if allowedIds contains (id of t) then');
  });

  it('escapes ids', () => {
    const script = listTodos(undefined, undefined, undefined, { projectId: 'P"1' });
    expect(script).toContain('project id "P\\"1"');
  });

  it('includes tag names only when requested', () => {
    expect(listTodos()).not.toContain('forKey:"tags"');
    const script = listTodos(undefined, undefined, undefined, { includeTags: true });
    expect(script).toContain('forKey:"tags"');
  });

  it('keeps if/end if balanced for every filter combination', () => {
    const script = listTodos('inbox', 'open', 'x', { projectId: 'P1', includeTags: true });
    const ifs = (script.match(/^\s*if .* then$/gm) || []).length;
    const endIfs = (script.match(/^\s*end if$/gm) || []).length;
    expect(ifs).toBe(endIfs);
  });
});
