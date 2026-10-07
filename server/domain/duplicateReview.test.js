import { describe, expect, it } from 'vitest';
import {
  buildMetadataMerge, detectDuplicateCandidates, normalizeReviewTransaction,
} from './duplicateReview';

const tagNames = new Map([[1, 'LM Manual'], [2, 'Forecast Magic Pending'], [3, 'Household']]);

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
}, new Map([[10, 'Entertainment'], [11, 'Subscriptions']]), tagNames);

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

  it('allows a strong API-created/imported match across a four-day settlement delay', () => {
    const candidates = scan([
      transaction({
        id: 1,
        source: 'api',
        date: '2026-09-05',
        payee: 'Google One',
        amount: '21.9400',
        category_id: 11,
      }),
      transaction({
        id: 2,
        source: 'plaid',
        date: '2026-09-09',
        payee: 'Google One',
        amount: '21.9400',
        category_id: 11,
      }),
    ]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      confidence: 'medium',
      daysApart: 4,
      reasons: expect.arrayContaining([
        'Exact amount',
        'API-created plus imported',
        '4-day date difference',
        'Similar payee',
        'Same category',
      ]),
    });
  });

  it('does not extend the settlement window for weak API or ordinary manual matches', () => {
    expect(scan([
      transaction({ id: 1, source: 'api', date: '2026-09-05', payee: 'Google One', category_id: 11 }),
      transaction({ id: 2, source: 'plaid', date: '2026-09-09', payee: 'Unrelated Merchant', category_id: 11 }),
    ], { includeLow: true })).toEqual([]);

    expect(scan([
      transaction({ id: 3, source: 'manual', date: '2026-09-05', payee: 'Google One', category_id: 11 }),
      transaction({ id: 4, source: 'plaid', date: '2026-09-09', payee: 'Google One', category_id: 11 }),
    ], { includeLow: true })).toEqual([]);
  });

  it('does not match API-created and imported transactions more than five days apart', () => {
    expect(scan([
      transaction({ id: 1, source: 'api', date: '2026-09-03', payee: 'Google One', category_id: 11 }),
      transaction({ id: 2, source: 'plaid', date: '2026-09-09', payee: 'Google One', category_id: 11 }),
    ], { includeLow: true })).toEqual([]);
  });

  it('treats a recurring-created transaction as user-entered for duplicate review', () => {
    const candidates = scan([
      transaction({
        id: 1,
        source: 'recurring',
        payee: 'Rocket Mortgage',
        amount: '2043.7900',
        recurring_id: 3147769,
      }),
      transaction({
        id: 2,
        source: 'plaid',
        payee: 'Rocket Mortgage',
        amount: '2043.7900',
        date: '2026-08-17',
        recurring_id: 3147769,
      }),
    ]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      confidence: 'medium',
      reasons: expect.arrayContaining([
        'Recurring-created plus imported',
        '3-day date difference',
        'Same recurring item',
      ]),
      manual: { id: '1', source: 'recurring', origin: 'manual' },
      imported: { id: '2', source: 'plaid', origin: 'imported' },
    });
  });

  it('hides an ordinary manual exact-amount nearby-date pair when payee and category evidence is weak', () => {
    const candidates = scan([
      transaction({ id: 1, source: 'manual', payee: 'Family music plan', category_id: null }),
      transaction({ id: 2, source: 'plaid', payee: 'PAYMENT PROCESSOR 8842', date: '2026-08-16', category_id: null }),
    ]);
    expect(candidates).toEqual([]);
    expect(scan([
      transaction({ id: 1, source: 'manual', payee: 'Family music plan', category_id: null }),
      transaction({ id: 2, source: 'plaid', payee: 'PAYMENT PROCESSOR 8842', date: '2026-08-16', category_id: null }),
    ], { includeLow: true })[0].confidence).toBe('low');
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

  it('keeps plaid-source rows importable even when they inherited n8n notes', () => {
    const inheritedImport = transaction({
      id: 1,
      source: 'plaid',
      notes: 'Created from Capital One Gmail alert by n8n.',
    });
    expect(inheritedImport).toMatchObject({ origin: 'imported', automationCreated: true });
    expect(scan([
      transaction({ id: 2, source: 'api' }),
      inheritedImport,
    ], { includeLow: true })).toHaveLength(1);
    expect(scan([
      inheritedImport,
      transaction({ id: 3, source: 'plaid', notes: '' }),
    ], { includeLow: true })).toEqual([]);
  });

  it('keeps plaid-source rows importable when marked by non-CapOne n8n workflows', () => {
    const byNote = transaction({
      id: 1,
      source: 'plaid',
      notes: 'Created from Venmo Gmail alert by n8n.',
    });
    const byExternalId = transaction({
      id: 2,
      source: 'plaid',
      external_id: 'n8n-venmo-gmail-message-id',
    });

    expect(byNote).toMatchObject({ origin: 'imported' });
    expect(byExternalId).toMatchObject({ origin: 'imported' });
    expect(scan([
      transaction({ id: 3, source: 'api' }),
      byNote,
      byExternalId,
    ], { includeLow: true })).toHaveLength(1);
  });

  it('allows n8n API placeholders to match imported rows with weak payee text inside five days', () => {
    const candidates = scan([
      transaction({
        id: 1,
        source: 'api',
        date: '2026-10-03',
        payee: 'VENMO',
        amount: '75.00',
        notes: 'Created from Venmo payment email by n8n.',
      }),
      transaction({
        id: 2,
        source: 'plaid',
        date: '2026-10-05',
        payee: 'Esteban Hernandez',
        amount: '75.00',
      }),
    ]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      confidence: 'medium',
      reasons: expect.arrayContaining(['n8n-created placeholder']),
    });
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

  it('keeps only the best one-to-one pairings for repeated Venmo charges', () => {
    const candidates = scan([
      transaction({ id: 'manual-21-75', source: 'api', date: '2026-09-21', payee: 'VENMO', amount: '75.00', category_id: null }),
      transaction({ id: 'manual-22-30', source: 'api', date: '2026-09-22', payee: 'VENMO', amount: '30.00', category_id: null }),
      transaction({ id: 'manual-25-30', source: 'api', date: '2026-09-25', payee: 'VENMO', amount: '30.00', category_id: null }),
      transaction({ id: 'imported-21-venmo-75', source: 'plaid', date: '2026-09-21', payee: 'Venmo', amount: '75.00', category_id: 10 }),
      transaction({ id: 'imported-21-esteban-75', source: 'plaid', date: '2026-09-21', payee: 'Esteban Hernandez', amount: '75.00', category_id: 10 }),
      transaction({ id: 'imported-22-venmo-30', source: 'plaid', date: '2026-09-22', payee: 'Venmo', amount: '30.00', category_id: 10 }),
      transaction({ id: 'imported-25-venmo-30', source: 'plaid', date: '2026-09-25', payee: 'Venmo', amount: '30.00', category_id: 10 }),
    ], { includeLow: true });

    expect(candidates.map(candidate => candidate.id)).toEqual([
      'manual-21-75:imported-21-venmo-75',
      'manual-22-30:imported-22-venmo-30',
      'manual-25-30:imported-25-venmo-30',
    ]);
  });

  it('prefers the closest strongest Dutch Bros pairing when same amounts repeat', () => {
    const candidates = scan([
      transaction({ id: 'manual-29', source: 'api', date: '2026-09-29', payee: 'Dutch Bros. Coffee', amount: '30.00', category_id: 10 }),
      transaction({ id: 'imported-25', source: 'plaid', date: '2026-09-25', payee: 'DUTCH BROS', amount: '30.00', category_id: 10 }),
      transaction({ id: 'imported-01', source: 'plaid', date: '2026-10-01', payee: 'Dutch Bros. Coffee', amount: '30.00', category_id: 10 }),
    ], { includeLow: true });

    expect(candidates.map(candidate => candidate.id)).toEqual(['manual-29:imported-01']);
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
      tag_ids: [3],
      recurring_id: '8',
    });
    expect(merge.update).not.toHaveProperty('id');
    expect(merge.update).not.toHaveProperty('date');
    expect(merge.update).not.toHaveProperty('amount');
    expect(merge.update).not.toHaveProperty('plaid_account_id');
    expect(merge.conflicts).toMatchObject({ payee: true, category: true, notes: true, recurring: false });
  });

  it('can keep the imported payee when resolving a duplicate', () => {
    const manual = transaction({ id: 1, source: 'api', payee: 'Capone Email Name' });
    const imported = transaction({ id: 2, source: 'plaid', payee: 'Target' });

    const merge = buildMetadataMerge(manual, imported, { payeePreference: 'imported' });

    expect(merge.update.payee).toBe('Target');
    expect(merge.summary).toContain('Use payee: Target');
  });

  it('can use a specified payee when resolving a duplicate', () => {
    const manual = transaction({ id: 1, source: 'api', payee: 'Dirty email payee' });
    const imported = transaction({ id: 2, source: 'plaid', payee: 'Imported payee' });

    const merge = buildMetadataMerge(manual, imported, {
      payeePreference: 'specified',
      specifiedPayee: 'Clean Merchant',
    });

    expect(merge.update.payee).toBe('Clean Merchant');
    expect(merge.summary).toContain('Use payee: Clean Merchant');
  });

  it('can use specified notes when resolving a duplicate', () => {
    const manual = transaction({ id: 1, source: 'api', notes: 'Email text' });
    const imported = transaction({ id: 2, source: 'plaid', notes: 'Bank text' });

    const merge = buildMetadataMerge(manual, imported, {
      notesPreference: 'specified',
      specifiedNotes: 'Clean notes',
    });

    expect(merge.update.notes).toBe('Clean notes');
  });
});
