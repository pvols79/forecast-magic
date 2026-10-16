import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDatabase, configureDatabase } from '../db/database.js';
import { runMigrations } from '../db/migrate.js';
import { FinancialAuditRepository } from '../repositories/financialAuditRepository.js';
import { FinancialAuditService } from './financialAuditService.js';

let directory;
let repository;

const account = {
  id: 1,
  key: 'plaid:1',
  name: 'Checking',
  source: 'plaid',
  balance: 1000,
  lastUpdated: '2026-09-06T12:00:00.000Z',
};

const rawTransactions = [{
  id: 10,
  plaid_account_id: 1,
  source: 'plaid',
  date: '2026-09-05',
  amount: '40.00',
  payee: 'Dutch Bros Coffee',
  original_name: 'DUTCH BROS',
}, {
  id: 11,
  plaid_account_id: 1,
  source: 'plaid',
  date: '2026-09-05',
  amount: '10.00',
  payee: 'Pending purchase',
  is_pending: true,
}, {
  id: 12,
  plaid_account_id: 1,
  source: 'api',
  date: '2026-09-05',
  amount: '25.00',
  payee: 'Tagged alert',
  notes: 'Created from Capital One Gmail alert by n8n.',
  external_id: 'n8n-capone-gmail-tagged',
  tag_ids: [2],
}, {
  id: 13,
  plaid_account_id: 1,
  source: 'api',
  date: '2026-09-05',
  amount: '5.00',
  payee: 'Untagged alert',
  notes: 'Created from Capital One Gmail alert by n8n.',
  external_id: 'n8n-capone-gmail-untagged',
  tag_ids: [],
}];

const lunchMoney = {
  getManualAccounts: async () => [],
  getPlaidAccounts: async () => [account],
  getTags: async () => [{ id: 1, name: 'n8n_proc' }, { id: 2, name: 'Forecast Magic Pending' }],
  getRawTransactions: async () => rawTransactions,
};

const analytics = {
  getOverview: async () => ({
    openingReconciliation: {
      syncedAccountBalanceCents: 100000,
      openingAdjustmentsCents: -10000,
      adjustedOpeningLedgerCents: 90000,
      todayForecastActivityCents: 0,
      projectedLedgerTodayCents: 90000,
      fundReservationsCents: 20000,
      availableToSpendCents: 70000,
    },
    funds: [{ id: 1, name: 'Groceries', remainingCents: 20000 }],
  }),
};

const duplicateReview = {
  getReportingSummary: async () => ({ needsReview: 0, candidates: [] }),
};

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'forecast-audit-service-'));
  configureDatabase(path.join(directory, 'app.db'));
  runMigrations();
  repository = new FinancialAuditRepository();
});

afterEach(() => {
  closeDatabase();
  fs.rmSync(directory, { recursive: true, force: true });
});

const createService = () => new FinancialAuditService({
  repository,
  lunchMoney,
  analytics,
  duplicateReview,
});

describe('FinancialAuditService', () => {
  it('keeps source reconciliation separate from Forecast Magic spendable balance', async () => {
    const service = createService();
    service.commitCapitalOneImport('plaid:1', [
      'Transaction Date,Transaction Description,Transaction Type,Transaction Amount,Balance',
      '09/05/2026,DUTCH BROS,Debit,40.00,1000.00',
    ].join('\n'), {
      importedAt: new Date().toISOString(),
      availableBalanceCents: 96500,
    });

    const result = await service.run('plaid:1', '2026-09-06');

    expect(result.summary.facts.balanceBridge).toMatchObject({
      lunchMoneySyncedBalanceCents: 100000,
      nativePendingCents: 0,
      ignoredNativePendingCents: -1000,
      taggedN8nPlaceholderCents: -2500,
      expectedAvailableCents: 97500,
      unexplainedAvailableDifferenceCents: -1000,
    });
    expect(result.summary.facts.balanceAssumption).toMatchObject({
      lunchMoneySyncedBalanceCents: 100000,
      capitalOneAvailableBalanceCents: 96500,
      taggedPendingImpactCents: -2500,
      ignoredNativePendingCents: -1000,
      expectedAvailableBalanceCents: 97500,
      unexplainedAvailableDifferenceCents: -1000,
    });
    expect(result.summary.facts.spendablePosition).toMatchObject({
      syncedAccountBalanceCents: 100000,
      openingAdjustmentsCents: -10000,
      fundReservationsCents: 20000,
      availableToSpendCents: 70000,
    });
    expect(result.summary.facts.transactionSources).toMatchObject({
      imported: { count: 1, netCents: -4000 },
      nativePending: { count: 1, netCents: -1000 },
      n8nCreated: { count: 2, netCents: -3000 },
      taggedPendingPlaceholders: { count: 1, netCents: -2500 },
    });
    expect(result.summary.facts.transactionIntegrity).toMatchObject({
      missingFromLunchMoneyCount: 0,
      extraLunchMoneyCount: 2,
      knownPendingExcludedFromExtraCount: 1,
    });
    expect(result.summary.facts.auditWindow).toEqual({
      startDate: '2026-09-05',
      endDate: '2026-09-05',
      source: 'capital_one_csv_coverage',
    });
    expect(result.sourceFreshness.capitalOne).toMatchObject({
      filename: 'capital-one.csv',
      rowCount: 1,
      source: 'capital_one_csv',
    });
    expect(result.summary.facts.reconciliationSections).toMatchObject({
      capitalOneOnly: { count: 0, totalCents: 0 },
      lunchMoneyOnly: { count: 2, totalCents: -1500 },
      knownPendingExcludedFromLunchMoneyOnly: { count: 1, totalCents: -2500 },
    });
    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'untagged-n8n-13', category: 'tag_compliance' }),
      expect.objectContaining({ key: 'extra-lunch-money-11', category: 'extra_lunch_money' }),
      expect.objectContaining({ key: 'extra-lunch-money-13', category: 'extra_lunch_money' }),
    ]));
  });

  it('does not emit age-based stale pending findings for old placeholder tags', async () => {
    const service = createService();
    const result = await service.run('plaid:1', '2026-09-15');

    expect(result.findings.some(item => item.category === 'stale_pending')).toBe(false);
    expect(result.summary.facts.transactionIntegrity.stalePendingCount).toBeUndefined();
  });

  it('does not claim transactions are missing without fresh bank evidence', async () => {
    const result = await createService().run('plaid:1', '2026-09-06');

    expect(result.status).toBe('not_assessable');
    expect(result.summary.facts.transactionIntegrity.missingFromLunchMoneyCount).toBeNull();
    expect(result.summary.facts.transactionIntegrity.extraLunchMoneyCount).toBeNull();
    expect(result.findings.some(item => item.category === 'missing_import')).toBe(false);
    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'capital-one-evidence-missing', severity: 'unknown' }),
    ]));
  });

  it('compares n8n alert evidence with the settled Plaid amount, not its API placeholder', async () => {
    const service = createService();
    service.ingestN8nEvidence({
      accountKey: 'plaid:1',
      externalId: 'n8n-capone-gmail-alert-1',
      date: '2026-09-05',
      amountCents: -3500,
      payee: 'Dutch Bros',
      statementDescription: 'DUTCH BROS',
    });

    const result = await service.run('plaid:1', '2026-09-06');
    const settlement = result.findings.find(item => item.category === 'transaction_integrity'
      && item.key.startsWith('settlement-change-'));

    expect(settlement).toMatchObject({
      key: 'settlement-change-10',
      evidence: { amountDifferenceCents: -500 },
    });
    expect(settlement.evidence.transaction).toMatchObject({ source: 'plaid', amountCents: -4000 });
  });

  it('returns compact server-side audit summaries with paginated findings and evidence', async () => {
    const service = createService();
    const summary = await service.runCompactAudit({
      accountKey: 'plaid:1',
      anchorDate: '2026-09-06',
      findingLimit: 1,
    });

    expect(summary).toMatchObject({
      auditId: expect.any(Number),
      account: { key: 'plaid:1' },
      reconciliationStatus: 'not_assessable',
      retrieval: {
        findingsTool: 'audit_get_findings',
        evidenceTool: 'audit_get_evidence',
        hasMoreFindings: true,
      },
      responseSize: { estimatedTokens: expect.any(Number) },
    });
    expect(summary.highPriorityFindings).toHaveLength(1);
    expect(summary.highPriorityFindings[0].evidence).toBeUndefined();

    const findings = service.getAuditFindings({
      auditId: summary.auditId,
      accountKey: 'plaid:1',
      offset: 0,
      limit: 1,
    });
    expect(findings.pagination).toMatchObject({ returned: 1, hasMore: true });
    expect(findings.findings[0].evidence).toBeUndefined();

    const evidence = service.getAuditEvidence({
      auditId: summary.auditId,
      accountKey: 'plaid:1',
      findingKey: 'untagged-n8n-13',
    });
    expect(evidence.finding).toMatchObject({ key: 'untagged-n8n-13' });
    expect(evidence.evidence.transaction).toMatchObject({
      transactionId: '13',
      source: 'api',
      amountCents: -500,
    });
    expect(evidence.evidence.transaction.notes).toBeUndefined();
  });

  it('reports pending LM-only rows, padded boundary matches and full-period duplicate scope', async () => {
    const getReportingSummary = vi.fn(async () => ({ needsReview: 0, candidates: [] }));
    const service = new FinancialAuditService({ repository, analytics,
      duplicateReview: { getReportingSummary },
      lunchMoney: { ...lunchMoney, getRawTransactions: async () => [
        { id: 90, plaid_account_id: 1, source: 'plaid', date: '2026-09-01', amount: '40', payee: 'Dutch Bros' },
        { id: 91, plaid_account_id: 1, source: 'api', date: '2026-08-31', amount: '10', payee: 'New purchase', tag_ids: [1] },
        { id: 92, plaid_account_id: 1, source: 'plaid', date: '2026-09-02', amount: '7', payee: 'Boundary purchase' },
      ] },
    });
    service.commitCapitalOneImport('plaid:1', [
      'Transaction Date,Transaction Description,Transaction Type,Transaction Amount,Balance',
      '08/31/2026,DUTCH BROS,Debit,40.00,1000.00',
      '01/01/2026,Opening purchase,Debit,5.00,1040.00',
    ].join('\n'), { importedAt: new Date().toISOString() });
    const result = await service.run('plaid:1', '2026-09-06');
    expect(getReportingSummary).toHaveBeenCalledWith('plaid:1', '2026-08-31', {
      startDate: '2025-12-27', endDate: '2026-09-05', includeLow: true,
      evidenceStartDate: '2026-01-01', evidenceEndDate: '2026-08-31',
    });
    expect(result.summary.facts.reconciliationSections).toMatchObject({
      capitalOneOnly: { count: 1, totalCents: -500 },
      allLunchMoneyOnly: { count: 1, totalCents: -1000 },
      knownPendingExcludedFromLunchMoneyOnly: { count: 1 },
      boundaryTransactions: { count: 1, totalCents: -700 },
      boundaryMatches: { count: 1, totalCents: -4000 },
    });
    expect(result.findings.some(item => item.key === 'missing-import-90')).toBe(false);
  });

});
