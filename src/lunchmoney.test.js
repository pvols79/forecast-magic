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
    });
  });
});
