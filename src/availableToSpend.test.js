import { describe, expect, it } from 'vitest';
import { projectOperationalFunds } from '../server/domain/operationalFunds';
import { applyOperationalFunds } from './availableToSpend';

const ledger = balance => ({
  dailyBalances: [{ date: '2026-08-13', balance }],
  keyEvents: [],
  negativeBalanceAlerts: [],
  historicalMissedEvents: [],
  openingBalance: {
    date: '2026-08-13',
    syncedAccountBalance: balance,
    adjustmentEvents: [],
    adjustmentTotal: 0,
    ledgerBalance: balance,
    anchorDateEvents: [],
    anchorDateEventTotal: 0,
    projectedLedgerBalance: balance,
  },
});

const funds = (reservedCents, currentFunds = []) => ({
  currentReservedCents: reservedCents,
  currentFunds,
  days: [{ date: '2026-08-13', totalReservedCents: reservedCents, funds: currentFunds, boundaryAnnotations: [] }],
});

describe('available-to-spend projection', () => {
  it('subtracts an all-time reservation from the ledger', () => {
    const result = applyOperationalFunds(ledger(5000), funds(100000));
    expect(result.dailyBalances[0].availableBalance).toBe(4000);
    expect(result.openingBalance).toMatchObject({
      syncedAccountBalance: 5000,
      reservedOperationalFunds: 1000,
      availableToSpend: 4000,
    });
  });

  it('does not reduce available-to-spend twice while reserved spending is covered', () => {
    const before = applyOperationalFunds(ledger(5000), funds(15000));
    const afterFiftyDollarPurchase = applyOperationalFunds(ledger(4950), funds(10000));
    expect(before.dailyBalances[0].availableBalance).toBe(4850);
    expect(afterFiftyDollarPurchase.dailyBalances[0].availableBalance).toBe(4850);
  });

  it('reduces available-to-spend after spending exceeds the Fund', () => {
    const afterOneHundredEightyDollarsSpending = applyOperationalFunds(ledger(4820), funds(0));
    expect(afterOneHundredEightyDollarsSpending.dailyBalances[0].availableBalance).toBe(4820);
  });

  it('keeps an excluded Fund transaction in the ledger calculation', () => {
    const before = applyOperationalFunds(ledger(5000), funds(15000));
    const afterExcludedPurchase = applyOperationalFunds(ledger(4950), funds(15000));

    expect(before.dailyBalances[0].availableBalance).toBe(4850);
    expect(afterExcludedPurchase.dailyBalances[0].availableBalance).toBe(4800);
  });

  it('passes Operational Fund state separately from Key Events', () => {
    const currentFunds = [{ id: 1, name: 'Fuel', remainingCents: 2500, householdVisible: true }];
    const result = applyOperationalFunds(ledger(5000), funds(2500, currentFunds));
    expect(result.operationalFunds).toEqual(currentFunds);
    expect(result.keyEvents).toEqual([]);
  });

  it('passes the complete Phase II reservation and drawdown scenario', () => {
    const baseFund = {
      accountKey: 'plaid:1',
      periodType: 'weekly',
      weeklyStartDay: 1,
      anchorMonth: null,
      anchorDay: null,
      rolloverMode: 'none',
      rolloverCapCents: null,
      targetCents: null,
      householdVisible: true,
      active: true,
      createdOn: '2026-08-10',
      excludedTransactionIds: [],
    };
    const operationalFunds = [
      { ...baseFund, id: 1, name: 'Weekly Fuel', allocationCents: 15000, categoryIds: [10] },
      { ...baseFund, id: 2, name: 'Weekly Dining', allocationCents: 10000, categoryIds: [11] },
      { ...baseFund, id: 3, name: 'Emergency', allocationCents: 100000, periodType: 'all-time', categoryIds: [] },
    ];
    const fuelPurchase = amount => ({
      transactionId: `fuel-${amount}`,
      accountKey: 'plaid:1',
      categoryId: 10,
      date: '2026-08-12',
      description: 'Fuel purchase',
      amount,
      type: 'actual',
    });
    const reserveProjection = transactions => projectOperationalFunds({
      funds: operationalFunds,
      transactions,
      anchorDate: '2026-08-13',
      endDate: '2026-08-13',
    });

    const before = applyOperationalFunds(ledger(5000), reserveProjection([]));
    const coveredPurchase = applyOperationalFunds(ledger(4950), reserveProjection([fuelPurchase(-50)]));
    const beyondZero = applyOperationalFunds(ledger(4820), reserveProjection([fuelPurchase(-180)]));

    expect(before.currentReservedOperationalFunds).toBe(1250);
    expect(before.dailyBalances[0].availableBalance).toBe(3750);
    expect(coveredPurchase.currentReservedOperationalFunds).toBe(1200);
    expect(coveredPurchase.dailyBalances[0].availableBalance).toBe(3750);
    expect(beyondZero.currentReservedOperationalFunds).toBe(1100);
    expect(beyondZero.dailyBalances[0].availableBalance).toBe(3720);
  });
});
