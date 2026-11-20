// ABOUTME: Unit tests for converting tool date inputs into Things3 URL-scheme date values
// ABOUTME: Guards against UTC day shifts and silently dropped keywords/invalid values

import { toThingsDate } from '../../src/utils/things-date';
import { Things3Error } from '../../src/types';

describe('toThingsDate', () => {
  const originalTz = process.env['TZ'];

  afterEach(() => {
    if (originalTz === undefined) delete process.env['TZ'];
    else process.env['TZ'] = originalTz;
  });

  describe('plain calendar dates', () => {
    it('passes YYYY-MM-DD through unchanged in a UTC+ timezone', () => {
      process.env['TZ'] = 'Asia/Shanghai';
      expect(toThingsDate('2026-11-29', 'when')).toBe('2026-11-29');
    });

    it('passes YYYY-MM-DD through unchanged in a UTC- timezone', () => {
      process.env['TZ'] = 'America/New_York';
      expect(toThingsDate('2026-11-29', 'deadline')).toBe('2026-11-29');
    });

    it('does not rewrite today/tomorrow dates into keywords', () => {
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      expect(toThingsDate(today, 'when')).toBe(today);
    });

    it('rejects impossible calendar dates', () => {
      expect(() => toThingsDate('2026-02-30', 'when')).toThrow(Things3Error);
      expect(() => toThingsDate('2026-13-01', 'deadline')).toThrow(Things3Error);
    });
  });

  describe('date-times', () => {
    it('keeps the local calendar day of a local midnight time (no UTC shift)', () => {
      process.env['TZ'] = 'Asia/Shanghai';
      expect(toThingsDate('2026-11-29T00:00:00', 'deadline')).toBe('2026-11-29');
    });

    it('uses the local day of an instant with an explicit offset', () => {
      process.env['TZ'] = 'Asia/Shanghai';
      expect(toThingsDate('2026-11-29T00:00:00+08:00', 'deadline')).toBe('2026-11-29');
      expect(toThingsDate('2026-11-28T20:00:00Z', 'deadline')).toBe('2026-11-29');
    });

    it('rejects unparseable date-times', () => {
      expect(() => toThingsDate('2026-11-29Tnope', 'when')).toThrow(Things3Error);
    });
  });

  describe('keywords', () => {
    it.each(['today', 'tomorrow', 'evening', 'anytime', 'someday'])(
      'accepts when keyword %s',
      (keyword) => {
        expect(toThingsDate(keyword, 'when')).toBe(keyword);
      },
    );

    it('normalizes keyword case', () => {
      expect(toThingsDate('Someday', 'when')).toBe('someday');
    });

    it.each(['today', 'tomorrow'])('accepts deadline keyword %s', (keyword) => {
      expect(toThingsDate(keyword, 'deadline')).toBe(keyword);
    });

    it.each(['evening', 'anytime', 'someday'])('rejects %s as a deadline', (keyword) => {
      expect(() => toThingsDate(keyword, 'deadline')).toThrow(Things3Error);
    });
  });

  it('rejects arbitrary text instead of silently dropping it', () => {
    expect(() => toThingsDate('next week-ish', 'when')).toThrow(/Invalid when date/);
  });
});
