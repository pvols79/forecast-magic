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

describe('LunchMoneyService transaction balance treatment', () => {
  it('marks a tagged API-created placeholder on a Plaid account as unreflected', () => {
    const service = new LunchMoneyService();
    expect(service.normalizeTransaction({
      id: 90,
      plaid_account_id: 5,
      date: '2026-09-05',
      amount: '82.29',
      payee: 'Tractor Supply',
      source: 'api',
      is_pending: false,
      tag_ids: [41],
    }, '2026-09-05', new Map([[41, 'N8N Pending']]))).toMatchObject({
      accountKey: 'plaid:5',
      amount: -82.29,
      type: 'actual',
      balanceTreatment: 'unreflected',
      tagNames: ['N8N Pending'],
    });
  });

  it('keeps an untagged historical API transaction in the synced balance', () => {
    const service = new LunchMoneyService();
    expect(service.normalizeTransaction({
      id: 92,
      plaid_account_id: 5,
      date: '2026-08-30',
      amount: '24.08',
      payee: 'Spotify',
      source: 'api',
      is_pending: false,
      tag_ids: [],
    }, '2026-09-05')).toMatchObject({
      balanceTreatment: 'included',
    });
  });

  it('marks an imported Plaid transaction as included in the synced balance', () => {
    const service = new LunchMoneyService();
    expect(service.normalizeTransaction({
      id: 91,
      plaid_account_id: 5,
      date: '2026-09-05',
      amount: '82.29',
      payee: 'Tractor Supply',
      source: 'plaid',
      is_pending: false,
    }, '2026-09-05')).toMatchObject({
      balanceTreatment: 'included',
    });
  });
});
