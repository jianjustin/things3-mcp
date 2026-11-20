// ABOUTME: Implementation of TODO-related tools for Things3 MCP server
// ABOUTME: Provides CRUD operations for TODOs with filtering and search

import { BaseTool, ToolRegistration } from '../base/tool-base.js';
import {
  TodosListParams,
  TodosListResult,
  TodosGetParams,
  TodosCreateParams,
  TodosCreateResult,
  TodosUpdateParams,
  TodosUpdateResult,
  TodosCompleteParams,
  TodosCompleteResult,
  TodosUncompleteParams,
  TodosUncompleteResult,
  TodosDeleteParams,
  TodosDeleteResult,
  TodoItem,
  ErrorType,
  Things3Error,
} from '../types/index.js';
import * as templates from '../templates/applescript-templates.js';
import { correctTodoCreateParams, correctTodoUpdateParams, logCorrections } from '../utils/error-correction.js';
import { urlSchemeHandler } from '../utils/url-scheme.js';
import { toThingsDate } from '../utils/things-date.js';
import {
  RequestedChanges,
  expectationFor,
  hintFor,
  normalizeIds,
  throwIfNotApplied,
} from '../utils/write-guard.js';

/** The project or area an item should live in (projectId wins if both are set) */
function containerOf(params: { projectId?: string | null; areaId?: string | null }): {
  projectId?: string;
  areaId?: string;
} {
  if (params.projectId) return { projectId: params.projectId };
  if (params.areaId) return { areaId: params.areaId };
  return {};
}

/**
 * Handles all TODO-related operations
 */
export class TodosTools extends BaseTool {
  constructor() {
    super('todos');
  }


  /**
   * List TODOs with optional filtering
   */
  async listTodos(params: TodosListParams): Promise<TodosListResult[]> {
    try {
      if (params.projectId && params.areaId) {
        throw new Things3Error(
          ErrorType.INVALID_PARAMETER,
          'Pass either projectId or areaId, not both'
        );
      }

      const wantTags = params.tags && params.tags.length > 0 ? params.tags : undefined;

      // Ensure Things3 is running
      await this.bridge.ensureThings3Running();

      // Generate and execute AppleScript (project/area filters are applied in the script)
      const listOptions: templates.ListTodosOptions = {};
      if (params.projectId) listOptions.projectId = params.projectId;
      if (params.areaId) listOptions.areaId = params.areaId;
      if (wantTags) listOptions.includeTags = true;
      const script = templates.listTodos(params.filter, params.status, params.searchText, listOptions);
      const response = await this.bridge.execute(script);

      // Parse response
      const todos = JSON.parse(response) as TodosListResult[];

      // Filter by tags: keep to dos that carry every requested tag
      let filtered = wantTags
        ? todos.filter((todo) => wantTags.every((tag) => (todo.tags ?? []).includes(tag)))
        : todos;

      // Apply pagination
      if (params.offset !== undefined || params.limit !== undefined) {
        const offset = params.offset || 0;
        const limit = params.limit || filtered.length;
        filtered = filtered.slice(offset, offset + limit);
      }
      
      return filtered;
    } catch (error) {
      if (error instanceof Things3Error) {
        throw error;
      }
      throw new Things3Error(
        ErrorType.UNKNOWN,
        'Failed to list TODOs',
        error
      );
    }
  }

  /**
   * Get full details of a specific TODO
   */
  async getTodo(params: TodosGetParams): Promise<TodoItem | null> {
    try {
      await this.bridge.ensureThings3Running();
      
      const script = templates.getTodoById(params.id);
      const response = await this.bridge.execute(script);
      
      if (response === 'null') {
        return null;
      }
      
      const todoData = JSON.parse(response);
      
      // Convert to TodoItem format
      const todo: TodoItem = {
        id: todoData.id,
        title: todoData.title,
        notes: todoData.notes,
        completed: todoData.completed,
        tags: todoData.tags || [],
        whenDate: todoData.whenDate,
        deadline: todoData.deadline,
        projectId: todoData.projectId,
        areaId: todoData.areaId,
        // Checklist and reminder would need additional AppleScript
        checklistItems: [],
      };
      
      return todo;
    } catch (error) {
      if (error instanceof Things3Error) {
        throw error;
      }
      throw new Things3Error(
        ErrorType.UNKNOWN,
        `Failed to get TODO ${params.id}`,
        error
      );
    }
  }

  /**
   * Create a new TODO
   *
   * The URL scheme does not return the new id, so the ids of open to-dos with
   * the same title are snapshotted before the command and the id that appears
   * afterwards is returned. If none appears the call fails instead of guessing.
   */
  async createTodo(params: TodosCreateParams): Promise<TodosCreateResult> {
    try {
      await this.bridge.ensureThings3Running();

      // Apply error correction
      const correctionReport = correctTodoCreateParams(params);
      const correctedParams = correctionReport.correctedData;

      // Log corrections if any were made
      if (correctionReport.hasCorrections) {
        logCorrections(correctionReport);
      }

      if (correctedParams.projectId && correctedParams.areaId) {
        throw new Things3Error(ErrorType.INVALID_PARAMETER, 'Pass either projectId or areaId, not both');
      }

      // Validate dates before anything is written (throws on invalid values)
      const whenValue = correctedParams.whenDate ? toThingsDate(correctedParams.whenDate, 'when') : undefined;
      const deadlineValue = correctedParams.deadline ? toThingsDate(correctedParams.deadline, 'deadline') : undefined;

      const guard = this.writeGuard();
      await guard.assertContainers(containerOf(correctedParams));

      // Ensure tags exist before creating the TODO
      if (correctedParams.tags && correctedParams.tags.length > 0) {
        await this.ensureTagsExist(correctedParams.tags);
      }

      const createParams: Parameters<typeof urlSchemeHandler.createTodo>[0] = {
        title: correctedParams.title
      };
      if (correctedParams.notes) createParams.notes = correctedParams.notes;
      if (correctedParams.whenDate) createParams.whenDate = correctedParams.whenDate;
      if (correctedParams.deadline) createParams.deadline = correctedParams.deadline;
      if (correctedParams.tags) createParams.tags = correctedParams.tags;
      if (correctedParams.checklistItems) createParams.checklistItems = correctedParams.checklistItems;
      if (correctedParams.projectId) createParams.projectId = correctedParams.projectId;
      if (correctedParams.areaId) createParams.areaId = correctedParams.areaId;
      if (correctedParams.heading) createParams.heading = correctedParams.heading;

      const before = await guard.findIdsByName('todo', correctedParams.title);
      await urlSchemeHandler.createTodo(createParams);
      const { id, others } = await guard.waitForNewId('todo', correctedParams.title, before);

      // The to-do exists now; report requested fields Things3 did not apply
      // as warnings rather than failing (failing would invite a duplicate).
      const changes: RequestedChanges = { title: correctedParams.title };
      if (correctedParams.notes) changes.notes = correctedParams.notes;
      if (correctedParams.tags?.length) changes.tags = correctedParams.tags;
      if (whenValue) changes.whenDate = whenValue;
      if (deadlineValue) changes.deadline = deadlineValue;
      const target = containerOf(correctedParams);
      if (target.projectId || target.areaId) changes.list = target;
      const verification = await guard.verify([{ id, expect: expectationFor(changes) }], { timeoutMs: 0 });

      const warnings = verification.failed.flatMap((f) => f.problems);
      if (warnings.length > 0) {
        const hint = hintFor(verification);
        if (hint) warnings.push(hint);
      }
      if (others.length > 0) {
        warnings.push(`Other new to-dos with the same title appeared at the same time: ${others.join(', ')}`);
      }

      const result: TodosCreateResult = { success: true, id };
      if (correctionReport.hasCorrections) {
        result.correctionsMade = correctionReport.corrections.map(c => `${c.type}: ${c.reason}`);
      }
      if (warnings.length > 0) result.warnings = warnings;
      return result;
    } catch (error) {
      if (error instanceof Things3Error) {
        throw error;
      }
      throw new Things3Error(
        ErrorType.UNKNOWN,
        'Failed to create TODO',
        error
      );
    }
  }

  /**
   * Update an existing TODO; fails unless Things3 really applied the change
   */
  async updateTodo(params: TodosUpdateParams): Promise<TodosUpdateResult> {
    try {
      // Apply error correction
      const correctionReport = correctTodoUpdateParams(params);
      const correctedParams = correctionReport.correctedData;

      // Log corrections if any were made
      if (correctionReport.hasCorrections) {
        logCorrections(correctionReport);
      }

      const { id, ...fields } = correctedParams;
      if (Object.values(fields).every((v) => v === undefined)) {
        throw new Things3Error(ErrorType.INVALID_PARAMETER, 'Nothing to update: pass at least one field to change');
      }
      if (correctedParams.projectId && correctedParams.areaId) {
        throw new Things3Error(ErrorType.INVALID_PARAMETER, 'Pass either projectId or areaId, not both');
      }

      const guard = this.writeGuard();
      guard.requireAuthToken();

      // Validate dates before anything is written (throws on invalid values)
      const changes: RequestedChanges = {};
      if (correctedParams.title !== undefined) changes.title = correctedParams.title;
      if (correctedParams.notes !== undefined) changes.notes = correctedParams.notes;
      if (correctedParams.tags !== undefined) changes.tags = correctedParams.tags;
      if (correctedParams.whenDate !== undefined) {
        changes.whenDate = correctedParams.whenDate === null ? null : toThingsDate(correctedParams.whenDate, 'when');
      }
      if (correctedParams.deadline !== undefined) {
        changes.deadline = correctedParams.deadline === null ? null : toThingsDate(correctedParams.deadline, 'deadline');
      }
      const movesList = correctedParams.projectId !== undefined || correctedParams.areaId !== undefined;
      if (movesList) {
        const target = containerOf(correctedParams);
        changes.list = target.projectId || target.areaId ? target : 'inbox';
      }

      await this.bridge.ensureThings3Running();
      await guard.assertItems([id], 'todo');
      await guard.assertContainers(containerOf(correctedParams));

      // Ensure tags exist before updating the TODO
      if (correctedParams.tags && correctedParams.tags.length > 0) {
        await this.ensureTagsExist(correctedParams.tags);
      }

      const updateParams: Parameters<typeof urlSchemeHandler.updateTodo>[1] = {};
      if (correctedParams.title !== undefined) updateParams.title = correctedParams.title;
      if (correctedParams.notes !== undefined) updateParams.notes = correctedParams.notes;
      if (correctedParams.whenDate !== undefined) updateParams.whenDate = correctedParams.whenDate;
      if (correctedParams.deadline !== undefined) updateParams.deadline = correctedParams.deadline;
      if (correctedParams.tags !== undefined) updateParams.tags = correctedParams.tags;
      if (movesList) {
        updateParams.listId = correctedParams.projectId || correctedParams.areaId || null;
      }

      await urlSchemeHandler.updateTodo(id, updateParams);

      const verification = await guard.verify([{ id, expect: expectationFor(changes) }]);
      throwIfNotApplied('todos_update', verification, hintFor(verification));

      const result: TodosUpdateResult = { success: true };
      if (correctionReport.hasCorrections) {
        result.correctionsMade = correctionReport.corrections.map(c => `${c.field}: ${c.reason}`);
      }
      return result;
    } catch (error) {
      if (error instanceof Things3Error) {
        throw error;
      }
      throw new Things3Error(
        ErrorType.UNKNOWN,
        `Failed to update TODO ${params.id}`,
        error
      );
    }
  }

  /**
   * Complete one or more TODOs; the count only includes verified completions
   */
  async completeTodos(params: TodosCompleteParams): Promise<TodosCompleteResult> {
    const completedCount = await this.setStatus(params.ids, 'completed');
    return { success: true, completedCount };
  }

  /**
   * Uncomplete one or more TODOs; the count only includes verified changes
   */
  async uncompleteTodos(params: TodosUncompleteParams): Promise<TodosUncompleteResult> {
    const uncompletedCount = await this.setStatus(params.ids, 'open');
    return { success: true, uncompletedCount };
  }

  private async setStatus(rawIds: unknown, status: 'completed' | 'open'): Promise<number> {
    const action = status === 'completed' ? 'todos_complete' : 'todos_uncomplete';
    try {
      const ids = normalizeIds(rawIds, 'ids');
      const guard = this.writeGuard();
      guard.requireAuthToken();

      await this.bridge.ensureThings3Running();
      await guard.assertItems(ids, 'todo');

      if (status === 'completed') {
        await urlSchemeHandler.completeTodos(ids);
      } else {
        await urlSchemeHandler.uncompleteTodos(ids);
      }

      const verification = await guard.verify(ids.map((id) => ({ id, expect: { status } })));
      throwIfNotApplied(action, verification);
      return verification.applied.length;
    } catch (error) {
      if (error instanceof Things3Error) {
        throw error;
      }
      throw new Things3Error(ErrorType.UNKNOWN, `${action} failed`, error);
    }
  }

  /**
   * Delete one or more TODOs
   */
  async deleteTodos(params: TodosDeleteParams): Promise<TodosDeleteResult> {
    try {
      await this.bridge.ensureThings3Running();
      
      const ids = Array.isArray(params.ids) ? params.ids : [params.ids];
      
      // Use AppleScript for actual deletion
      const script = templates.deleteTodos(ids);
      const result = await this.bridge.execute(script);
      
      const deletedCount = parseInt(result.trim()) || 0;
      
      return {
        success: deletedCount > 0,
        deletedCount: deletedCount,
      };
    } catch (error) {
      if (error instanceof Things3Error) {
        throw error;
      }
      throw new Things3Error(
        ErrorType.UNKNOWN,
        'Failed to delete TODOs',
        error
      );
    }
  }

  /**
   * Get tool registrations for the registry
   */
  getToolRegistrations(): ToolRegistration[] {
    return [
      {
        name: 'todos_list',
        handler: this.listTodos.bind(this),
        toolDefinition: {
          name: 'todos_list',
          description: 'List TODOs with optional filtering',
        inputSchema: {
          type: 'object',
          properties: {
            filter: {
              type: 'string',
              enum: ['inbox', 'today', 'upcoming', 'anytime', 'someday', 'logbook'],
              description: 'Filter by TODO list',
            },
            status: {
              type: 'string',
              enum: ['open', 'completed', 'cancelled'],
              description: 'Filter by status',
            },
            projectId: {
              type: 'string',
              description: 'Only to-dos of this project (can be combined with filter)',
            },
            areaId: {
              type: 'string',
              description: 'Only to-dos of this area (can be combined with filter, not with projectId)',
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Only to-dos that have all of these tags',
            },
            searchText: {
              type: 'string',
              description: 'Search in title and notes',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of results',
            },
            offset: {
              type: 'number',
              description: 'Number of results to skip',
            },
          },
        },
        }
      },
      {
        name: 'todos_get',
        handler: this.getTodo.bind(this),
        toolDefinition: {
          name: 'todos_get',
        description: 'Get full details of a specific TODO',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'TODO ID',
            },
          },
          required: ['id'],
        },
        },
      },
      {
        name: 'todos_create',
        handler: this.createTodo.bind(this),
        toolDefinition: {
          name: 'todos_create',
        description: 'Create a new TODO',
        inputSchema: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'TODO title',
            },
            notes: {
              type: 'string',
              description: 'TODO notes/description',
            },
            whenDate: {
              type: 'string',
              description: 'When to work on it: YYYY-MM-DD (local calendar day), an ISO 8601 date-time, or today/tomorrow/evening/anytime/someday',
            },
            deadline: {
              type: 'string',
              description: 'When it must be done: YYYY-MM-DD (local calendar day), an ISO 8601 date-time, or today/tomorrow',
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Tags to assign',
            },
            projectId: {
              type: 'string',
              description: 'Project to assign to',
            },
            areaId: {
              type: 'string',
              description: 'Area to assign to',
            },
            heading: {
              type: 'string',
              description: 'Title of heading within project to add to',
            },
            checklistItems: {
              type: 'array',
              items: { type: 'string' },
              description: 'Checklist item titles',
            },
            reminder: {
              type: 'object',
              properties: {
                dateTime: { type: 'string' },
                minutesBeforeDeadline: { type: 'number' },
                minutesBeforeWhen: { type: 'number' },
              },
              description: 'Reminder settings',
            },
          },
          required: ['title'],
        },
        },
      },
      {
        name: 'todos_update',
        handler: this.updateTodo.bind(this),
        toolDefinition: {
          name: 'todos_update',
        description: 'Update an existing TODO',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'TODO ID',
            },
            title: {
              type: 'string',
              description: 'New title',
            },
            notes: {
              type: ['string', 'null'],
              description: 'New notes (null to clear)',
            },
            whenDate: {
              type: ['string', 'null'],
              description: 'New when date: YYYY-MM-DD (local calendar day), an ISO 8601 date-time, or today/tomorrow/evening/anytime/someday. null to clear',
            },
            deadline: {
              type: ['string', 'null'],
              description: 'New deadline: YYYY-MM-DD (local calendar day), an ISO 8601 date-time, or today/tomorrow. null to clear',
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Replace all tags',
            },
            projectId: {
              type: ['string', 'null'],
              description: 'New project (null to move to Inbox)',
            },
            areaId: {
              type: ['string', 'null'],
              description: 'New area (null to move to Inbox)',
            },
          },
          required: ['id'],
        },
        },
      },
      {
        name: 'todos_complete',
        handler: this.completeTodos.bind(this),
        toolDefinition: {
          name: 'todos_complete',
        description: 'Mark TODO(s) as complete',
        inputSchema: {
          type: 'object',
          properties: {
            ids: {
              oneOf: [
                { type: 'string' },
                { type: 'array', items: { type: 'string' } },
              ],
              description: 'TODO ID(s) to complete',
            },
          },
          required: ['ids'],
        },
        },
      },
      {
        name: 'todos_uncomplete',
        handler: this.uncompleteTodos.bind(this),
        toolDefinition: {
          name: 'todos_uncomplete',
        description: 'Mark TODO(s) as incomplete',
        inputSchema: {
          type: 'object',
          properties: {
            ids: {
              oneOf: [
                { type: 'string' },
                { type: 'array', items: { type: 'string' } },
              ],
              description: 'TODO ID(s) to uncomplete',
            },
          },
          required: ['ids'],
        },
        },
      },
      {
        name: 'todos_delete',
        handler: this.deleteTodos.bind(this),
        toolDefinition: {
          name: 'todos_delete',
        description: 'Delete TODO(s)',
        inputSchema: {
          type: 'object',
          properties: {
            ids: {
              oneOf: [
                { type: 'string' },
                { type: 'array', items: { type: 'string' } },
              ],
              description: 'TODO ID(s) to delete',
            },
          },
          required: ['ids'],
        },
        }
      },
    ];
  }
}