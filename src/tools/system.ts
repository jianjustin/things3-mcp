// ABOUTME: System utility tools for Things3 MCP server
// ABOUTME: Provides Things3 launch functionality

import * as z from 'zod';
import { BaseTool, ToolDefinition } from '../base/tool-base.js';
import { ADDITIVE } from '../base/annotations.js';
import * as templates from '../templates/applescript-templates.js';

export class SystemTools extends BaseTool {
  constructor() {
    super('system');
  }


  /**
   * Launch Things3 application
   */
  async launch(): Promise<{ status: string; version?: string }> {
    try {
      // Ensure Things3 is running
      const launchScript = templates.ensureThings3Running();
      await this.bridge.execute(launchScript);

      // Get version info
      const versionScript = templates.getThings3Version();
      const version = await this.bridge.execute(versionScript);

      return {
        status: 'running',
        version: version.trim()
      };
    } catch (error) {
      console.error('Failed to launch Things3:', error);
      return {
        status: 'error'
      };
    }
  }

  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'system_launch',
        title: 'Launch Things3',
        description: 'Launch the Things3 app if it is not running',
        inputSchema: z.object({}),
        annotations: ADDITIVE,
        handler: this.launch.bind(this),
      },
    ];
  }

}