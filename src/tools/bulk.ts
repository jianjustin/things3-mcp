// ABOUTME: Bulk operation tools for Things3 TODOs
// ABOUTME: Provides bulk move and bulk date update operations

import { BaseTool, ToolRegistration } from '../base/tool-base.js';
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

  /**
   * Get tool registrations for the registry
   */
  getToolRegistrations(): ToolRegistration[] {
    return [
      {
        name: 'bulk_move',
        handler: this.move.bind(this),
        toolDefinition: {
          name: 'bulk_move',
          description: 'Move multiple TODOs to a project or area',
          inputSchema: {
            type: 'object',
            properties: {
              todoIds: {
                oneOf: [
                  {
                    type: 'string',
                    description: 'Single TODO ID'
                  },
                  {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Array of TODO IDs'
                  }
                ],
                description: 'TODO ID(s) to move'
              },
              projectId: {
                type: 'string',
                description: 'The ID of the project to move the TODOs to'
              },
              areaId: {
                type: 'string',
                description: 'The ID of the area to move the TODOs to'
              }
            },
            required: ['todoIds']
          }
        }
      },
      {
        name: 'bulk_updateDates',
        handler: this.updateDates.bind(this),
        toolDefinition: {
          name: 'bulk_updateDates',
          description: 'Update dates for multiple TODOs at once',
          inputSchema: {
            type: 'object',
            properties: {
              todoIds: {
                oneOf: [
                  {
                    type: 'string',
                    description: 'Single TODO ID'
                  },
                  {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Array of TODO IDs'
                  }
                ],
                description: 'TODO ID(s) to update'
              },
              whenDate: {
                type: ['string', 'null'],
                description: 'The when date: YYYY-MM-DD (local calendar day), an ISO 8601 date-time, or today/tomorrow/evening/anytime/someday. null to clear'
              },
              deadline: {
                type: ['string', 'null'],
                description: 'The deadline: YYYY-MM-DD (local calendar day), an ISO 8601 date-time, or today/tomorrow. null to clear'
              }
            },
            required: ['todoIds']
          }
        }
      }
    ];
  }
}