// ABOUTME: Unit tests for the error correction system that validates automatic fixing of common Things3 issues
// ABOUTME: Tests date conflicts, missing titles, invalid references, and tag cleaning

import { correctTodoCreateParams, correctTodoUpdateParams, logCorrections } from '../../src/utils/error-correction';
import { TodosCreateParams, TodosUpdateParams } from '../../src/types/tools';
import { CorrectionType } from '../../src/types/corrections';

describe('Error Correction Functions', () => {

  describe('Date Conflict Correction', () => {
    it('should swap dates when deadline is before when date', () => {
      const params: TodosCreateParams = {
        title: 'Test TODO',
        whenDate: '2025-01-15T10:00:00Z',
        deadline: '2025-01-10T10:00:00Z', // Before when date
      };

      const report = correctTodoCreateParams(params);

      expect(report.hasCorrections).toBe(true);
      expect(report.corrections).toHaveLength(1);
      expect(report.corrections[0]?.type).toBe(CorrectionType.DATE_CONFLICT);
      expect(report.correctedData.whenDate).toBe('2025-01-10T10:00:00Z');
      expect(report.correctedData.deadline).toBe('2025-01-15T10:00:00Z');
    });

    it('should not correct when dates are valid', () => {
      const params: TodosCreateParams = {
        title: 'Test TODO',
        whenDate: '2025-01-10T10:00:00Z',
        deadline: '2025-01-15T10:00:00Z', // After when date
      };

      const report = correctTodoCreateParams(params);

      expect(report.hasCorrections).toBe(false);
      expect(report.corrections).toHaveLength(0);
    });

    it('should not correct when only one date is provided', () => {
      const params: TodosCreateParams = {
        title: 'Test TODO',
        whenDate: '2025-01-10T10:00:00Z',
      };

      const report = correctTodoCreateParams(params);

      expect(report.hasCorrections).toBe(false);
    });
  });

  describe('Missing Title Correction', () => {
    it('should generate title from notes when title is missing', () => {
      const params: TodosCreateParams = {
        title: '',
        notes: 'This is a detailed description of what needs to be done\nWith multiple lines',
      };

      const report = correctTodoCreateParams(params);

      expect(report.hasCorrections).toBe(true);
      expect(report.corrections).toHaveLength(1);
      expect(report.corrections[0]?.type).toBe(CorrectionType.MISSING_TITLE);
      expect(report.correctedData.title).toBe('This is a detailed description of what needs to be...');
    });

    it('should use "Untitled" when both title and notes are missing', () => {
      const params: TodosCreateParams = {
        title: '',
      };

      const report = correctTodoCreateParams(params);

      expect(report.hasCorrections).toBe(true);
      expect(report.corrections[0]?.type).toBe(CorrectionType.MISSING_TITLE);
      expect(report.correctedData.title).toBe('Untitled');
    });

    it('should not correct when updating without title', () => {
      const params: TodosUpdateParams = {
        id: 'test-id',
        notes: 'Updated notes',
      };

      const report = correctTodoUpdateParams(params);

      expect(report.hasCorrections).toBe(false);
    });
  });

  describe('Project and Area References', () => {
    // References are never rewritten by auto-correction: silently dropping an
    // ID would put the item in the wrong list. Existence is checked against
    // Things3 at write time instead.
    it('leaves projectId untouched on create', () => {
      const report = correctTodoCreateParams({ title: 'Test TODO', projectId: 'any-project' });

      expect(report.hasCorrections).toBe(false);
      expect(report.correctedData.projectId).toBe('any-project');
    });

    it('leaves areaId untouched on create', () => {
      const report = correctTodoCreateParams({ title: 'Test TODO', areaId: 'REAL-AREA-ID' });

      expect(report.hasCorrections).toBe(false);
      expect(report.correctedData.areaId).toBe('REAL-AREA-ID');
    });

    it('leaves areaId untouched on update', () => {
      const report = correctTodoUpdateParams({ id: 'todo-1', areaId: 'REAL-AREA-ID' });

      expect(report.hasCorrections).toBe(false);
      expect(report.correctedData.areaId).toBe('REAL-AREA-ID');
    });
  });

  describe('Tag Name Cleaning', () => {
    it('should clean invalid characters from tag names', () => {
      const params: TodosCreateParams = {
        title: 'Test TODO',
        tags: ['valid-tag', 'tag,with;invalid', 'another,tag'],
      };

      const report = correctTodoCreateParams(params);

      expect(report.hasCorrections).toBe(true);
      expect(report.corrections[0]?.type).toBe(CorrectionType.INVALID_TAG_NAME);
      expect(report.correctedData.tags).toEqual(['valid-tag', 'tagwithinvalid', 'anothertag']);
    });

    it('should remove duplicate tags after cleaning', () => {
      const params: TodosCreateParams = {
        title: 'Test TODO',
        tags: ['tag,1', 'tag;1', 'tag2'],
      };

      const report = correctTodoCreateParams(params);

      expect(report.hasCorrections).toBe(true);
      expect(report.correctedData.tags).toEqual(['tag1', 'tag2']);
    });

    it('should not correct valid tag names', () => {
      const params: TodosCreateParams = {
        title: 'Test TODO',
        tags: ['valid-tag', 'another_valid_tag', 'tag123'],
      };

      const report = correctTodoCreateParams(params);

      expect(report.hasCorrections).toBe(false);
    });
  });

  describe('Multiple Corrections', () => {
    it('should apply multiple corrections in one operation', () => {
      const params: TodosCreateParams = {
        title: '',
        notes: 'Important task description',
        whenDate: '2025-01-15T10:00:00Z',
        deadline: '2025-01-10T10:00:00Z',
        projectId: 'invalid-project',
        tags: ['tag,1', 'tag;2'],
      };

      const report = correctTodoCreateParams(params);

      expect(report.hasCorrections).toBe(true);
      expect(report.corrections).toHaveLength(3);
      
      // Check all corrections were applied
      expect(report.correctedData.title).toBe('Important task description');
      expect(report.correctedData.whenDate).toBe('2025-01-10T10:00:00Z');
      expect(report.correctedData.deadline).toBe('2025-01-15T10:00:00Z');
      expect(report.correctedData.projectId).toBe('invalid-project');
      expect(report.correctedData.tags).toEqual(['tag1', 'tag2']);
    });
  });

  describe('Logging', () => {
    let consoleSpy: jest.SpyInstance;

    beforeEach(() => {
      consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    });

    afterEach(() => {
      consoleSpy.mockRestore();
    });

    it('should log corrections when present', () => {
      const params: TodosCreateParams = {
        title: '',
      };

      const report = correctTodoCreateParams(params);
      logCorrections(report);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Applied corrections:'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('missing_title'));
    });

    it('should not log when no corrections', () => {
      const params: TodosCreateParams = {
        title: 'Valid TODO',
      };

      const report = correctTodoCreateParams(params);
      logCorrections(report);

      expect(consoleSpy).not.toHaveBeenCalled();
    });
  });
});