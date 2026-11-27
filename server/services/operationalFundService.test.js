import { describe, expect, it } from 'vitest';
import { OperationalFundService } from './operationalFundService';

describe('account-wide allocation history', () => {
  it('includes disabled/archived and removed sub-fund allocations, excludes opening balances and future projections', () => {
    const funds = [
      { id: 1, name: 'Birthdays', fundType: 'sinking', createdOn: '2026-07-18' },
      { id: 2, parentId: 1, name: 'Jacob', fundType: 'sinking', createdOn: '2026-07-18', active: false },
      { id: 3, name: 'Archived', fundType: 'operating', archivedAt: 'timestamp', archivedOn: '2026-11-01' },
    ];
    const repository = { listByAccount: () => funds, getAllocationHistory: id => ({
      1: [
        { periodStart: '2026-11-23', periodEnd: '2026-11-29', allocationCents: 0 },
        { periodStart: '2026-11-16', periodEnd: '2026-11-22', allocationCents: 0, removedAt: 'timestamp' },
        { periodStart: '2026-07-18', periodEnd: '2026-08-17', allocationCents: 25000 },
        { periodStart: '2026-11-18', periodEnd: '2026-12-17', allocationCents: 25000 },
        { periodStart: '2026-12-18', periodEnd: '2027-01-17', allocationCents: 25000 },
      ],
      2: [{ periodStart: '2026-10-18', periodEnd: '2026-11-17', allocationCents: 10000, removedAt: 'timestamp' }],
      3: [{ periodStart: '2026-10-25', allocationCents: 10000 }, { periodStart: '2026-11-25', allocationCents: 10000 }],
    })[id] };
    const rows = new OperationalFundService(repository, {}).getAllocationHistory('plaid:1', '2026-11-25');
    expect(rows.map(row => row.date)).toEqual(['2026-11-18', '2026-10-25', '2026-10-18']);
    expect(rows[1].archived).toBe(true);
    expect(rows[2]).toMatchObject({ parentName: 'Birthdays', fundName: 'Jacob', removed: true, amount: 100 });
  });
});
