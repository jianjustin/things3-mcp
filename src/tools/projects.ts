// ABOUTME: Project management tools for Things3 integration
// ABOUTME: Provides list, get, create, update, and complete operations

import { BaseTool, ToolRegistration } from '../base/tool-base.js';
import { 
  ProjectsListParams, 
  ProjectsGetParams,
  ProjectsCreateParams,
  ProjectsCreateResult,
  ProjectsUpdateParams,
  ProjectsCompleteParams,
  ProjectsDeleteParams,
  ProjectsDeleteResult,
  Project,
  ErrorType,
  Things3Error,
} from '../types/index.js';
import { 
  listProjects, 
  getProjectById,
  deleteProjects
} from '../templates/applescript-templates.js';
import { urlSchemeHandler } from '../utils/url-scheme.js';
import { toThingsDate } from '../utils/things-date.js';
import { RequestedChanges, expectationFor, hintFor, throwIfNotApplied } from '../utils/write-guard.js';

export class ProjectTools extends BaseTool {
  constructor() {
    super('projects');
  }


  /**
   * List all projects with optional filtering
   */
  async listProjects(params: ProjectsListParams): Promise<{ projects: Project[] }> {
    // Generate and execute AppleScript
    const script = listProjects(params.areaId, params.includeCompleted);
    const result = await this.bridge.execute(script);
    
    // Parse the JSON response
    const projects: Project[] = JSON.parse(result);
    
    return { projects };
  }

  /**
   * Get detailed information about a specific project
   */
  async getProject(params: ProjectsGetParams): Promise<{ project: Project }> {
    const script = getProjectById(params.id);
    const result = await this.bridge.execute(script);
    
    if (result === 'null') {
      throw new Error(`Project with id "${params.id}" not found`);
    }
    
    const project: Project = JSON.parse(result);
    return { project };
  }

  /**
   * Create a new project and return its real id (see TodosTools.createTodo)
   */
  async createProject(params: ProjectsCreateParams): Promise<ProjectsCreateResult> {
    if (!params.name || params.name.trim() === '') {
      throw new Things3Error(ErrorType.INVALID_PARAMETER, 'name is required');
    }

    // Validate dates before anything is written (throws on invalid values)
    const whenValue = params.whenDate ? toThingsDate(params.whenDate, 'when') : undefined;
    const deadlineValue = params.deadline ? toThingsDate(params.deadline, 'deadline') : undefined;

    const guard = this.writeGuard();
    if (params.areaId) await guard.assertContainers({ areaId: params.areaId });

    // Ensure tags exist before creating the project
    if (params.tags && params.tags.length > 0) {
      await this.ensureTagsExist(params.tags);
    }

    const createParams: Parameters<typeof urlSchemeHandler.createProject>[0] = {
      title: params.name
    };
    if (params.notes) createParams.notes = params.notes;
    if (params.whenDate) createParams.whenDate = params.whenDate;
    if (params.deadline) createParams.deadline = params.deadline;
    if (params.tags) createParams.tags = params.tags;
    if (params.areaId) createParams.areaId = params.areaId;
    if (params.headings) createParams.headings = params.headings;

    const before = await guard.findIdsByName('project', params.name);
    await urlSchemeHandler.createProject(createParams);
    const { id, others } = await guard.waitForNewId('project', params.name, before);

    const changes: RequestedChanges = { title: params.name };
    if (params.notes) changes.notes = params.notes;
    if (params.tags?.length) changes.tags = params.tags;
    if (whenValue) changes.whenDate = whenValue;
    if (deadlineValue) changes.deadline = deadlineValue;
    if (params.areaId) changes.list = { areaId: params.areaId };
    const verification = await guard.verify([{ id, expect: expectationFor(changes) }], { timeoutMs: 0 });

    const warnings = verification.failed.flatMap((f) => f.problems);
    if (warnings.length > 0) {
      const hint = hintFor(verification);
      if (hint) warnings.push(hint);
    }
    if (others.length > 0) {
      warnings.push(`Other new projects with the same name appeared at the same time: ${others.join(', ')}`);
    }

    const result: ProjectsCreateResult = { success: true, id };
    if (warnings.length > 0) result.warnings = warnings;
    return result;
  }

  /**
   * Update an existing project; fails unless Things3 really applied the change
   */
  async updateProject(params: ProjectsUpdateParams): Promise<{ success: boolean }> {
    const { id, ...fields } = params;
    if (Object.values(fields).every((v) => v === undefined)) {
      throw new Things3Error(ErrorType.INVALID_PARAMETER, 'Nothing to update: pass at least one field to change');
    }

    const guard = this.writeGuard();
    guard.requireAuthToken();

    // Validate dates before anything is written (throws on invalid values)
    const changes: RequestedChanges = {};
    if (params.name !== undefined) changes.title = params.name;
    if (params.notes !== undefined) changes.notes = params.notes;
    if (params.tags !== undefined) changes.tags = params.tags;
    if (params.whenDate !== undefined) {
      changes.whenDate = params.whenDate === null ? null : toThingsDate(params.whenDate, 'when');
    }
    if (params.deadline !== undefined) {
      changes.deadline = params.deadline === null ? null : toThingsDate(params.deadline, 'deadline');
    }
    if (params.areaId !== undefined) {
      changes.list = params.areaId ? { areaId: params.areaId } : 'inbox';
    }

    await guard.assertItems([id], 'project');
    if (params.areaId) await guard.assertContainers({ areaId: params.areaId });

    // Ensure tags exist before updating the project
    if (params.tags && params.tags.length > 0) {
      await this.ensureTagsExist(params.tags);
    }

    const updateParams: Parameters<typeof urlSchemeHandler.updateProject>[1] = {};
    if (params.name !== undefined) updateParams.title = params.name;
    if (params.notes !== undefined) updateParams.notes = params.notes;
    if (params.whenDate !== undefined) updateParams.whenDate = params.whenDate;
    if (params.deadline !== undefined) updateParams.deadline = params.deadline;
    if (params.tags !== undefined) updateParams.tags = params.tags;
    if (params.areaId !== undefined) updateParams.areaId = params.areaId;

    await urlSchemeHandler.updateProject(id, updateParams);

    const verification = await guard.verify([{ id, expect: expectationFor(changes) }]);
    throwIfNotApplied('projects_update', verification, hintFor(verification));
    return { success: true };
  }

  /**
   * Complete a project; fails unless Things3 really completed it
   */
  async completeProject(params: ProjectsCompleteParams): Promise<{ success: boolean }> {
    const guard = this.writeGuard();
    guard.requireAuthToken();
    await guard.assertItems([params.id], 'project');

    await urlSchemeHandler.completeProject(params.id);

    const verification = await guard.verify([{ id: params.id, expect: { status: 'completed' } }]);
    throwIfNotApplied(
      'projects_complete',
      verification,
      'Things3 may refuse to complete a project that still has open to-dos; complete, cancel or move them first.'
    );
    return { success: true };
  }

  /**
   * Delete projects
   */
  async deleteProjects(params: ProjectsDeleteParams): Promise<ProjectsDeleteResult> {
    try {
      const ids = Array.isArray(params.ids) ? params.ids : [params.ids];
      
      // Use AppleScript for actual deletion
      const script = deleteProjects(ids);
      const result = await this.bridge.execute(script);
      
      const deletedCount = parseInt(result.trim()) || 0;
      
      return {
        success: deletedCount > 0,
        deletedCount: deletedCount,
      };
    } catch (error) {
      return {
        success: false,
        deletedCount: 0,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Get tool registrations for the registry
   */
  getToolRegistrations(): ToolRegistration[] {
    return [
      {
        name: 'projects_list',
        handler: this.listProjects.bind(this),
        toolDefinition: {
          name: 'projects_list',
          description: 'List all projects in Things3',
          inputSchema: {
            type: 'object',
            properties: {
              areaId: { 
                type: 'string',
                description: 'Filter projects by area ID'
              },
              includeCompleted: { 
                type: 'boolean',
                description: 'Include completed projects in the list'
              }
            }
          }
        }
      },
      {
        name: 'projects_get',
        handler: this.getProject.bind(this),
        toolDefinition: {
          name: 'projects_get',
          description: 'Get detailed information about a specific project',
          inputSchema: {
            type: 'object',
            properties: {
              id: { 
                type: 'string',
                description: 'The project ID'
              }
            },
            required: ['id']
          }
        }
      },
      {
        name: 'projects_create',
        handler: this.createProject.bind(this),
        toolDefinition: {
          name: 'projects_create',
          description: 'Create a new project in Things3',
          inputSchema: {
            type: 'object',
            properties: {
              name: { 
                type: 'string',
                description: 'The project name'
              },
              notes: { 
                type: 'string',
              description: 'Optional notes for the project'
            },
            whenDate: { 
              type: 'string',
              description: 'When to start the project: YYYY-MM-DD (local calendar day), an ISO 8601 date-time, or today/tomorrow/evening/anytime/someday'
            },
            deadline: { 
              type: 'string',
              description: 'Project deadline: YYYY-MM-DD (local calendar day), an ISO 8601 date-time, or today/tomorrow'
            },
            tags: { 
              type: 'array',
              items: { type: 'string' },
              description: 'Tags to assign to the project'
            },
            areaId: { 
              type: 'string',
              description: 'Area to assign the project to'
            },
            headings: { 
              type: 'array',
              items: { type: 'string' },
              description: 'Section headings to create within the project'
            }
          },
          required: ['name']
          }
        }
      },
      {
        name: 'projects_update',
        handler: this.updateProject.bind(this),
        toolDefinition: {
          name: 'projects_update',
          description: 'Update an existing project',
          inputSchema: {
            type: 'object',
            properties: {
              id: { 
                type: 'string',
                description: 'The project ID to update'
              },
              name: { 
                type: 'string',
                description: 'New project name'
              },
              notes: { 
                type: ['string', 'null'],
                description: 'New notes (null to clear)'
              },
              whenDate: { 
                type: ['string', 'null'],
                description: 'New start date: YYYY-MM-DD (local calendar day), an ISO 8601 date-time, or today/tomorrow/evening/anytime/someday. null to clear'
              },
              deadline: { 
                type: ['string', 'null'],
                description: 'New deadline: YYYY-MM-DD (local calendar day), an ISO 8601 date-time, or today/tomorrow. null to clear'
              },
              tags: { 
                type: 'array',
                items: { type: 'string' },
                description: 'Replace all tags with these tags'
              },
              areaId: { 
                type: ['string', 'null'],
                description: 'Move to new area (null to remove from area)'
              }
            },
            required: ['id']
          }
        }
      },
      {
        name: 'projects_complete',
        handler: this.completeProject.bind(this),
        toolDefinition: {
          name: 'projects_complete',
          description: 'Mark a project as completed',
          inputSchema: {
            type: 'object',
            properties: {
              id: { 
                type: 'string',
                description: 'The project ID to complete'
              }
            },
            required: ['id']
          }
        }
      },
      {
        name: 'projects_delete',
        handler: this.deleteProjects.bind(this),
        toolDefinition: {
          name: 'projects_delete',
          description: 'Delete projects in Things3 (moves to trash)',
          inputSchema: {
            type: 'object',
            properties: {
              ids: {
                oneOf: [
                  { type: 'string' },
                  { type: 'array', items: { type: 'string' } }
                ],
                description: 'Project ID or array of project IDs to delete'
              }
            },
            required: ['ids']
          }
        }
      }
    ];
  }
}