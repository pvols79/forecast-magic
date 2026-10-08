import { describe, expect, it, vi } from 'vitest';
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

  it('does not project a missing recurring item when Lunch Money found it on a nearby date', () => {
    const service = new LunchMoneyService();
    const events = service.normalizeRecurringItem({
      id: 3146050,
      transaction_criteria: {
        plaid_account_id: 450375,
        payee: 'Spotify',
        amount: '24.08',
        category_id: 3212061,
      },
      matches: {
        missing_transaction_dates: ['2026-09-30'],
        found_transactions: [{ date: '2026-10-01', transaction_id: 2501271667 }],
      },
    });

    expect(events).toEqual([]);
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
    }, '2026-09-05', new Map([[41, 'Forecast Magic Pending']]))).toMatchObject({
      accountKey: 'plaid:5',
      amount: -82.29,
      type: 'actual',
      balanceTreatment: 'unreflected',
      tagNames: ['Forecast Magic Pending'],
    });
  });

  it.each(['n8n_proc', 'N8N Pending'])('marks an API entry with %s as unreflected', tag => {
    const service = new LunchMoneyService();
    expect(service.normalizeTransaction({
      id: 93, plaid_account_id: 5, date: '2026-09-05', amount: '100.00',
      source: 'api', is_pending: false, tag_ids: [41],
    }, '2026-09-05', new Map([[41, tag]])).balanceTreatment).toBe('unreflected');
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

describe('LunchMoneyService recurring item API compatibility', () => {
  it('falls back to /recurring when /recurring_items is unavailable for suggestions', async () => {
    const service = new LunchMoneyService();
    service.get = vi.fn()
      .mockRejectedValueOnce({ response: { status: 404 } })
      .mockResolvedValueOnce({
        recurring: [
          { id: 1, status: 'suggested', transaction_criteria: { payee: 'Gym' } },
          { id: 2, status: 'reviewed', transaction_criteria: { payee: 'Ignored' } },
        ],
      });

    const suggestions = await service.getSuggestedRecurringItems();

    expect(service.get).toHaveBeenNthCalledWith(1, '/recurring_items', { include_suggested: true });
    expect(service.get).toHaveBeenNthCalledWith(2, '/recurring', { include_suggested: true });
    expect(suggestions).toMatchObject([{ id: 1 }]);
  });

  it('falls back to /recurring when deleting a recurring item by /recurring_items returns 404', async () => {
    const service = new LunchMoneyService();
    service.delete = vi.fn()
      .mockRejectedValueOnce({ response: { status: 404 } })
      .mockResolvedValueOnce(true);

    await expect(service.deleteRecurringItem(123)).resolves.toBe(true);

    expect(service.delete).toHaveBeenNthCalledWith(1, '/recurring_items/123');
    expect(service.delete).toHaveBeenNthCalledWith(2, '/recurring/123');
  });
});
