import { describe, expect, it, vi } from 'vitest';
import { LunchMoneyReadService, reconciliationGuidance } from './lunchMoneyReadService.js';

const setup = () => {
  const lunchMoney = {
    getManualAccounts: vi.fn(async () => []),
    getPlaidAccounts: vi.fn(async () => [{ key: 'plaid:1', balance: 100 }]),
    getCategories: vi.fn(async () => [{ id: 8, name: 'Food' }]),
    getTags: vi.fn(async () => [{ id: 3, name: 'n8n_proc' }, { id: 4, name: 'matched_import' }]),
    getAllRawTransactions: vi.fn(async () => [
      { id: 2, plaid_account_id: 1, date: '2026-10-02', amount: '20', source: 'plaid', tag_ids: [4], plaid_metadata: { id: 'bank-id' } },
      { id: 1, plaid_account_id: 1, date: '2026-09-30', amount: '20', source: 'api', tag_ids: [3], notes: 'Original memo', category_id: 8 },
      { id: 3, plaid_account_id: 2, date: '2026-10-02', amount: '10' },
    ]),
  };
  return { lunchMoney, service: new LunchMoneyReadService(lunchMoney, { list: () => [] }) };
};
const query = { accountKey: 'plaid:1', startDate: '2026-10-01', endDate: '2026-10-10', paddingDays: 5 };

describe('Live Lunch Money audit reads', () => {
  it('provides the audit requirements in reference and transaction responses', async () => {
    const { service } = setup();
    expect((await service.getReferenceData()).guidance).toEqual(reconciliationGuidance);
    expect((await service.getTransactions(query)).guidance).toEqual(reconciliationGuidance);
    for (const key of ['auditScope', 'coverage', 'reconciliationLedger',
      'discrepancyEvidence', 'balanceArithmetic', 'auditConclusion']) {
      expect(reconciliationGuidance[key]).toBeTruthy();
    }
    expect(reconciliationGuidance.auditScope).toContain('unless separately requested');
    expect(reconciliationGuidance.auditConclusion).toContain('complete, incomplete, or inconclusive');
    expect(reconciliationGuidance.balanceArithmetic).toContain('does not prove');
  });
  it('returns effective cleared status without changing raw LM flags', async () => {
    const { service, lunchMoney } = setup();
    lunchMoney.getAllRawTransactions.mockResolvedValue([
      { id: 1, plaid_account_id: 1, date: '2026-09-30', amount: '20', source: 'api', tag_ids: [3], is_pending: true },
    ]);
    service.clearances = { list: () => [{
      accountKey: 'plaid:1', transactionId: '1', reason: 'Verified bank posting',
      snapshot: { date: '2026-09-30', amountCents: -2000, source: 'api' },
    }] };
    const result = await service.getTransactions(query);
    expect(result.transactions[0]).toMatchObject({
      effectiveStatus: 'cleared', isPending: false, lmIsPending: true,
      balanceTreatment: 'included', raw: { is_pending: true, tag_ids: [3] },
      pendingExplanation: { classification: 'verified_cleared' },
    });
  });
  it('needs no repository or CSV and preserves placeholders, metadata and page completeness', async () => {
    const { service, lunchMoney } = setup();
    const first = await service.getTransactions({ ...query, limit: 1 });
    expect(lunchMoney.getAllRawTransactions).toHaveBeenCalledWith({
      start_date: '2026-09-26', end_date: '2026-10-15', include_metadata: true,
    });
    expect(first.pagination).toMatchObject({ total: 2, nextOffset: 1, hasMore: true });
    expect(first.transactions[0]).toMatchObject({
      transactionId: '1', amountCents: -2000, notes: 'Original memo',
      categoryName: 'Food', balanceTreatment: 'unreflected', tagNames: ['n8n_proc'],
    });
    const second = await service.getTransactions({ ...query, limit: 1, offset: 1 });
    expect(second.pagination).toMatchObject({ total: 2, hasMore: false, nextOffset: null });
    expect(second.transactions[0]).toMatchObject({
      transactionId: '2', raw: { plaid_metadata: { id: 'bank-id' } },
      tagNames: ['matched_import'],
    });
    expect(second.transactions[0].balanceTreatment).not.toBe('unreflected');
  });

  it('rejects invalid ranges and pagination before querying LM', async () => {
    const { service, lunchMoney } = setup();
    for (const changes of [{ startDate: '2026-02-30' }, { endDate: '2025-01-01' }, { offset: -1 }, { limit: 501 }, { paddingDays: 6 }]) {
      await expect(service.getTransactions({ ...query, ...changes })).rejects.toMatchObject({ status: 400 });
    }
    expect(lunchMoney.getAllRawTransactions).not.toHaveBeenCalled();
  });
});
