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


describe('Forecast verified replacements', () => {
  const transaction = { id: 42, plaid_account_id: 5, date: '2026-09-05', amount: '75',
    source: 'manual', is_pending: true, tag_ids: [41] };
  const entry = { accountKey: 'plaid:5', transactionId: '42', reason: 'Retained replacement',
    snapshot: { date: '2026-09-05', amountCents: -7500, source: 'manual' } };
  it('loads clearances in the real forecast read path and includes settled history exactly once', async () => {
    const list = vi.fn(() => [entry]);
    const service = new LunchMoneyService(undefined, { list });
    service.getRawTransactions = vi.fn(async () => [transaction]);
    service.getTags = vi.fn(async () => [{ id: 41, name: 'LM Manual' }]);
    const events = await service.getTransactions('2026-09-01', '2026-10-16', '2026-10-16');
    expect(list).toHaveBeenCalledWith('plaid:5');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'actual', balanceTreatment: 'included', isPending: false,
      amount: -75, lmIsPending: true, effectiveStatus: 'cleared', tagNames: ['LM Manual'] });
    expect(transaction.is_pending).toBe(true);
  });
  it.each([{ amount: '76' }, { date: '2026-09-06' }, { source: 'api' }])('rejects changed clearance snapshots: %j', change => {
    const service = new LunchMoneyService();
    expect(service.normalizeTransaction({ ...transaction, ...change }, '2026-10-16',
      new Map([[41, 'LM Manual']]), [entry])).toMatchObject({
      clearanceNeedsReview: true, balanceTreatment: 'unreflected', isPending: true,
    });
  });
});


it('fetches every transaction page for long audit windows', async () => {
  const service = new LunchMoneyService();
  service.get = vi.fn()
    .mockResolvedValueOnce({ transactions: [{ id: 1 }], has_more: true })
    .mockResolvedValueOnce({ transactions: [{ id: 2 }], has_more: false });
  expect(await service.getRawTransactions('2026-01-01', '2026-10-16', { includeMetadata: true }))
    .toEqual([{ id: 1 }, { id: 2 }]);
  expect(service.get).toHaveBeenLastCalledWith('/transactions', expect.objectContaining({
    offset: 2000, include_metadata: true, start_date: '2026-01-01', end_date: '2026-10-16',
  }));
});
