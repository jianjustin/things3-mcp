// ABOUTME: Logbook search tool for Things3 completed items
// ABOUTME: Provides searching through completed tasks with date range filtering

import * as z from 'zod';
import { BaseTool, ToolDefinition } from '../base/tool-base.js';
import { READ_ONLY } from '../base/annotations.js';
import * as templates from '../templates/applescript-templates.js';
import { LogbookSearchParams } from '../types/tools.js';
import { TodoItem } from '../types/models.js';
import { isoToAppleScriptDate } from '../utils/date-handler.js';

export class LogbookTools extends BaseTool {
  constructor() {
    super('logbook');
  }

  /**
   * Search completed items in the logbook
   */
  async search(params: LogbookSearchParams = {}): Promise<{ items: Partial<TodoItem>[] }> {
    // Convert dates to AppleScript format if provided
    let fromDateScript: string | undefined;
    let toDateScript: string | undefined;

    if (params.fromDate) {
      fromDateScript = isoToAppleScriptDate(params.fromDate);
    }

    if (params.toDate) {
      toDateScript = isoToAppleScriptDate(params.toDate);
    }

    const script = templates.searchLogbook(
      params.searchText,
      fromDateScript,
      toDateScript,
      params.limit
    );

    const result = await this.bridge.execute(script);

    try {
      const parsedResult = JSON.parse(result);
      
      // Convert the results to TodoItem format
      const items = parsedResult.map((item: Record<string, unknown>) => ({
        id: item['id'],
        title: item['title'],
        notes: item['notes'],
        completed: true,
        completionDate: item['completionDate'],
        projectName: item['projectName']
      }));

      return { items };
    } catch (error) {
      console.error('Failed to parse logbook search results:', error);
      return { items: [] };
    }
  }

  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'logbook_search',
        title: 'Search logbook',
        description: 'Search completed items in the logbook',
        inputSchema: z.object({
          searchText: z.string().optional().describe('Text to search for in title or notes'),
          fromDate: z.string().optional().describe('Start of completion date range (ISO 8601)'),
          toDate: z.string().optional().describe('End of completion date range (ISO 8601)'),
          limit: z.number().int().min(1).max(1000).optional().describe('Maximum number of results (default 100)'),
        }),
        annotations: READ_ONLY,
        handler: this.search.bind(this),
      },
    ];
  }

}