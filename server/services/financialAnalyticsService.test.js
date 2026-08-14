import { describe, expect, it } from 'vitest';
import { FinancialAnalyticsService } from './financialAnalyticsService.js';

describe('FinancialAnalyticsService', () => {
  it('composes a six-month structured overview without report UI logic', async () => {
    const account = {
      id: 1, source: 'plaid', key: 'plaid:1', name: 'Checking', balance: 3000,
    };
    const lunchMoney = {
      getManualAccounts: async () => [],
      getPlaidAccounts: async () => [account],
      getCategories: async () => [{ id: 10, name: 'Groceries', excludeFromTotals: false }],
      getTransactions: async () => [{
        id: 'transaction:1', transactionId: 1, accountKey: 'plaid:1', categoryId: 10,
        date: '2026-08-10', description: 'Kroger', amount: -50, type: 'actual',
        recurringId: null, lunchMoneySource: 'plaid',
      }],
      getRecurringData: async () => ({
        events: [{
          id: 'recurring:2:2026-08-15', recurringId: 2, accountKey: 'plaid:1',
          date: '2026-08-15', description: 'Bill', amount: -100, type: 'recurring-projected',
        }],
        occurrences: [{
          id: 'recurring-occurrence:2:2026-08-15', recurringId: 2, accountKey: 'plaid:1',
          date: '2026-08-15', description: 'Bill', amount: -100,
          type: 'recurring-occurrence', status: 'missing',
        }],
      }),
    };
    const fundService = {
      getProjection: async () => ({ currentFunds: [], currentReservedCents: 0, days: [] }),
    };
    const service = new FinancialAnalyticsService({
      lunchMoney,
      fundRepository: {},
      fundService,
    });

    const result = await service.getOverview('plaid:1', '2026-08-14');
    expect(result.account).toMatchObject({ key: 'plaid:1', name: 'Checking' });
    expect(result.cashPosition.availableToday.availableCents).toBe(300000);
    expect(result.cashPosition.sixMonthSnapshot.date).toBe('2027-02-14');
    expect(result.cashPosition.projectionSeries.at(-1).date).toBe('2027-02-14');
    expect(result.needsAttention.dueWithin48Hours).toHaveLength(1);
    expect(result.spendingTrends.topCategories[0]).toMatchObject({ categoryName: 'Groceries', amountCents: 5000 });
    expect(result.unallocatedSpending.totalCents).toBe(5000);
    expect(result.funds).toEqual([]);

    const dailyHighlight = await service.getDailyHighlight('plaid:1', '2026-08-14');
    expect(dailyHighlight).toMatchObject({
      schemaVersion: '1.0',
      reportDate: '2026-08-14',
      account: { key: 'plaid:1', name: 'Checking' },
    });
  });
});
