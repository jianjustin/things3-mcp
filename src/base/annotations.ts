// ABOUTME: MCP tool annotation presets describing how each tool affects Things3 data
// ABOUTME: Clients use these hints (e.g. to auto-approve read-only tools or confirm destructive ones)

import type { ToolAnnotations } from '@modelcontextprotocol/server';

// All tools act on the local Things3 app only, so openWorldHint is always false.

/** Reads data, changes nothing */
export const READ_ONLY: ToolAnnotations = { readOnlyHint: true, openWorldHint: false };

/** Adds a new item; calling twice creates two items */
export const CREATES: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

/** Changes state without losing data (complete, reopen, add tags); repeating has no extra effect */
export const ADDITIVE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

/** Overwrites or removes existing data (update, move, delete); repeating has no extra effect */
export const DESTRUCTIVE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
};
