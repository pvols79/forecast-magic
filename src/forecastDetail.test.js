import { describe, expect, it } from 'vitest';
import { getNinetyDayLow, allocationStatus } from './forecastDetail';
import { projectCashFlow } from './projection';
import { applyOperationalFunds } from './availableToSpend';
import { projectOperationalFunds, rollUpFundProjection } from '../server/domain/operationalFunds';

describe('forecast detail and 90-day floor', () => {
  it('finds a low beyond a one-month chart, includes allocations, and excludes day 91', () => {
    const anchorDate = '2026-11-25';
    const account = { key: 'plaid:1', balance: 1000 };
    const ledger = projectCashFlow([account], [
      { id: 'bill', accountKey: account.key, date: '2027-01-12', amount: -100, type: 'future' },
      { id: 'later', accountKey: account.key, date: '2027-02-24', amount: -900, type: 'future' },
    ], account.key, 1, { anchorDate, endDate: '2027-02-24' });
    const funds = [{ id: 1, accountKey: account.key, name: 'Saving', fundType: 'sinking', active: true,
      allocationMode: 'scheduled', allocationCents: 10000, initialBalanceCents: 0,
      createdOn: anchorDate, scheduleStartedOn: anchorDate, periodType: 'monthly', anchorDay: 1,
      categoryIds: [], excludedTransactionIds: [], rolloverMode: 'full' }];
    const projection = applyOperationalFunds(ledger, projectOperationalFunds({ funds, accountKey: account.key, anchorDate, endDate: '2027-02-24' }));
    expect(getNinetyDayLow(projection.dailyBalances, anchorDate)).toMatchObject({ date: '2027-02-01', availableBalance: 600 });
    expect(getNinetyDayLow(projection.dailyBalances.slice(0, 30), anchorDate)).toBeNull();
  });

  it('explains every selected-account event and reconciles today without reapplying posted records', () => {
    const account = { key: 'plaid:1', balance: 1000 };
    const rows = [
      { id: 'posted', date: '2026-11-24', amount: -200, type: 'actual', balanceTreatment: 'included' },
      { id: 'placeholder', date: '2026-11-24', amount: -100, type: 'actual', balanceTreatment: 'unreflected' },
      { id: 'today', date: '2026-11-25', amount: -50, type: 'pending' },
      { id: 'lm', date: '2026-12-01', amount: -20, type: 'future', recurringId: 7 },
      { id: 'recurring', date: '2026-12-01', amount: -20, type: 'recurring-projected', recurringId: 7 },
    ].map(event => ({ ...event, accountKey: account.key }));
    const projection = applyOperationalFunds(projectCashFlow([account], rows, account.key, 1, { anchorDate: '2026-11-25' }), {
      days: [{ date: '2026-11-25', totalReservedCents: 30000 }],
    });
    expect(Object.fromEntries(projection.eventDecisions.map(row => [row.id, row.modelTreatment]))).toEqual({
      posted: 'included-in-bank', placeholder: 'opening', today: 'projected', lm: 'projected', recurring: 'recurring-satisfied',
    });
    const opening = projection.openingBalance;
    expect(projection.eventDecisions.reduce((sum, row) => sum + row.todayImpact, 0)).toBe(-150);
    expect(opening.syncedAccountBalance + opening.adjustmentTotal + opening.anchorDateEventTotal - opening.reservedOperationalFunds).toBe(opening.availableToSpend);
    expect(opening.availableToSpend).toBe(550);
  });

  it('uses the parent’s own funded amount for goal pausing while preserving child annotation identity', () => {
    const fund = { active: true, allocationMode: 'scheduled', periodType: 'monthly', fundType: 'sinking', targetCents: 10000 };
    expect(allocationStatus(fund, { remainingCents: 15000, ownRemainingCents: 5000 }).label).toBe('Auto active');
    expect(allocationStatus(fund, { remainingCents: 15000, ownRemainingCents: 10000 }).label).toContain('paused');
    expect(allocationStatus({ ...fund, allocationMode: 'manual' }, {}).label).toBe('Auto off');
    const result = rollUpFundProjection({ currentFunds: [], days: [{ funds: [], boundaryAnnotations: [{ fundId: 2, name: 'Child', allocationCents: 100 }], transactionDrawdowns: [] }] }, [{ id: 1, name: 'Parent' }, { id: 2, parentId: 1, name: 'Child' }]);
    expect(result.days[0].boundaryAnnotations[0]).toMatchObject({ fundId: 1, name: 'Parent', sourceFundId: 2, sourceFundName: 'Child' });
  });
});
