import { describe, expect, it, vi } from 'vitest';
import { normalizeReviewTransaction, transactionFingerprint } from '../domain/duplicateReview';
import { DuplicateReviewService } from './duplicateReviewService';

const raw = overrides => ({
  id: 1,
  plaid_account_id: 1,
  date: '2026-08-14',
  amount: '20.79',
  payee: 'Spotify Family',
  source: 'manual',
  category_id: 10,
  notes: 'Manual note',
  tag_ids: [1],
  recurring_id: null,
  ...overrides,
});

const fingerprints = (manualRaw, importedRaw) => ({
  manualFingerprint: transactionFingerprint(normalizeReviewTransaction(manualRaw)),
  importedFingerprint: transactionFingerprint(normalizeReviewTransaction(importedRaw)),
});

const setup = ({ updateError, deleteError } = {}) => {
  const manual = raw({ id: 1, source: 'manual' });
  const imported = raw({
    id: 2, source: 'plaid', date: '2026-08-15', payee: 'SPOTIFY USA',
    category_id: 11, notes: 'Imported note', tag_ids: [2],
  });
  const calls = [];
  const lunchMoney = {
    getRawTransactions: vi.fn(async () => [manual, imported]),
    getCategories: vi.fn(async () => [
      { id: 10, name: 'Entertainment' }, { id: 11, name: 'Subscriptions' },
    ]),
    getTransaction: vi.fn(async id => String(id) === '1' ? manual : imported),
    updateTransaction: vi.fn(async (id, update) => {
      calls.push(['update', String(id), update]);
      if (updateError) throw updateError;
      return { ...imported, ...update };
    }),
    deleteTransaction: vi.fn(async id => {
      calls.push(['delete', String(id)]);
      if (deleteError) throw deleteError;
      return true;
    }),
  };
  const ignored = new Set();
  const repository = {
    listIgnoredPairIds: vi.fn(() => ignored),
    ignore: vi.fn(pair => {
      ignored.add(`${pair.manualTransactionId}:${pair.importedTransactionId}`);
      return pair;
    }),
  };
  const settings = { get: vi.fn(() => 'UTC') };
  return { service: new DuplicateReviewService(lunchMoney, repository, settings), manual, imported, calls, repository };
};

describe('DuplicateReviewService', () => {
  it('filters ignored pairs across scans and keeps similar unignored pairs independent', async () => {
    const { service, repository } = setup();
    expect((await service.scan('plaid:1', { anchorDate: '2026-08-15' })).candidates).toHaveLength(1);
    service.ignore({ accountKey: 'plaid:1', manualTransactionId: '1', importedTransactionId: '2' });
    expect(repository.ignore).toHaveBeenCalled();
    expect((await service.scan('plaid:1', { anchorDate: '2026-08-15' })).candidates).toHaveLength(0);
  });

  it('updates the imported transaction before deleting the manual transaction', async () => {
    const { service, manual, imported, calls } = setup();
    const result = await service.resolve({
      accountKey: 'plaid:1', manualTransactionId: '1', importedTransactionId: '2',
      ...fingerprints(manual, imported),
    });
    expect(calls.map(call => call.slice(0, 2))).toEqual([['update', '2'], ['delete', '1']]);
    expect(calls[0][2]).toMatchObject({
      payee: 'Spotify Family', category_id: 10,
      notes: 'Imported note\n\nManual note: Manual note', tag_ids: [1, 2],
    });
    expect(calls[0][2]).not.toHaveProperty('date');
    expect(calls[0][2]).not.toHaveProperty('amount');
    expect(result).toMatchObject({ keptTransactionId: '2', deletedTransactionId: '1' });
  });

  it('does not delete the manual transaction when the metadata update fails', async () => {
    const { service, manual, imported, calls } = setup({ updateError: new Error('Update failed') });
    await expect(service.resolve({
      accountKey: 'plaid:1', manualTransactionId: '1', importedTransactionId: '2',
      ...fingerprints(manual, imported),
    })).rejects.toThrow('Update failed');
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('update');
  });

  it('surfaces a deletion failure after the imported metadata update succeeds', async () => {
    const { service, manual, imported, calls } = setup({ deleteError: new Error('Delete failed') });
    await expect(service.resolve({
      accountKey: 'plaid:1', manualTransactionId: '1', importedTransactionId: '2',
      ...fingerprints(manual, imported),
    })).rejects.toThrow('Delete failed');
    expect(calls.map(call => call.slice(0, 2))).toEqual([['update', '2'], ['delete', '1']]);
  });

  it('returns only high and medium candidates in the read-only reporting summary', async () => {
    const { service } = setup();
    const summary = await service.getReportingSummary('plaid:1', '2026-08-15');
    expect(summary).toMatchObject({
      window: { startDate: '2026-07-17', endDate: '2026-08-15' },
      needsReview: 1,
      confidenceCounts: { high: 0, medium: 1, low: 0 },
    });
    expect(summary.candidates[0]).toMatchObject({
      confidence: 'medium',
      manual: { transactionId: '1', amountCents: -2079, source: 'manual' },
      imported: { transactionId: '2', amountCents: -2079, source: 'plaid' },
    });
    expect(summary.candidates[0]).not.toHaveProperty('manualFingerprint');
    expect(summary.candidates[0]).not.toHaveProperty('mergePreview');
  });

  it('stops when either transaction changed after the scan', async () => {
    const { service, manual, imported, calls } = setup();
    await expect(service.resolve({
      accountKey: 'plaid:1', manualTransactionId: '1', importedTransactionId: '2',
      ...fingerprints({ ...manual, payee: 'Old name' }, imported),
    })).rejects.toMatchObject({ status: 409 });
    expect(calls).toEqual([]);
  });
});
