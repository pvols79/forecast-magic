import { describe, expect, it } from 'vitest';
import {
  assessAuditHealth,
  buildBalanceBridge,
  businessDaysBetween,
  findStalePendingTransactions,
  findTagComplianceIssues,
  matchExternalTransactions,
  normalizeAuditTransaction,
  parseCapitalOneCsv,
  summarizeTransactionSources,
} from './financialAudit.js';

describe('financial audit domain', () => {
  it('normalizes Lunch Money signs and compound account identity', () => {
    const debit = normalizeAuditTransaction({
      id: 1,
      plaid_account_id: 123,
      date: '2026-09-05',
      amount: '100.00',
      payee: 'Debit',
    });
    const credit = normalizeAuditTransaction({
      id: 2,
      manual_account_id: 123,
      date: '2026-09-05',
      amount: '-1000.00',
      payee: 'Credit',
    });

    expect(debit).toMatchObject({ accountKey: 'plaid:123', amountCents: -10000 });
    expect(credit).toMatchObject({ accountKey: 'manual:123', amountCents: 100000 });
  });

  it('recognizes n8n and pending tags by name rather than hard-coded ids', () => {
    const tags = new Map([[101, 'N8N_Processed'], [202, 'Forecast Magic Pending']]);
    const transaction = normalizeAuditTransaction({
      id: 3,
      plaid_account_id: 1,
      date: '2026-09-05',
      amount: '40.00',
      payee: 'Dutch Bros',
      tag_ids: [101, 202],
    }, tags);

    expect(transaction).toMatchObject({ isN8n: true, hasPendingTag: true });
    expect(findTagComplianceIssues([transaction]).untaggedN8nCandidates).toEqual([]);
  });

  it('parses a Capital One export into internal inflow and outflow signs', () => {
    const statement = parseCapitalOneCsv([
      'Transaction Date,Transaction Description,Transaction Type,Transaction Amount,Balance',
      '09/05/2026,DUTCH BROS,Debit,40.00,10054.41',
      '09/04/2026,REFUND,Credit,12.50,10094.41',
    ].join('\n'), { accountKey: 'plaid:1', filename: 'capital-one.csv' });

    expect(statement).toMatchObject({
      accountKey: 'plaid:1',
      coverageStart: '2026-09-04',
      coverageEnd: '2026-09-05',
      closingBalanceCents: 1005441,
    });
    expect(statement.transactions.map(item => item.amountCents)).toEqual([-4000, 1250]);
  });

  it('parses Capital One exports that use separate debit and credit columns', () => {
    const statement = parseCapitalOneCsv([
      'Posted Date,Description,Debit,Credit,Running Balance',
      '09/05/2026,DUTCH BROS,40.00,,10054.41',
      '09/04/2026,REFUND,,12.50,10094.41',
    ].join('\n'), { accountKey: 'plaid:1' });

    expect(statement.transactions.map(item => item.amountCents)).toEqual([-4000, 1250]);
    expect(statement.closingBalanceCents).toBe(1005441);
  });

  it('matches bank evidence to a settled Plaid import before an n8n placeholder', () => {
    const external = [{ rowKey: 'bank-1', date: '2026-09-05', description: 'DUTCH BROS', amountCents: -4000 }];
    const transactions = [
      { transactionId: 'api-1', source: 'api', isPending: false, date: '2026-09-05', amountCents: -4000, payee: 'Dutch Bros', originalPayee: null },
      { transactionId: 'plaid-1', source: 'plaid', isPending: false, date: '2026-09-05', amountCents: -4000, payee: 'Dutch Bros Coffee', originalPayee: 'DUTCH BROS' },
    ];

    const result = matchExternalTransactions(external, transactions);
    expect(result.links).toHaveLength(1);
    expect(result.links[0].lunchMoney.transactionId).toBe('plaid-1');
    expect(result.unmatchedExternal).toEqual([]);
  });

  it('builds the source balance bridge without mixing in fund reservations', () => {
    const transactions = [
      { source: 'plaid', isPending: true, amountCents: -1000, isN8n: false, hasPendingTag: false },
      { source: 'api', isPending: false, amountCents: -2500, isN8n: true, hasPendingTag: true },
      { source: 'plaid', isPending: false, amountCents: -9000, isN8n: false, hasPendingTag: false },
    ];

    expect(buildBalanceBridge({
      lunchMoneyBalanceCents: 100000,
      capitalOneLedgerCents: 100000,
      capitalOneAvailableCents: 96500,
      transactions,
    })).toEqual({
      lunchMoneySyncedBalanceCents: 100000,
      capitalOneLedgerBalanceCents: 100000,
      capitalOneAvailableBalanceCents: 96500,
      nativePendingCents: -1000,
      taggedN8nPlaceholderCents: -2500,
      expectedAvailableCents: 96500,
      unexplainedAvailableDifferenceCents: 0,
    });
  });

  it('summarizes transaction sources and flags pending items after business-day thresholds', () => {
    const transactions = [
      { transactionId: '1', source: 'plaid', isPending: false, isN8n: false, hasPendingTag: false, date: '2026-08-31', amountCents: -100 },
      { transactionId: '2', source: 'plaid', isPending: true, isN8n: false, hasPendingTag: false, date: '2026-08-31', amountCents: -200 },
      { transactionId: '3', source: 'api', isPending: false, isN8n: true, hasPendingTag: true, date: '2026-09-04', amountCents: -300 },
    ];

    expect(summarizeTransactionSources(transactions)).toMatchObject({
      imported: { count: 1, netCents: -100 },
      nativePending: { count: 1, netCents: -200 },
      n8nCreated: { count: 1, netCents: -300 },
    });
    expect(businessDaysBetween('2026-08-31', '2026-09-07')).toBe(5);
    expect(findStalePendingTransactions(transactions, '2026-09-07', 3).map(item => item.transactionId)).toEqual(['2']);
  });

  it('reports unknown source evidence separately from an unreliable result', () => {
    const findings = [{ severity: 'critical' }, { severity: 'warning' }];
    expect(assessAuditHealth({ findings, hasFreshStatementEvidence: false, balanceDifferenceCents: null }).status)
      .toBe('not_assessable');
    expect(assessAuditHealth({ findings, hasFreshStatementEvidence: true, balanceDifferenceCents: 0 }).status)
      .toBe('unreliable');
  });
});
