// ABOUTME: Area management tools for Things3 integration
// ABOUTME: Provides list and create operations for areas

import * as z from 'zod';
import { BaseTool, ToolDefinition } from '../base/tool-base.js';
import { READ_ONLY, CREATES, DESTRUCTIVE } from '../base/annotations.js';
import { idList } from '../base/schemas.js';
import { 
  AreasCreateParams,
  AreasCreateResult,
  AreasDeleteParams,
  AreasDeleteResult,
  Area
} from '../types/index.js';
import { listAreas, createArea, deleteAreas } from '../templates/applescript-templates.js';

export class AreaTools extends BaseTool {
  constructor() {
    super('areas');
  }

  /**
   * List all areas with optional filtering
   */
  async listAreas(): Promise<{ areas: Area[] }> {
    // Generate and execute AppleScript
    const script = listAreas();
    const result = await this.bridge.execute(script);
    
    // Parse the JSON response
    const areas: Area[] = JSON.parse(result);
    
    return { areas };
  }

  /**
   * Create a new area
   */
  async createArea(params: AreasCreateParams): Promise<AreasCreateResult> {
    const script = createArea(params.name);
    const id = await this.bridge.execute(script);
    
    
    return { id, success: true };
  }

  /**
   * Delete areas
   */
  async deleteAreas(params: AreasDeleteParams): Promise<AreasDeleteResult> {
    try {
      const ids = Array.isArray(params.ids) ? params.ids : [params.ids];
      
      // Use AppleScript for actual deletion
      const script = deleteAreas(ids);
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

  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'areas_list',
        title: 'List areas',
        description: 'List all areas in Things3',
        inputSchema: z.object({
          includeHidden: z.boolean().optional().describe('Include hidden areas (not supported yet; ignored)'),
        }),
        annotations: READ_ONLY,
        handler: this.listAreas.bind(this),
      },
      {
        name: 'areas_create',
        title: 'Create area',
        description: 'Create a new area in Things3',
        inputSchema: z.object({
          name: z.string().min(1).describe('The name of the area to create'),
        }),
        annotations: CREATES,
        handler: this.createArea.bind(this),
      },
      {
        name: 'areas_delete',
        title: 'Delete areas',
        description: 'Delete areas in Things3',
        inputSchema: z.object({ ids: idList('Area ID(s) to delete') }),
        annotations: DESTRUCTIVE,
        handler: this.deleteAreas.bind(this),
      },
    ];
  }

}