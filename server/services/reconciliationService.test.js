import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureDatabase, closeDatabase, getDatabase } from '../db/database';
import { runMigrations } from '../db/migrate';
import { ReconciliationService, reconciliationLedger } from './reconciliationService';
import { createReconciliationRouter } from '../routes/reconciliationRoutes';

beforeEach(() => { configureDatabase(':memory:'); runMigrations(); });
afterEach(() => closeDatabase());
const csv = 'Transaction Date,Transaction Description,Transaction Type,Transaction Amount\n11/20/2026,Coffee Shop,Debit,12.34\n11/21/2026,Salary,Credit,2000.00\n';
const records = [
  { id: 1, plaid_account_id: 1, date: '2026-11-20', payee: 'Coffee Shop', amount: '12.34', currency: 'usd', source: 'plaid' },
  { id: 2, plaid_account_id: 1, date: '2026-11-21', payee: 'Salary', amount: '-2000.00', currency: 'usd', source: 'plaid' },
];
const makeService = () => {
  const lunchMoney = { getManualAccounts: vi.fn(async () => []), getPlaidAccounts: vi.fn(async () => [{ key: 'plaid:1', name: 'Checking', balance: 1000 }]),
    getTags: vi.fn(async () => []), getAllRawTransactions: vi.fn(async () => records),
    updateTransaction: vi.fn(), deleteTransaction: vi.fn() };
  return { service: new ReconciliationService({ lunchMoney }), lunchMoney };
};

describe('persistent reconciliation workflow', () => {
  it('uploads originals idempotently, requires review, reads all LM pages and saves an immutable result without LM writes', async () => {
    const { service, lunchMoney } = makeService();
    const session = service.create('plaid:1');
    const uploaded = await service.upload(session.id, 'capital_one', 'bank.csv', Buffer.from(csv));
    const same = await service.upload(session.id, 'capital_one', 'bank-again.csv', Buffer.from(csv));
    expect(same.id).toBe(uploaded.id);
    expect(service.repository.getEvidence(session.id, uploaded.id, true).content.toString()).toBe(csv);
    await expect(service.run(session.id, '2026-11-26')).rejects.toThrow(/Review and confirm/);
    service.review(session.id, uploaded.id, { ...uploaded.extraction, useDocument: true, confirmed: true });
    const completed = await service.run(session.id, '2026-11-26');
    expect(completed.latestRun.result.reconciliation).toBe('reconciled');
    expect(completed.latestRun.result.sourceSnapshot.allLunchMoneyPagesRead).toBe(true);
    expect(lunchMoney.getAllRawTransactions).toHaveBeenCalledWith(expect.objectContaining({ start_date: '2026-11-15', end_date: '2026-11-26', include_split_parents: true, include_group_children: true }));
    expect(lunchMoney.updateTransaction).not.toHaveBeenCalled(); expect(lunchMoney.deleteTransaction).not.toHaveBeenCalled();
    service.review(session.id, uploaded.id, { ...uploaded.extraction, useDocument: true, confirmed: true });
    expect(service.latest('plaid:1').latestRun.stale).toBe(true);
    expect(JSON.parse(getDatabase().prepare('SELECT result_json FROM reconciliation_workflow_runs').get().result_json).reconciliation).toBe('reconciled');
  });
  it('rejects silently discarded source rows and marks excluded financial rows as incomplete', async () => {
    const { service } = makeService(); const session = service.create('plaid:1');
    const uploaded = await service.upload(session.id, 'capital_one', 'bank.csv', Buffer.from(csv));
    expect(() => service.review(session.id, uploaded.id, { ...uploaded.extraction, rows: uploaded.extraction.rows.slice(0, 1), confirmed: true })).toThrow(/Keep every original row/);
    const rows = uploaded.extraction.rows.map((row, index) => index ? { ...row, relevant: false, exclusionReason: 'Excluded for review' } : row);
    service.review(session.id, uploaded.id, { ...uploaded.extraction, rows, confirmed: true });
    const completed = await service.run(session.id, '2026-11-26');
    expect(completed.latestRun.result.completeness).toBe('incomplete');
  });
  it('retains pending screenshots even when local OCR is unavailable and allows reviewed manual rows', async () => {
    const { service } = makeService(); service.ocr = vi.fn(async () => { throw new Error('Reader unavailable'); });
    const session = service.create('plaid:1');
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
    const uploaded = await service.upload(session.id, 'pending', 'pending.png', png);
    expect(uploaded.extraction.warnings).toContain('Reader unavailable');
    service.review(session.id, uploaded.id, { confirmed: true, rows: [{ key: 'manual:1', sourceRow: 'manual 1', date: '2026-11-25', description: 'Coffee', amountCents: -1234, currency: 'USD', relevant: true }] });
    expect(service.latest('plaid:1').evidence[0].reviewedAt).toBeTruthy();
  });
  it('invalidates a result when evidence changes while LM is being fetched', async () => {
    const { service, lunchMoney } = makeService(); const session = service.create('plaid:1');
    const uploaded = await service.upload(session.id, 'capital_one', 'bank.csv', Buffer.from(csv));
    const review = { ...uploaded.extraction, confirmed: true };
    service.review(session.id, uploaded.id, review);
    lunchMoney.getAllRawTransactions.mockImplementation(async () => { service.review(session.id, uploaded.id, review); return records; });
    await expect(service.run(session.id, '2026-11-26')).rejects.toThrow(/Evidence changed/);
    expect(getDatabase().prepare('SELECT COUNT(*) AS n FROM reconciliation_workflow_runs').get().n).toBe(0);
  });
  it('authenticates before parsing any uploaded document', () => {
    const router = createReconciliationRouter({}, {});
    const denied = { status: vi.fn().mockReturnThis(), json: vi.fn() }; const next = vi.fn();
    router.stack[0].handle({ isAdmin: false }, denied, next);
    expect(denied.status).toHaveBeenCalledWith(401); expect(next).not.toHaveBeenCalled();
  });
});

describe('bank-level LM snapshot normalization', () => {
  it('counts split parents once and grouped bank transactions individually', () => {
    const raw = [
      { ...records[0], id: 10, amount: '20', is_split_parent: true },
      { ...records[0], id: 11, amount: '12', split_parent_id: 10 },
      { ...records[0], id: 12, amount: '8', split_parent_id: 10 },
      { ...records[0], id: 20, amount: '30', is_group_parent: true, children: [{ ...records[0], id: 21, amount: '10', group_parent_id: 20 }, { ...records[0], id: 22, amount: '20', group_parent_id: 20 }] },
    ];
    const snapshot = reconciliationLedger(raw, 'plaid:1', new Map(), []);
    expect(snapshot.transactions.map(row => row.transactionId)).toEqual(['10', '21', '22']);
    expect(snapshot.structural).toHaveLength(3); expect(snapshot.limitations).toEqual([]);
  });
  it('respects verified clearances and detects inconsistent pagination snapshots', () => {
    const raw = { ...records[0], source: 'api', tag_ids: [1] };
    const clearance = { accountKey: 'plaid:1', transactionId: '1', snapshot: { date: raw.date, amountCents: -1234, source: 'api' } };
    expect(reconciliationLedger([raw], 'plaid:1', new Map([[1, 'n8n_proc']]), [clearance]).transactions[0].effectiveStatus).toBe('cleared');
    expect(() => reconciliationLedger([raw, { ...raw, amount: '99' }], 'plaid:1', new Map(), [])).toThrow(/changed while pages/);
  });
});
