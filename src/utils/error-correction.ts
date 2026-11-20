// ABOUTME: Error correction system that automatically fixes common Things3 issues like date conflicts and tag names
// ABOUTME: Provides self-correcting behavior to improve user experience and prevent errors

import {
  CorrectionType,
  CorrectionResult,
  CorrectionReport,
} from '../types/corrections.js';
import { TodosCreateParams, TodosUpdateParams } from '../types/tools.js';
import { cleanTagName } from './tag-validator.js';
import { createLogger } from './logger.js';
import { calendarDayOfInput } from './things-date.js';

const logger = createLogger('error-correction');

/**
 * Correct date conflicts where deadline is before when date
 */
function correctDateConflict(data: { whenDate?: string | null; deadline?: string | null }): CorrectionResult | null {
  if (!data.whenDate || !data.deadline) return null;

  // Compare calendar days, not timestamps: keywords (tomorrow, someday...) are
  // not parseable by Date, and two times on the same day are not a conflict.
  const whenDay = calendarDayOfInput(data.whenDate, 'when');
  const deadlineDay = calendarDayOfInput(data.deadline, 'deadline');
  if (!whenDay || !deadlineDay || deadlineDay >= whenDay) return null;

  const originalWhenDate = data.whenDate;
  const originalDeadline = data.deadline;
  
  // Swap the dates
  data.whenDate = originalDeadline;
  data.deadline = originalWhenDate;

  return {
    type: CorrectionType.DATE_CONFLICT,
    field: 'whenDate/deadline',
    originalValue: { whenDate: originalWhenDate, deadline: originalDeadline },
    correctedValue: { whenDate: data.whenDate, deadline: data.deadline },
    reason: 'Deadline cannot be before when date - dates have been swapped',
  };
}

/**
 * Generate a title when missing
 */
function correctMissingTitle(data: { title?: string; notes?: string | null }): CorrectionResult | null {
  if (data.title && data.title.trim() !== '') return null;

  const originalTitle = data.title;
  
  // Try to generate title from notes
  if (data.notes && typeof data.notes === 'string' && data.notes.trim()) {
    const firstLine = data.notes.trim().split('\n')[0];
    if (firstLine) {
      // Take first 50 characters of first line
      data.title = firstLine.substring(0, 50).trim();
      if (firstLine.length > 50) {
        data.title += '...';
      }
    } else {
      data.title = 'Untitled';
    }
  } else {
    data.title = 'Untitled';
  }

  return {
    type: CorrectionType.MISSING_TITLE,
    field: 'title',
    originalValue: originalTitle,
    correctedValue: data.title,
    reason: (data.notes && typeof data.notes === 'string' && data.notes.trim())
      ? 'Generated title from first line of notes'
      : 'No title provided - using default',
  };
}

/**
 * Clean invalid characters from tag names
 */
function correctTagNames(data: { tags?: string[] }): CorrectionResult | null {
  if (!data.tags || !Array.isArray(data.tags)) return null;
  
  const needsCleaning = data.tags.some((tag: string) => tag !== cleanTagName(tag));
  if (!needsCleaning) return null;

  const originalTags = [...data.tags];
  const cleanedTags = data.tags.map((tag: string) => cleanTagName(tag));
  
  // Remove duplicates after cleaning
  data.tags = [...new Set(cleanedTags)];

  return {
    type: CorrectionType.INVALID_TAG_NAME,
    field: 'tags',
    originalValue: originalTags,
    correctedValue: data.tags,
    reason: 'Removed invalid characters from tag names',
  };
}

/**
 * Correct TODO creation parameters
 */
export function correctTodoCreateParams(params: TodosCreateParams): CorrectionReport<TodosCreateParams> {
  const corrections: CorrectionResult[] = [];
  const correctedData = { ...params };

  // Apply all corrections
  const titleCorrection = correctMissingTitle(correctedData);
  if (titleCorrection) corrections.push(titleCorrection);

  const dateCorrection = correctDateConflict(correctedData);
  if (dateCorrection) corrections.push(dateCorrection);

  const tagCorrection = correctTagNames(correctedData);
  if (tagCorrection) corrections.push(tagCorrection);

  return {
    hasCorrections: corrections.length > 0,
    corrections,
    correctedData,
  };
}

/**
 * Correct TODO update parameters
 */
export function correctTodoUpdateParams(params: TodosUpdateParams): CorrectionReport<TodosUpdateParams> {
  const corrections: CorrectionResult[] = [];
  const correctedData = { ...params };

  // For updates, we don't correct missing title (it's optional)
  const dateCorrection = correctDateConflict(correctedData);
  if (dateCorrection) corrections.push(dateCorrection);

  const tagCorrection = correctTagNames(correctedData);
  if (tagCorrection) corrections.push(tagCorrection);

  return {
    hasCorrections: corrections.length > 0,
    corrections,
    correctedData,
  };
}

/**
 * Log corrections for debugging
 */
export function logCorrections<T>(report: CorrectionReport<T>): void {
  if (!report.hasCorrections) return;

  logger.info('Applied corrections:');
  for (const correction of report.corrections) {
    logger.info(`- ${correction.type}: ${correction.reason}`);
    logger.debug(`  Field: ${correction.field}`);
    logger.debug(`  Original: ${JSON.stringify(correction.originalValue)}`);
    logger.debug(`  Corrected: ${JSON.stringify(correction.correctedValue)}`);
  }
}