import { describe, expect, it } from 'vitest';
import { getDateInTimezone, getPeriodForDate } from './periods';

const fund = overrides => ({
  periodType: 'weekly', weeklyStartDay: 1, anchorMonth: 1, anchorDay: 1,
  createdAt: '2026-08-01T12:00:00.000Z', ...overrides,
});

describe('Operational Fund periods', () => {
  it('uses the configured weekly starting weekday', () => {
    expect(getPeriodForDate(fund({ weeklyStartDay: 1 }), '2026-08-13')).toEqual({
      start: '2026-08-10', end: '2026-08-16', nextStart: '2026-08-17',
    });
  });

  it('clamps month-end anchors to valid calendar dates', () => {
    expect(getPeriodForDate(fund({ periodType: 'monthly', anchorDay: 31 }), '2026-02-28')).toEqual({
      start: '2026-02-28', end: '2026-03-30', nextStart: '2026-03-31',
    });
  });

  it('uses a configurable quarterly anchor', () => {
    expect(getPeriodForDate(fund({ periodType: 'quarterly', anchorMonth: 2, anchorDay: 15 }), '2026-08-13')).toEqual({
      start: '2026-05-15', end: '2026-08-14', nextStart: '2026-08-15',
    });
  });

  it('uses a configurable yearly month and day anchor', () => {
    expect(getPeriodForDate(fund({ periodType: 'yearly', anchorMonth: 10, anchorDay: 1 }), '2026-08-13')).toEqual({
      start: '2025-10-01', end: '2026-09-30', nextStart: '2026-10-01',
    });
  });

  it('establishes today using the configured IANA timezone', () => {
    const instant = new Date('2026-08-13T02:00:00.000Z');
    expect(getDateInTimezone(instant, 'America/Chicago')).toBe('2026-08-12');
    expect(getDateInTimezone(instant, 'UTC')).toBe('2026-08-13');
  });
});
