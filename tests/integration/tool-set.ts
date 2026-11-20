// ABOUTME: Instances of every tool class for integration tests (replaces the old Things3Server fields)
// ABOUTME: Lets tests call tool methods directly without going through the MCP protocol

import { TodosTools } from '../../src/tools/todos.js';
import { ProjectTools } from '../../src/tools/projects.js';
import { AreaTools } from '../../src/tools/areas.js';
import { TagTools } from '../../src/tools/tags.js';
import { BulkTools } from '../../src/tools/bulk.js';
import { LogbookTools } from '../../src/tools/logbook.js';
import { SystemTools } from '../../src/tools/system.js';

export class ToolSet {
  todosTools = new TodosTools();
  projectTools = new ProjectTools();
  areaTools = new AreaTools();
  tagTools = new TagTools();
  bulkTools = new BulkTools();
  logbookTools = new LogbookTools();
  systemTools = new SystemTools();
}
