// ABOUTME: Shared zod building blocks for tool input schemas
// ABOUTME: Keeps id lists and date formats described the same way across tools

import * as z from 'zod';

export const WHEN_FORMATS =
  'YYYY-MM-DD (local calendar day), an ISO 8601 date-time, or today/tomorrow/evening/anytime/someday';
export const DEADLINE_FORMATS =
  'YYYY-MM-DD (local calendar day), an ISO 8601 date-time, or today/tomorrow';

/** One id or a non-empty array of ids */
export function idList(description: string): z.ZodType<string | string[]> {
  return z
    .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
    .describe(`${description} (one id or an array of ids)`);
}
