// ABOUTME: Bulk operation tools for Things3 TODOs
// ABOUTME: Provides bulk move and bulk date update operations

import * as z from 'zod';
import { BaseTool, ToolDefinition } from '../base/tool-base.js';
import { DESTRUCTIVE } from '../base/annotations.js';
import { idList, WHEN_FORMATS, DEADLINE_FORMATS } from '../base/schemas.js';
import { BulkMoveParams, BulkUpdateDatesParams } from '../types/tools.js';
import { urlSchemeHandler } from '../utils/url-scheme.js';
import { ErrorType, Things3Error } from '../types/index.js';
import { toThingsDate } from '../utils/things-date.js';
import { RequestedChanges, expectationFor, normalizeIds, throwIfNotApplied } from '../utils/write-guard.js';

export class BulkTools extends BaseTool {
  constructor() {
    super('bulk');
  }

  /**
   * Bulk move TODOs to a project or area (or the Inbox when neither is given)
   */
  async move(params: BulkMoveParams): Promise<{ moved: number }> {
    const todoIds = normalizeIds(params.todoIds, 'todoIds');
    if (params.projectId && params.areaId) {
      throw new Things3Error(ErrorType.INVALID_PARAMETER, 'Pass either projectId or areaId, not both');
    }
    const target: { projectId?: string; areaId?: string } = {};
    if (params.projectId) target.projectId = params.projectId;
    else if (params.areaId) target.areaId = params.areaId;

    const guard = this.writeGuard();
    guard.requireAuthToken();
    await guard.assertItems(todoIds, 'todo');
    await guard.assertContainers(target);

    await urlSchemeHandler.bulkMoveTodos(todoIds, target.projectId, target.areaId);

    const expect = expectationFor({ list: target.projectId || target.areaId ? target : 'inbox' });
    const verification = await guard.verify(todoIds.map((id) => ({ id, expect })));
    throwIfNotApplied('bulk_move', verification);
    return { moved: verification.applied.length };
  }

  /**
   * Bulk update dates for multiple TODOs
   */
  async updateDates(params: BulkUpdateDatesParams): Promise<{ updated: number }> {
    const todoIds = normalizeIds(params.todoIds, 'todoIds');
    if (params.whenDate === undefined && params.deadline === undefined) {
      throw new Things3Error(ErrorType.INVALID_PARAMETER, 'Pass whenDate or deadline (null clears a date)');
    }

    // Validate dates before anything is written (throws on invalid values)
    const changes: RequestedChanges = {};
    if (params.whenDate !== undefined) {
      changes.whenDate = params.whenDate === null ? null : toThingsDate(params.whenDate, 'when');
    }
    if (params.deadline !== undefined) {
      changes.deadline = params.deadline === null ? null : toThingsDate(params.deadline, 'deadline');
    }

    const guard = this.writeGuard();
    guard.requireAuthToken();
    await guard.assertItems(todoIds, 'todo');

    await urlSchemeHandler.bulkUpdateDates(todoIds, params.whenDate, params.deadline);

    const expect = expectationFor(changes);
    const verification = await guard.verify(todoIds.map((id) => ({ id, expect })));
    throwIfNotApplied('bulk_updateDates', verification);
    return { updated: verification.applied.length };
  }

  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'bulk_move',
        title: 'Move to-dos',
        description: 'Move to-dos to a project or area, or to the Inbox when neither is given',
        inputSchema: z.object({
          todoIds: idList('To-do ID(s) to move'),
          projectId: z.string().nullable().optional().describe('Project to move the to-dos to'),
          areaId: z.string().nullable().optional().describe('Area to move the to-dos to (not together with projectId)'),
        }),
        annotations: DESTRUCTIVE,
        handler: this.move.bind(this),
      },
      {
        name: 'bulk_updateDates',
        title: 'Set dates on to-dos',
        description: 'Set or clear the when date and/or deadline of several to-dos at once',
        inputSchema: z.object({
          todoIds: idList('To-do ID(s) to update'),
          whenDate: z.string().nullable().optional().describe(`The when date: ${WHEN_FORMATS}. null to clear`),
          deadline: z.string().nullable().optional().describe(`The deadline: ${DEADLINE_FORMATS}. null to clear`),
        }),
        annotations: DESTRUCTIVE,
        handler: this.updateDates.bind(this),
      },
    ];
  }

}