// ABOUTME: Verifies Things3 URL-scheme writes by validating inputs first and reading state back after
// ABOUTME: URL-scheme commands are fire-and-forget, so this is the only way to report real success

import { ErrorType, Things3Error } from '../types/index.js';
import * as templates from '../templates/applescript-templates.js';
import { resolveCalendarDay } from './things-date.js';

export type ItemKind = 'todo' | 'project';
export type ItemStatus = 'open' | 'completed' | 'canceled';

/** State of a to-do/project as read back from Things3 */
export interface ItemState {
  id: string;
  exists: boolean;
  kind?: ItemKind;
  status?: ItemStatus;
  title?: string;
  notes?: string;
  tags?: string[];
  projectId?: string;
  areaId?: string;
  /** YYYY-MM-DD, local */
  deadline?: string;
  /** YYYY-MM-DD, local */
  activationDate?: string;
}

/** Fields a write is expected to produce. `null` means "must be empty". */
export interface Expectation {
  title?: string;
  notes?: string;
  tags?: string[];
  projectId?: string | null;
  areaId?: string | null;
  deadline?: string | null;
  activationDate?: string | null;
  status?: ItemStatus;
}

/** Changes requested by a tool, in Things3 terms (dates already passed through toThingsDate) */
export interface RequestedChanges {
  title?: string;
  notes?: string;
  tags?: string[];
  whenDate?: string | null;
  deadline?: string | null;
  list?: { projectId?: string; areaId?: string } | 'inbox';
  status?: ItemStatus;
}

export interface VerifyResult {
  applied: string[];
  failed: Array<{ id: string; problems: string[] }>;
}

interface GuardOptions {
  timeoutMs: number;
  intervalMs: number;
  sleep: (ms: number) => Promise<void>;
}

const DEFAULT_OPTIONS: GuardOptions = {
  timeoutMs: 8000,
  intervalMs: 250,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * Translate requested changes into the state Things3 should end up in.
 */
export function expectationFor(changes: RequestedChanges, today: Date = new Date()): Expectation {
  const e: Expectation = {};
  if (changes.title !== undefined) e.title = changes.title;
  if (changes.notes !== undefined) e.notes = changes.notes;
  if (changes.tags !== undefined) e.tags = changes.tags;
  if (changes.whenDate !== undefined) e.activationDate = resolveCalendarDay(changes.whenDate, today);
  if (changes.deadline !== undefined) e.deadline = resolveCalendarDay(changes.deadline, today);
  if (changes.status !== undefined) e.status = changes.status;
  if (changes.list === 'inbox') {
    e.projectId = null;
    e.areaId = null;
  } else if (changes.list?.projectId) {
    e.projectId = changes.list.projectId;
  } else if (changes.list?.areaId) {
    e.areaId = changes.list.areaId;
    e.projectId = null;
  }
  return e;
}

function normalizeNotes(notes: string | undefined): string {
  return (notes ?? '').replace(/\r\n?/g, '\n').trimEnd();
}

function show(value: unknown): string {
  const empty =
    value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
  return empty ? 'none' : JSON.stringify(value);
}

/**
 * Compare expected and actual state; returns a description of each mismatch.
 */
export function diffState(expected: Expectation, actual: ItemState): string[] {
  if (!actual.exists) return ['item not found'];

  const problems: string[] = [];
  const check = (field: string, want: unknown, got: unknown, equal: boolean): void => {
    if (!equal) problems.push(`${field}: expected ${show(want)}, got ${show(got)}`);
  };

  if (expected.title !== undefined) {
    check('title', expected.title, actual.title, expected.title === actual.title);
  }
  if (expected.notes !== undefined) {
    const want = normalizeNotes(expected.notes);
    const got = normalizeNotes(actual.notes);
    check('notes', want, got, want === got);
  }
  if (expected.tags !== undefined) {
    const want = [...expected.tags].sort();
    const got = [...(actual.tags ?? [])].sort();
    check('tags', want, got, JSON.stringify(want) === JSON.stringify(got));
  }
  for (const field of ['projectId', 'areaId', 'deadline', 'activationDate'] as const) {
    const want = expected[field];
    if (want === undefined) continue;
    const got = actual[field];
    check(field, want, got, (want ?? undefined) === (got ?? undefined));
  }
  if (expected.status !== undefined) {
    check('status', expected.status, actual.status, expected.status === actual.status);
  }
  return problems;
}

export function newIds(before: string[], after: string[]): string[] {
  const seen = new Set(before);
  return after.filter((id) => !seen.has(id));
}

/**
 * Validation before and verification after Things3 URL-scheme writes.
 */
export class WriteGuard {
  private readonly options: GuardOptions;

  constructor(
    private readonly bridge: { execute(script: string): Promise<string> },
    options: Partial<GuardOptions> = {},
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /** Things3 silently ignores update commands without a valid auth token. */
  requireAuthToken(): void {
    if (!process.env['THINGS3_AUTH_TOKEN']) {
      throw new Things3Error(
        ErrorType.INVALID_PARAMETER,
        'THINGS3_AUTH_TOKEN is not set. Things3 ignores update commands without it. ' +
          'Copy the token from Things → Settings → General → Enable Things URLs → Manage, ' +
          'and set THINGS3_AUTH_TOKEN in the MCP server environment.',
      );
    }
  }

  async readStates(ids: string[]): Promise<ItemState[]> {
    if (ids.length === 0) return [];
    const response = await this.bridge.execute(templates.readItemStates(ids));
    return JSON.parse(response) as ItemState[];
  }

  /** Fail before writing if any id is missing or is not of the expected kind. */
  async assertItems(ids: string[], kind: ItemKind): Promise<ItemState[]> {
    const states = await this.readStates(ids);
    const missing = states.filter((s) => !s.exists).map((s) => s.id);
    const wrongKind = states.filter((s) => s.exists && s.kind !== kind).map((s) => s.id);

    const problems: string[] = [];
    if (missing.length) problems.push(`not found: ${missing.join(', ')}`);
    if (wrongKind.length) {
      const label = kind === 'todo' ? 'project, not a to-do' : 'to-do, not a project';
      problems.push(`${label}: ${wrongKind.join(', ')}`);
    }
    if (problems.length) {
      throw new Things3Error(
        ErrorType.NOT_FOUND,
        `Nothing was changed. Invalid ${kind === 'todo' ? 'to-do' : 'project'} ids (${problems.join('; ')})`,
      );
    }
    return states;
  }

  /** Fail before writing if the target project/area does not exist. */
  async assertContainers(target: { projectId?: string; areaId?: string }): Promise<void> {
    if (!target.projectId && !target.areaId) return;
    const response = await this.bridge.execute(
      templates.checkContainers(target.projectId, target.areaId),
    );
    const found = JSON.parse(response) as { project: boolean; area: boolean };
    if (!found.project) {
      throw new Things3Error(ErrorType.INVALID_REFERENCE, `Project "${target.projectId}" not found`);
    }
    if (!found.area) {
      throw new Things3Error(ErrorType.INVALID_REFERENCE, `Area "${target.areaId}" not found`);
    }
  }

  async findIdsByName(kind: ItemKind, name: string): Promise<string[]> {
    const response = await this.bridge.execute(templates.findIdsByName(kind, name));
    return JSON.parse(response) as string[];
  }

  /**
   * Wait for an item with this name that was not in `before` (the snapshot
   * taken right before the create command).
   */
  async waitForNewId(
    kind: ItemKind,
    name: string,
    before: string[],
  ): Promise<{ id: string; others: string[] }> {
    const deadline = Date.now() + this.options.timeoutMs;
    for (;;) {
      const created = newIds(before, await this.findIdsByName(kind, name));
      if (created.length > 0) {
        const [id, ...others] = created as [string, ...string[]];
        return { id, others };
      }
      if (Date.now() >= deadline) {
        throw new Things3Error(
          ErrorType.TIMEOUT,
          `Things3 could not confirm that the ${kind === 'todo' ? 'to-do' : 'project'} "${name}" ` +
            `was created within ${this.options.timeoutMs} ms. Check Things3 before retrying to avoid duplicates.`,
        );
      }
      await this.options.sleep(this.options.intervalMs);
    }
  }

  /**
   * Poll until every item matches its expectation or the timeout passes.
   */
  async verify(
    items: Array<{ id: string; expect: Expectation }>,
    options: { timeoutMs?: number } = {},
  ): Promise<VerifyResult> {
    const deadline = Date.now() + (options.timeoutMs ?? this.options.timeoutMs);
    for (;;) {
      const states = new Map((await this.readStates(items.map((i) => i.id))).map((s) => [s.id, s]));
      const result: VerifyResult = { applied: [], failed: [] };
      for (const item of items) {
        const state = states.get(item.id) ?? { id: item.id, exists: false };
        const problems = diffState(item.expect, state);
        if (problems.length === 0) result.applied.push(item.id);
        else result.failed.push({ id: item.id, problems });
      }
      if (result.failed.length === 0 || Date.now() >= deadline) return result;
      await this.options.sleep(this.options.intervalMs);
    }
  }
}

/**
 * Throw a readable error if verification found items Things3 did not change.
 */
export function throwIfNotApplied(action: string, result: VerifyResult, hint?: string): void {
  if (result.failed.length === 0) return;
  const total = result.applied.length + result.failed.length;
  const details = result.failed.map((f) => `${f.id}: ${f.problems.join('; ')}`).join('\n');
  throw new Things3Error(
    ErrorType.APPLESCRIPT_ERROR,
    `${action}: Things3 applied ${result.applied.length} of ${total}.` +
      (result.applied.length ? ` Applied: ${result.applied.join(', ')}.` : '') +
      `\nNot applied:\n${details}` +
      (hint ? `\n${hint}` : ''),
  );
}

/**
 * Normalize an `ids` argument (string or array) and reject empty input.
 */
export function normalizeIds(ids: unknown, param: string): string[] {
  const list = Array.isArray(ids) ? ids : ids === undefined || ids === null ? [] : [ids];
  if (list.length === 0 || list.some((id) => typeof id !== 'string' || id.trim() === '')) {
    throw new Things3Error(
      ErrorType.INVALID_PARAMETER,
      `${param} must be a non-empty id or a non-empty array of ids`,
    );
  }
  return list as string[];
}

/** Hint appended to verification errors that involve tags */
export const TAGS_HINT =
  'Things3 ignores tags that do not exist yet; create them first with tags_create.';

export function hintFor(result: VerifyResult): string | undefined {
  return result.failed.some((f) => f.problems.some((p) => p.startsWith('tags:')))
    ? TAGS_HINT
    : undefined;
}
