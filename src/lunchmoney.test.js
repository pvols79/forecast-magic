import { describe, expect, it } from 'vitest';
import { normalizeTransaction } from './lunchmoney';

describe('Lunch Money v2 normalization', () => {
  it('normalizes v2 debit and credit signs to internal cash-flow signs', () => {
    expect(normalizeTransaction({
      id: 1,
      plaid_account_id: 123,
      date: '2026-08-12',
      payee: 'Debit',
      amount: '100.00',
      is_pending: false,
      source: 'plaid',
    })).toMatchObject({
      accountKey: 'plaid:123',
      amount: -100,
      lunchMoneySource: 'plaid',
      balanceTreatment: 'included',
    });

    expect(normalizeTransaction({
      id: 2,
      manual_account_id: 456,
      date: '2026-08-14',
      payee: 'Credit',
      amount: '-1000.00',
      is_pending: false,
      source: 'recurring',
    })).toMatchObject({
      accountKey: 'manual:456',
      amount: 1000,
      lunchMoneySource: 'recurring',
      balanceTreatment: 'unreflected',
    });
  });

  it('marks explicitly tagged API placeholders as absent from the synced balance', () => {
    expect(normalizeTransaction({
      id: 3,
      plaid_account_id: 123,
      date: '2026-09-05',
      payee: 'Email-created purchase',
      amount: '25.00',
      is_pending: false,
      source: 'api',
      tag_names: ['Forecast Magic Pending'],
    })).toMatchObject({
      accountKey: 'plaid:123',
      amount: -25,
      balanceTreatment: 'unreflected',
      tagNames: ['Forecast Magic Pending'],
    });
  });

  it('does not treat API source alone as proof that a transaction is unreflected', () => {
    expect(normalizeTransaction({
      id: 4,
      plaid_account_id: 123,
      date: '2026-09-05',
      payee: 'Historical automation entry',
      amount: '25.00',
      is_pending: false,
      source: 'api',
    })).toMatchObject({
      accountKey: 'plaid:123',
      balanceTreatment: 'included',
    });
  });

  it('marks Lunch Money pending activity on Plaid accounts as unreflected', () => {
    expect(normalizeTransaction({
      id: 5,
      plaid_account_id: 123,
      date: '2026-09-05',
      payee: 'Pending purchase',
      amount: '25.00',
      is_pending: true,
      source: 'plaid',
    })).toMatchObject({
      type: 'pending',
      balanceTreatment: 'unreflected',
    });
  });

  it('does not reapply an imported transaction if a placeholder tag was retained during merge', () => {
    expect(normalizeTransaction({
      id: 6,
      plaid_account_id: 123,
      date: '2026-09-04',
      payee: 'Imported purchase',
      amount: '25.00',
      is_pending: false,
      source: 'plaid',
      tag_names: ['Forecast Magic Pending'],
    })).toMatchObject({
      balanceTreatment: 'included',
    });
  });
});
