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
        }, {
          id: 'recurring-occurrence:3:2026-08-15', recurringId: 3, accountKey: 'plaid:1',
          date: '2026-08-15', description: 'Already paid', amount: -200,
          type: 'recurring-occurrence', status: 'expected',
        }],
      }),
    };
    const fund = (id, name, householdVisible) => ({
      id, accountKey: 'plaid:1', name, fundType: 'operating', allocationMode: 'scheduled',
      periodType: 'monthly', periodStart: '2026-08-01', periodEnd: '2026-08-31',
      remainingCents: 10000, targetCents: null, scheduledAllocationCents: 10000,
      householdVisible,
    });
    const fundService = {
      getProjection: async () => ({
        currentFunds: [fund(1, 'Shared', true), fund(2, 'Private', false)],
        currentReservedCents: 0,
        days: [],
      }),
    };
    const duplicateReviewService = {
      getReportingSummary: async () => ({
        window: { startDate: '2026-07-16', endDate: '2026-08-14' },
        needsReview: 1,
        confidenceCounts: { high: 1, medium: 0, low: 0 },
        candidates: [{ id: '1:2', confidence: 'high' }],
      }),
    };
    const service = new FinancialAnalyticsService({
      lunchMoney,
      fundRepository: {},
      fundService,
      duplicateReviewService,
    });

    const result = await service.getOverview('plaid:1', '2026-08-14');
    expect(result.account).toMatchObject({ key: 'plaid:1', name: 'Checking' });
    expect(result.cashPosition.availableToday.availableCents).toBe(300000);
    expect(result.cashPosition.sixMonthSnapshot.date).toBe('2027-02-14');
    expect(result.cashPosition.projectionSeries.at(-1).date).toBe('2027-02-14');
    expect(result.needsAttention.dueWithin48Hours).toHaveLength(1);
    expect(result.needsAttention.dueWithin48Hours[0].description).toBe('Bill');
    expect(result.spendingTrends.topCategories[0]).toMatchObject({ categoryName: 'Groceries', amountCents: 5000 });
    expect(result.unallocatedSpending.totalCents).toBe(5000);
    expect(result.funds.map(fundItem => fundItem.name)).toEqual(['Shared']);

    const dailyHighlight = await service.getDailyHighlight('plaid:1', '2026-08-14', {
      view: 'admin', timezone: 'America/Chicago', currency: 'USD',
    });
    expect(dailyHighlight).toMatchObject({
      schemaVersion: '1.2',
      reportDate: '2026-08-14',
      reportContext: {
        view: 'admin', timezone: 'America/Chicago', currency: 'USD', projectionHorizonDays: 184,
      },
      account: { key: 'plaid:1', name: 'Checking' },
      duplicateReview: {
        needsReview: 1,
        confidenceCounts: { high: 1, medium: 0, low: 0 },
      },
    });
    expect(dailyHighlight.funds.map(fundItem => fundItem.name)).toEqual(['Shared', 'Private']);

    const householdHighlight = await service.getDailyHighlight('plaid:1', '2026-08-14', {
      view: 'household', timezone: 'America/Chicago', currency: 'USD',
    });
    expect(householdHighlight.reportContext.view).toBe('household');
    expect(householdHighlight.funds.map(fundItem => fundItem.name)).toEqual(['Shared']);
    expect(householdHighlight).not.toHaveProperty('duplicateReview');
  });
});
