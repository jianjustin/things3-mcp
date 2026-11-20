// ABOUTME: Project management tools for Things3 integration
// ABOUTME: Provides list, get, create, update, and complete operations

import * as z from 'zod';
import { BaseTool, ToolDefinition } from '../base/tool-base.js';
import { READ_ONLY, CREATES, ADDITIVE, DESTRUCTIVE } from '../base/annotations.js';
import { idList, WHEN_FORMATS, DEADLINE_FORMATS } from '../base/schemas.js';
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
} from '../templates/applescript-templates.js';
import { urlSchemeHandler } from '../utils/url-scheme.js';
import { toThingsDate } from '../utils/things-date.js';
import { RequestedChanges, expectationFor, hintFor, normalizeIds, throwIfNotApplied } from '../utils/write-guard.js';

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
    throwIfNotApplied('projects_complete', verification);
    return { success: true };
  }

  /**
   * Move projects (with their to-dos) to the Trash
   */
  async deleteProjects(params: ProjectsDeleteParams): Promise<ProjectsDeleteResult> {
    const ids = normalizeIds(params.ids, 'ids');
    const guard = this.writeGuard();
    await guard.assertItems(ids, 'project');
    const deletedCount = await guard.trash('project', ids);
    return { success: true, deletedCount };
  }

  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'projects_list',
        title: 'List projects',
        description: 'List projects in Things3',
        inputSchema: z.object({
          areaId: z.string().optional().describe('Only projects in this area'),
          includeCompleted: z.boolean().optional().describe('Include completed projects'),
        }),
        annotations: READ_ONLY,
        handler: this.listProjects.bind(this),
      },
      {
        name: 'projects_get',
        title: 'Get project',
        description: 'Get detailed information about a specific project',
        inputSchema: z.object({
          id: z.string().min(1).describe('The project ID'),
        }),
        annotations: READ_ONLY,
        handler: this.getProject.bind(this),
      },
      {
        name: 'projects_create',
        title: 'Create project',
        description:
          'Create a new project and return its id. Fields Things3 did not apply (e.g. unknown tags) are returned as warnings.',
        inputSchema: z.object({
          name: z.string().describe('The project name'),
          notes: z.string().optional().describe('Notes for the project'),
          whenDate: z.string().optional().describe(`When to start the project: ${WHEN_FORMATS}`),
          deadline: z.string().optional().describe(`Project deadline: ${DEADLINE_FORMATS}`),
          tags: z.array(z.string()).optional().describe('Tags to assign (must already exist)'),
          areaId: z.string().optional().describe('Area to put the project in'),
          headings: z.array(z.string()).optional().describe('Section headings to create within the project'),
        }),
        annotations: CREATES,
        handler: this.createProject.bind(this),
      },
      {
        name: 'projects_update',
        title: 'Update project',
        description: 'Change fields of an existing project; fails unless Things3 really applied the change',
        inputSchema: z.object({
          id: z.string().min(1).describe('The project ID to update'),
          name: z.string().optional().describe('New project name'),
          notes: z.string().nullable().optional().describe('New notes (null to clear)'),
          whenDate: z.string().nullable().optional().describe(`New start date: ${WHEN_FORMATS}. null to clear`),
          deadline: z.string().nullable().optional().describe(`New deadline: ${DEADLINE_FORMATS}. null to clear`),
          tags: z.array(z.string()).optional().describe('Replace all tags (tags must already exist)'),
          areaId: z.string().nullable().optional().describe('Move to this area (null to remove from its area)'),
        }),
        annotations: DESTRUCTIVE,
        handler: this.updateProject.bind(this),
      },
      {
        name: 'projects_complete',
        title: 'Complete project',
        description: 'Mark a project as completed. Things3 also marks all of its open to-dos as completed.',
        inputSchema: z.object({
          id: z.string().min(1).describe('The project ID to complete'),
        }),
        annotations: ADDITIVE,
        handler: this.completeProject.bind(this),
      },
      {
        name: 'projects_delete',
        title: 'Move projects to Trash',
        description: 'Move projects and their to-dos to the Trash (recoverable in Things3)',
        inputSchema: z.object({ ids: idList('Project ID(s) to delete') }),
        annotations: DESTRUCTIVE,
        handler: this.deleteProjects.bind(this),
      },
    ];
  }

}