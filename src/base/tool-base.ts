// ABOUTME: Base class for all tools providing common functionality and registration
// ABOUTME: Eliminates code duplication across tool implementations

import type { ToolAnnotations } from '@modelcontextprotocol/server';
import type * as z from 'zod';
import { AppleScriptBridge } from '../utils/applescript.js';
import { createLogger } from '../utils/logger.js';
import { WriteGuard } from '../utils/write-guard.js';

/**
 * Tool handler function type
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ToolHandler = (args: any) => Promise<any>;

/**
 * Everything needed to register one MCP tool
 */
export interface ToolDefinition {
  name: string;
  /** Human-readable display name */
  title: string;
  description: string;
  /** Validated by the SDK before the handler runs; published to clients as JSON Schema */
  inputSchema: z.ZodObject<z.ZodRawShape>;
  annotations: ToolAnnotations;
  handler: ToolHandler;
}

/**
 * Abstract base class for all tool implementations
 */
export abstract class BaseTool {
  protected bridge: AppleScriptBridge;
  protected logger: ReturnType<typeof createLogger>;

  /** Options for write verification (tests shorten the timeouts) */
  protected guardOptions: ConstructorParameters<typeof WriteGuard>[1] = {};

  constructor(protected toolName: string) {
    this.bridge = new AppleScriptBridge();
    this.logger = createLogger(toolName);
  }

  /**
   * Validates inputs before, and verifies results after, URL-scheme writes
   */
  protected writeGuard(): WriteGuard {
    return new WriteGuard(this.bridge, this.guardOptions);
  }

  /**
   * Ensure tags exist in Things3, creating them if necessary
   * Common functionality extracted from multiple tool classes
   * Note: This will be overridden by TagTools to avoid circular dependencies
   */
  protected async ensureTagsExist(tags: string[]): Promise<void> {
    if (!tags || tags.length === 0) return;
    
    // This is a placeholder implementation - concrete tools should implement tag creation logic
    // The TagTools class will override this method with the actual implementation
    this.logger.warn('ensureTagsExist called on base class - should be overridden by concrete implementation');
  }

  /**
   * The MCP tools this class provides
   */
  abstract getToolDefinitions(): ToolDefinition[];
}