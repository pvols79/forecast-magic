import { describe, expect, it } from 'vitest';
import {
  householdFundCards, summarizeCashPosition, summarizeRecurringAttention,
  summarizeSpendingTrends, summarizeUnallocatedSpending,
} from './financialAnalytics.js';

const transaction = overrides => ({
  transactionId: 1,
  accountKey: 'plaid:1',
  categoryId: 1,
  date: '2026-08-14',
  description: 'Merchant',
  amount: -10,
  type: 'actual',
  recurringId: null,
  lunchMoneySource: 'plaid',
  ...overrides,
});

const categories = [
  { id: 1, name: 'Auto Fuel', groupName: 'Transportation' },
  { id: 2, name: 'Restaurants', groupName: 'Food' },
  { id: 3, name: 'Groceries', groupName: 'Food' },
  { id: 4, name: 'Shopping', groupName: null },
  { id: 5, name: 'Transfers', groupName: null, excludeFromTotals: true },
];

describe('Financial analytics', () => {
  it('returns available today, forward lows, and the six-month endpoint', () => {
    const result = summarizeCashPosition({ dailyBalances: [
      { date: '2026-08-14', balance: 1000, ledgerBalance: 1200, reservedOperationalFunds: 200 },
      { date: '2026-08-20', balance: 700, ledgerBalance: 900, reservedOperationalFunds: 200 },
      { date: '2026-09-20', balance: 500, ledgerBalance: 800, reservedOperationalFunds: 300 },
      { date: '2027-02-14', balance: 1600, ledgerBalance: 2000, reservedOperationalFunds: 400 },
    ] }, '2026-08-14');

    expect(result.availableToday).toMatchObject({ availableCents: 100000, ledgerBalanceCents: 120000 });
    expect(result.thirtyDayLow).toMatchObject({ date: '2026-08-20', availableCents: 70000 });
    expect(result.ninetyDayLow).toMatchObject({ date: '2026-09-20', availableCents: 50000 });
    expect(result.sixMonthSnapshot).toMatchObject({ date: '2027-02-14', availableCents: 160000 });
    expect(result.projectionSeries).toEqual([
      { date: '2026-08-14', availableCents: 100000, ledgerBalanceCents: 120000, reservedFundCents: 20000 },
      { date: '2026-08-20', availableCents: 70000, ledgerBalanceCents: 90000, reservedFundCents: 20000 },
      { date: '2026-09-20', availableCents: 50000, ledgerBalanceCents: 80000, reservedFundCents: 30000 },
      { date: '2027-02-14', availableCents: 160000, ledgerBalanceCents: 200000, reservedFundCents: 40000 },
    ]);
  });

  it('separates past-due recurring occurrences from those due within 48 hours', () => {
    const event = (date, id) => ({
      id, recurringId: 10, accountKey: 'plaid:1', date,
      description: 'Bill', amount: -50, type: 'recurring-projected',
    });
    const result = summarizeRecurringAttention([
      event('2026-08-12', 'past'),
    ], [
      { ...event('2026-08-14', 'matched-today'), type: 'recurring-occurrence', status: 'matched', transactionId: 100 },
      { ...event('2026-08-14', 'unmatched-today'), type: 'recurring-occurrence', status: 'expected' },
      { ...event('2026-08-16', 'two-days'), type: 'recurring-occurrence', status: 'missing' },
      { ...event('2026-08-17', 'later'), type: 'recurring-occurrence', status: 'expected' },
      { ...event('2026-08-15', 'income'), type: 'recurring-occurrence', amount: 500, status: 'expected' },
      { ...event('2026-08-15', 'other-account'), type: 'recurring-occurrence', accountKey: 'plaid:2' },
    ], 'plaid:1', '2026-08-14');

    expect(result.pastDueRecurring.map(item => item.id)).toEqual(['past']);
    expect(result.dueWithin48Hours.map(item => item.id)).toEqual(['unmatched-today', 'two-days']);
    expect(result.dueWithin48Hours.map(item => item.status)).toEqual(['expected', 'missing']);
  });

  it('calculates top categories and named 30-day spending trends', () => {
    const result = summarizeSpendingTrends([
      transaction({ transactionId: 1, categoryId: 1, amount: -100 }),
      transaction({ transactionId: 2, categoryId: 2, amount: -200 }),
      transaction({ transactionId: 3, categoryId: 3, amount: -300 }),
      transaction({ transactionId: 4, categoryId: 4, amount: -400 }),
      transaction({ transactionId: 5, categoryId: 1, date: '2026-07-10', amount: -50 }),
      transaction({ transactionId: 6, categoryId: 2, date: '2026-07-10', amount: -250 }),
      transaction({ transactionId: 7, categoryId: 5, amount: -999 }),
    ], categories, 'plaid:1', '2026-08-14');

    expect(result.currentWindow).toEqual({ startDate: '2026-07-16', endDate: '2026-08-14' });
    expect(result.topCategories.map(item => item.categoryName)).toEqual(['Shopping', 'Groceries', 'Restaurants']);
    expect(result.tracked.gas).toMatchObject({ currentCents: 10000, previousCents: 5000, direction: 'up' });
    expect(result.tracked.dining).toMatchObject({ currentCents: 20000, previousCents: 25000, direction: 'down' });
    expect(result.tracked.groceries).toMatchObject({ currentCents: 30000, previousCents: 0, direction: 'new' });
  });

  it('defines unallocated spending as neither Fund-mapped nor recurring', () => {
    const result = summarizeUnallocatedSpending([
      transaction({ transactionId: 1, categoryId: 1, description: 'Fuel', amount: -100 }),
      transaction({ transactionId: 2, categoryId: 2, description: 'Cafe', amount: -75 }),
      transaction({ transactionId: 3, categoryId: 3, description: 'Kroger', amount: -300 }),
      transaction({ transactionId: 4, categoryId: 4, description: 'Planned purchase', amount: -500, recurringId: 44 }),
      transaction({ transactionId: 5, categoryId: 5, description: 'Transfer', amount: -900 }),
      transaction({ transactionId: 6, categoryId: 2, description: 'Cafe', amount: -50 }),
    ], categories, [{ categoryIds: [1] }], 'plaid:1', '2026-08-14');

    expect(result.totalCents).toBe(42500);
    expect(result.transactionCount).toBe(3);
    expect(result.topExpenditures.map(item => item.transactionId)).toEqual([3, 2, 6]);
    expect(result.largestExpense).toMatchObject({ transactionId: 3, amountCents: 30000 });
    expect(result.topPayee).toEqual({ payee: 'Kroger', amountCents: 30000, transactionCount: 1 });
  });

  it('returns only Household-visible Fund card fields', () => {
    const result = householdFundCards([
      {
        id: 1, accountKey: 'plaid:1', name: 'Groceries', fundType: 'operating',
        allocationMode: 'scheduled', periodType: 'weekly', periodStart: '2026-08-10',
        periodEnd: '2026-08-16', remainingCents: 10000, targetCents: null,
        scheduledAllocationCents: 40000, householdVisible: true, transactions: [{ id: 1 }],
      },
      { id: 2, name: 'Private', householdVisible: false, remainingCents: 50000 },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ name: 'Groceries', remainingCents: 10000 });
    expect(result[0]).not.toHaveProperty('transactions');
  });
});
