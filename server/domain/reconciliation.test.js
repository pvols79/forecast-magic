import { describe, expect, it } from 'vitest';
import { consolidateBankEvidence, reconcileEvidence } from './reconciliation';
import { parseReconciliationCsv, parsePendingText, validateEvidenceReview } from './reconciliationEvidence';

const bank = (key, amountCents, description = 'Coffee Shop', date = '2026-11-20') => ({ key, sourceRow: Number(key) || key, date, description, amountCents, currency: 'USD', relevant: true });
const file = (rows, overrides = {}) => ({ id: 1, kind: 'capital_one', filename: 'bank.csv', sha256: 'hash', reviewedAt: '2026-11-26', review: { confirmed: true, useDocument: true, coverageStart: '2026-11-01', coverageEnd: '2026-11-25', rows }, ...overrides });
const lm = (transactionId, amountCents, overrides = {}) => ({ transactionId, date: '2026-11-20', amountCents, payee: 'Coffee Shop', originalPayee: 'Coffee Shop', source: 'plaid', effectiveStatus: 'cleared', ...overrides });
const run = (evidence, transactions, extra = {}) => reconcileEvidence({ evidence, transactions, account: { key: 'plaid:1' }, anchorDate: '2026-11-26', queriedRange: { startDate: '2026-10-27', endDate: '2026-11-30' }, ...extra });

describe('reviewable evidence parsing', () => {
  it('uses posted dates, keeps inflows and outflows, and does not silently drop unreadable CSV lines', () => {
    const parsed = parseReconciliationCsv('Transaction Date,Posted Date,Description,Debit,Credit\n11/19/2026,11/20/2026,Coffee,12.34,\n11/20/2026,11/21/2026,Salary,,2000.00\nSummary,,,,\n', 'capital_one');
    expect(parsed.rows.map(row => row.date)).toEqual(['2026-11-20', '2026-11-21', '']);
    expect(parsed.rows.map(row => row.amountCents)).toEqual([-1234, 200000, null]);
    expect(parsed.rows[2]).toMatchObject({ relevant: false, sourceRow: 4 });
    expect(parsed.warnings).toHaveLength(1);
  });
  it('reads Venmo preambles and requires explicit selected-bank funding confirmation', () => {
    const parsed = parseReconciliationCsv('Account Statement\nAccount Activity\nID,Datetime,Type,Status,Note,From,To,Amount (total),Funding Source\n123,2026-11-20T12:00:00,Payment,Complete,Gift,Phil,Alex,-$40.00,Capital One 6874\n', 'venmo');
    expect(parsed.rows[0]).toMatchObject({ date: '2026-11-20', amountCents: -4000, counterparty: 'Alex', fundingSource: 'Capital One 6874', relevant: false });
    expect(() => validateEvidenceReview({ confirmed: true, rows: [{ ...parsed.rows[0], relevant: true }] }, 'venmo')).toThrow(/Verify.*funded/);
    expect(validateEvidenceReview({ confirmed: true, rows: [{ ...parsed.rows[0], relevant: true, fundingVerified: true }] }, 'venmo')).toBeTruthy();
  });
  it('does not invent screenshot dates or treat balances as charges', () => {
    const draft = parsePendingText('Available balance $2,000.00\nCoffee Shop $12.34\n2026-11-25 Grocery $40.00');
    expect(draft.rows).toHaveLength(2);
    expect(draft.rows[0]).toMatchObject({ date: '', amountCents: -1234 });
    expect(() => validateEvidenceReview({ confirmed: true, rows: draft.rows }, 'pending')).toThrow(/valid date/);
  });
  it('requires explanations for excluded rows and explicit image review', () => {
    expect(() => validateEvidenceReview({ confirmed: true, rows: [{ key: '1', relevant: false }] }, 'pending')).toThrow(/reason/);
    expect(() => validateEvidenceReview({ confirmed: true, rows: [] }, 'pending')).toThrow(/no relevant pending/);
    expect(() => validateEvidenceReview({ confirmed: false, rows: [] }, 'pending')).toThrow(/Confirm/);
  });
});

describe('evidence-backed reconciliation', () => {
  it('reconciles credits and debits in both directions with exact count/amount equations', () => {
    const result = run([file([bank('1', -1234), bank('2', 100000, 'Salary')])], [lm('10', -1234), lm('11', 100000, { payee: 'Salary', originalPayee: 'Salary' })]);
    expect(result).toMatchObject({ reconciliation: 'reconciled', completeness: 'complete', countsAndAmountsVerified: true });
    expect(result.stats.bank).toMatchObject({ debitCount: 1, debitCents: 1234, creditCount: 1, creditCents: 100000 });
    expect(result.stats.bankMissing.count).toBe(0); expect(result.stats.lmExtra.count).toBe(0);
  });
  it('preserves identical legitimate purchases and consolidates overlapping exports by maximum multiplicity', () => {
    const evidence = [file([bank('1', -1000), bank('2', -1000)]), file([bank('3', -1000), bank('4', -1000)], { id: 2, filename: 'overlap.csv' })];
    expect(consolidateBankEvidence(evidence).rows).toHaveLength(2);
    const result = run(evidence, [lm('10', -1000), lm('11', -1000)]);
    expect(result.reconciliation).toBe('reconciled'); expect(result.overlapHandling.excludedDuplicateRows).toBe(2);
    expect(result.matches.every(match => match.method === 'equivalent_set_by_count_and_total')).toBe(true);
  });
  it('reports a missing credit and an additional LM debit without offsetting their net amounts', () => {
    const result = run([file([bank('1', 2500, 'Refund')])], [lm('10', -2500)]);
    expect(result.stats.bankMissing).toMatchObject({ creditCount: 1, creditCents: 2500 });
    expect(result.stats.lmExtra).toMatchObject({ debitCount: 1, debitCents: 2500 });
    expect(result.reconciliation).toBe('needs_review'); expect(result.completeness).toBe('complete');
  });
  it('prefers posted LM imports and identifies a retained placeholder as a potential duplicate', () => {
    const result = run([file([bank('1', -1000)])], [lm('posted', -1000), lm('placeholder', -1000, { source: 'api', effectiveStatus: 'pending' })]);
    expect(result.bankRows[0].transactionId).toBe('posted');
    expect(result.findings.some(finding => finding.category === 'potential_duplicate')).toBe(true);
    expect(result.stats.lmPending.count).toBe(1);
  });
  it('does not call a bank-posted row missing merely because only its placeholder remains', () => {
    const result = run([file([bank('1', -1000)])], [lm('retained', -1000, { source: 'api', effectiveStatus: 'pending' })]);
    expect(result.reconciliation).toBe('reconciled');
    expect(result.findings.map(row => row.category)).toContain('posted_represented_by_placeholder');
  });
  it('does not force same-amount mismatched merchants together', () => {
    const result = run([file([bank('1', -1000, 'Walmart')])], [lm('10', -1000, { payee: 'Hospital', originalPayee: 'Hospital' })]);
    expect(result.matches).toHaveLength(0); expect(result.stats.bankMissing.count).toBe(1);
  });
  it('keeps ambiguous same-amount candidates unresolved until an evidence-backed manual decision', () => {
    const evidence = [file([bank('1', -1000)])];
    const transactions = [lm('a', -1000), lm('b', -1000)];
    expect(run(evidence, transactions).completeness).toBe('inconclusive');
    const result = run(evidence, transactions, { decisions: [{ bankKey: '1:1', transactionId: 'a', reason: 'Verified against receipt and bank row' }] });
    expect(result.stats.bankMatched.count).toBe(1); expect(result.stats.lmExtra.count).toBe(1);
    expect(() => run(evidence, transactions, { decisions: [{ bankKey: '1:1', transactionId: 'a', reason: '' }] })).toThrow(/no longer valid/);
  });
  it('handles boundary-date matches and preserves other padded LM activity separately', () => {
    const result = run([file([bank('1', -1000, 'Coffee Shop', '2026-11-01')])], [lm('a', -1000, { date: '2026-10-30' }), lm('b', -500, { date: '2026-10-29' })]);
    expect(result.matches[0].dayDifference).toBe(2); expect(result.stats.lmBoundary.count).toBe(1);
    expect(result.reconciliation).toBe('reconciled');
  });
  it('uses Venmo as supplemental recipient evidence without adding payments twice to the bank ledger', () => {
    const venmo = file([{ ...bank('v1', -4000, 'Alex · Gift'), counterparty: 'Alex', fundingVerified: true }], { id: 2, kind: 'venmo', filename: 'venmo.csv' });
    const result = run([file([bank('1', -4000, 'VENMO PAYMENT')]), venmo], [lm('a', -4000, { payee: 'Alex', originalPayee: null })]);
    expect(result.stats.bank.count).toBe(1); expect(result.reconciliation).toBe('reconciled');
  });
  it('separates screenshot pending charges, changed holds and stale signals from the posted ledger', () => {
    const screenshot = file([bank('s1', -1000, 'New Store', '2026-11-25')], { id: 2, kind: 'pending', filename: 'pending.png' });
    const result = run([file([bank('1', -750, 'Vending')]), screenshot], [lm('a', -750, { payee: 'Vending', originalPayee: 'Vending' }), lm('hold', -1000, { payee: 'Vending', originalPayee: 'Vending', source: 'api', effectiveStatus: 'pending' })]);
    expect(result.stats.bank.count).toBe(1);
    expect(result.findings.map(row => row.category)).toContain('possible_hold_amount_change');
    expect(result.pendingEvidence[0].disposition).toBe('not_represented');
  });
  it('does not claim completeness when evidence or record normalization has limitations', () => {
    const result = run([file([bank('1', -1000)])], [lm('a', -1000)], { limitations: ['A split parent was unavailable'] });
    expect(result.completeness).toBe('incomplete'); expect(result.reconciliation).toBe('needs_review');
  });
  it('flags a changed authorization amount even before the posted LM import arrives', () => {
    const result = run([file([bank('1', -750, 'Vending')])], [lm('hold', -1000, { payee: 'Vending', originalPayee: 'Vending', source: 'api', effectiveStatus: 'pending' })]);
    expect(result.stats.bankMissing.count).toBe(1);
    expect(result.findings.map(row => row.category)).toContain('possible_hold_amount_change');
  });
});
