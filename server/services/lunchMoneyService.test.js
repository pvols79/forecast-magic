import { describe, expect, it } from 'vitest';
import { LunchMoneyService } from './lunchMoneyService.js';

describe('LunchMoneyService recurring schedule normalization', () => {
  it('preserves matched, missing, and expected recurring expense occurrences', () => {
    const service = new LunchMoneyService();
    const occurrences = service.normalizeRecurringOccurrences({
      id: 20,
      transaction_criteria: {
        plaid_account_id: 5,
        payee: 'Insurance',
        amount: '100.00',
        category_id: 7,
      },
      matches: {
        expected_occurrence_dates: ['2026-08-14', '2026-08-15', '2026-08-16'],
        found_transactions: [{ date: '2026-08-14', transaction_id: 90 }],
        missing_transaction_dates: ['2026-08-15'],
      },
    });

    expect(occurrences).toMatchObject([
      { date: '2026-08-14', amount: -100, status: 'matched', transactionId: 90 },
      { date: '2026-08-15', amount: -100, status: 'missing' },
      { date: '2026-08-16', amount: -100, status: 'expected' },
    ]);
  });
});
