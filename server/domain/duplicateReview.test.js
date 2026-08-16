import { describe, expect, it } from 'vitest';
import {
  buildMetadataMerge, detectDuplicateCandidates, normalizeReviewTransaction,
} from './duplicateReview';

const transaction = overrides => normalizeReviewTransaction({
  id: overrides.id || Math.random().toString(),
  plaid_account_id: 1,
  date: '2026-08-14',
  amount: '20.79',
  payee: 'Spotify',
  source: 'manual',
  category_id: 10,
  notes: '',
  tag_ids: [],
  ...overrides,
}, new Map([[10, 'Entertainment'], [11, 'Subscriptions']]));

const scan = (transactions, options = {}) => detectDuplicateCandidates({ transactions, ...options });

describe('duplicate transaction detection', () => {
  it('classifies a close manual/imported pair with a similar payee as high confidence', () => {
    const candidates = scan([
      transaction({ id: 1, source: 'manual', payee: 'Spotify Family' }),
      transaction({ id: 2, source: 'plaid', payee: 'SPOTIFY FAMILY USA', date: '2026-08-15' }),
    ]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ confidence: 'high', reasons: expect.arrayContaining(['Exact amount', 'Similar payee']) });
  });

  it('treats an API-created transaction as user-entered for duplicate review', () => {
    const candidates = scan([
      transaction({ id: 1, source: 'api', payee: 'Walmart', amount: '50.4200' }),
      transaction({ id: 2, source: 'plaid', payee: 'Walmart', amount: '50.4200' }),
    ]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      confidence: 'high',
      reasons: expect.arrayContaining(['API-created plus imported']),
      manual: { id: '1', source: 'api', origin: 'manual' },
      imported: { id: '2', source: 'plaid', origin: 'imported' },
    });
  });

  it('classifies an exact-amount nearby-date pair with weak payee similarity as medium', () => {
    const candidates = scan([
      transaction({ id: 1, source: 'manual', payee: 'Family music plan', category_id: null }),
      transaction({ id: 2, source: 'plaid', payee: 'PAYMENT PROCESSOR 8842', date: '2026-08-16', category_id: null }),
    ]);
    expect(candidates[0].confidence).toBe('medium');
  });

  it('detects a plausible three-day weak match as low but hides it by default', () => {
    const transactions = [
      transaction({ id: 1, source: 'manual', payee: 'Family music plan', category_id: null }),
      transaction({ id: 2, source: 'plaid', payee: 'PAYMENT PROCESSOR 8842', date: '2026-08-17', category_id: null }),
    ];
    expect(scan(transactions)).toEqual([]);
    expect(scan(transactions, { includeLow: true })[0].confidence).toBe('low');
  });

  it('never matches different accounts, amounts, or dates outside three days', () => {
    const manual = transaction({ id: 1, source: 'manual' });
    expect(scan([manual, transaction({ id: 2, source: 'plaid', plaid_account_id: 2 })])).toEqual([]);
    expect(scan([manual, transaction({ id: 3, source: 'plaid', amount: '21.79' })])).toEqual([]);
    expect(scan([manual, transaction({ id: 4, source: 'plaid', date: '2026-08-18' })])).toEqual([]);
  });

  it('does not treat manual/manual or imported/imported pairs as the primary duplicate scenario', () => {
    expect(scan([
      transaction({ id: 1, source: 'manual' }),
      transaction({ id: 2, source: 'manual' }),
    ])).toEqual([]);
    expect(scan([
      transaction({ id: 3, source: 'plaid' }),
      transaction({ id: 4, source: 'plaid' }),
    ])).toEqual([]);
  });

  it('suppresses only the exact ignored pair', () => {
    const manual = transaction({ id: 1, source: 'manual' });
    const firstImported = transaction({ id: 2, source: 'plaid' });
    const secondImported = transaction({ id: 3, source: 'plaid' });
    const candidates = scan([manual, firstImported, secondImported], {
      ignoredPairIds: new Set(['1:2']),
    });
    expect(candidates.map(candidate => candidate.id)).toEqual(['1:3']);
  });
});

describe('duplicate metadata merge', () => {
  it('preserves imported identity fields while applying manual metadata', () => {
    const manual = transaction({
      id: 1, source: 'manual', payee: 'Spotify Family', category_id: 10,
      notes: 'Family plan', tag_ids: [1, 2], recurring_id: 8,
    });
    const imported = transaction({
      id: 2, source: 'plaid', payee: 'SPOTIFY USA', category_id: 11,
      notes: 'Imported note', tag_ids: [2, 3], recurring_id: null,
      date: '2026-08-15', amount: '20.79',
    });
    const merge = buildMetadataMerge(manual, imported);

    expect(merge.update).toEqual({
      payee: 'Spotify Family',
      category_id: 10,
      notes: 'Imported note\n\nManual note: Family plan',
      tag_ids: [1, 2, 3],
      recurring_id: '8',
    });
    expect(merge.update).not.toHaveProperty('id');
    expect(merge.update).not.toHaveProperty('date');
    expect(merge.update).not.toHaveProperty('amount');
    expect(merge.update).not.toHaveProperty('plaid_account_id');
    expect(merge.conflicts).toMatchObject({ category: true, notes: true, recurring: false });
  });
});
