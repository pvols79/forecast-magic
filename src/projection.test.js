import { describe, expect, it } from 'vitest';
import { projectCashFlow } from './projection';

const checkingAccount = { id: 1, source: 'plaid', key: 'plaid:1', name: 'Checking', balance: 3000 };
const savingsAccount = { id: 2, source: 'manual', key: 'manual:2', name: 'Savings', balance: 500 };
const balanceOn = (projection, date) => projection.dailyBalances.find(day => day.date === date)?.balance;

describe('projectCashFlow', () => {
  it('projects deterministic daily ledger balances from normalized events', () => {
    const projection = projectCashFlow(
      [checkingAccount],
      [
        { id: 'spotify', accountKey: 'plaid:1', date: '2026-08-12', description: 'Spotify', amount: -20.79, type: 'future' },
        { id: 'paycheck', accountKey: 'plaid:1', date: '2026-08-14', description: 'Cisco paycheck', amount: 6323.30, type: 'future' },
        { id: 'mortgage', accountKey: 'plaid:1', date: '2026-08-15', description: 'Mortgage', amount: -2940, type: 'future' },
      ],
      'plaid:1',
      1,
      { anchorDate: '2026-08-11' }
    );

    expect(balanceOn(projection, '2026-08-11')).toBe(3000);
    expect(balanceOn(projection, '2026-08-12')).toBeCloseTo(2979.21);
    expect(balanceOn(projection, '2026-08-14')).toBeCloseTo(9302.51);
    expect(balanceOn(projection, '2026-08-15')).toBeCloseTo(6362.51);
  });

  it('does not duplicate recurring projections with a matching real transaction', () => {
    const projection = projectCashFlow(
      [checkingAccount],
      [
        { id: 'transaction:spotify', accountKey: 'plaid:1', date: '2026-08-12', description: 'Spotify', amount: -20.79, type: 'pending', transactionId: 20, recurringId: 10 },
        { id: 'recurring:spotify', accountKey: 'plaid:1', date: '2026-08-12', description: 'Spotify', amount: -20.79, type: 'recurring-projected', recurringId: 10 },
      ],
      'plaid:1',
      1,
      { anchorDate: '2026-08-11' }
    );

    expect(balanceOn(projection, '2026-08-12')).toBeCloseTo(2979.21);
  });

  it('ignores events from other accounts', () => {
    const projection = projectCashFlow(
      [checkingAccount, savingsAccount],
      [{ id: 'other', accountKey: 'manual:2', date: '2026-08-12', description: 'Other account', amount: -1000, type: 'future' }],
      'plaid:1',
      1,
      { anchorDate: '2026-08-11' }
    );
    expect(balanceOn(projection, '2026-08-12')).toBe(3000);
  });

  it('applies missed recurring occurrences on or before the anchor as opening adjustments', () => {
    const projection = projectCashFlow(
      [checkingAccount],
      [
        { id: 'past', accountKey: 'plaid:1', date: '2026-08-10', description: 'Past missed bill', amount: -100, type: 'recurring-projected', recurringId: 10 },
        { id: 'today', accountKey: 'plaid:1', date: '2026-08-11', description: 'Today missed bill', amount: -200, type: 'recurring-projected', recurringId: 11 },
        { id: 'future', accountKey: 'plaid:1', date: '2026-08-12', description: 'Future bill', amount: -300, type: 'recurring-projected', recurringId: 12 },
      ],
      'plaid:1',
      1,
      { anchorDate: '2026-08-11' }
    );

    expect(balanceOn(projection, '2026-08-11')).toBe(2700);
    expect(balanceOn(projection, '2026-08-12')).toBe(2400);
    expect(projection.historicalMissedEvents).toHaveLength(2);
    expect(projection.openingBalance).toMatchObject({
      syncedAccountBalance: 3000,
      adjustmentTotal: -300,
      ledgerBalance: 2700,
      anchorDateEventTotal: 0,
      projectedLedgerBalance: 2700,
    });
    expect(projection.openingBalance.adjustmentEvents).toHaveLength(2);
    expect(projection.keyEvents).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ description: 'Past missed bill' }),
    ]));
    expect(projection.keyEvents).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ description: 'Starting Balance' }),
    ]));
  });

  it('applies a manually created recurring transaction not reflected in the synced balance', () => {
    const projection = projectCashFlow(
      [checkingAccount],
      [{
        id: 'transaction:paycheck',
        accountKey: 'plaid:1',
        date: '2026-08-10',
        description: 'Cisco paycheck',
        amount: 9045.15,
        type: 'actual',
        recurringId: 20,
        lunchMoneySource: 'recurring',
      }],
      'plaid:1',
      1,
      { anchorDate: '2026-08-11' }
    );

    expect(balanceOn(projection, '2026-08-11')).toBeCloseTo(12045.15);
    expect(projection.historicalMissedEvents).toHaveLength(0);
    expect(projection.openingBalance.adjustmentEvents).toEqual([
      expect.objectContaining({ description: 'Cisco paycheck', amount: 9045.15 }),
    ]);
  });

  it('does not reapply an imported posted transaction already reflected in the synced balance', () => {
    const projection = projectCashFlow(
      [checkingAccount],
      [{
        id: 'transaction:posted-paycheck',
        accountKey: 'plaid:1',
        date: '2026-08-10',
        description: 'Posted paycheck',
        amount: 9045.15,
        type: 'actual',
        recurringId: 20,
        lunchMoneySource: 'plaid',
      }],
      'plaid:1',
      1,
      { anchorDate: '2026-08-11' }
    );

    expect(balanceOn(projection, '2026-08-11')).toBe(3000);
  });

  it('reports anchor-date activity separately in the opening reconciliation', () => {
    const projection = projectCashFlow(
      [checkingAccount],
      [{
        id: 'transaction:pending-bill',
        accountKey: 'plaid:1',
        date: '2026-08-11',
        description: 'Pending bill',
        amount: -100,
        type: 'pending',
      }],
      'plaid:1',
      1,
      { anchorDate: '2026-08-11' }
    );

    expect(projection.openingBalance).toMatchObject({
      syncedAccountBalance: 3000,
      adjustmentTotal: 0,
      ledgerBalance: 3000,
      anchorDateEventTotal: -100,
      projectedLedgerBalance: 2900,
    });
    expect(projection.openingBalance.anchorDateEvents).toEqual([
      expect.objectContaining({ description: 'Pending bill', amount: -100 }),
    ]);
  });
});
