import { config } from '../config.js';
import { AuditClearanceRepository } from '../repositories/auditClearanceRepository.js';
import { applyAuditClearance } from '../domain/auditClearance.js';
import {
  assessAuditHealth, buildBalanceBridge,
  findStalePendingTransactions, findTagComplianceIssues, matchExternalTransactions,
  normalizeAuditTransaction, parseCapitalOneCsv, summarizeTransactionSources,
} from '../domain/financialAudit.js';
import { payeeSimilarity } from '../domain/duplicateReview.js';
import { addDays } from '../domain/periods.js';
import { FinancialAuditRepository } from '../repositories/financialAuditRepository.js';
import { DuplicateReviewService } from './duplicateReviewService.js';
import { FinancialAnalyticsService } from './financialAnalyticsService.js';
import { LunchMoneyService } from './lunchMoneyService.js';

const AUDIT_ENGINE_METHODOLOGY_VERSION = 'server-audit-v1';
const MATCHING_METHODOLOGY_VERSION = 'financial-audit-matching-v1';

const assertAccountKey = accountKey => {
  if (!/^(manual|plaid):[^:]+$/.test(accountKey || '')) {
    const error = new Error('A compound account key such as plaid:123 is required.');
    error.status = 400;
    throw error;
  }
};

const assertDate = date => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
    const error = new Error('Anchor date must use YYYY-MM-DD.');
    error.status = 400;
    throw error;
  }
};

const finding = (key, severity, category, title, summary, evidence = {}) => ({
  key, severity, category, title, summary, status: 'open', evidence,
});

const publicTransaction = transaction => ({
  effectiveStatus: transaction.effectiveStatus,
  auditClearance: transaction.auditClearance,
  lmIsPending: transaction.lmIsPending,
  transactionId: transaction.transactionId,
  accountKey: transaction.accountKey,
  source: transaction.source,
  date: transaction.date,
  amountCents: transaction.amountCents,
  payee: transaction.payee,
  originalPayee: transaction.originalPayee,
  categoryId: transaction.categoryId,
  recurringId: transaction.recurringId,
  isPending: transaction.isPending,
  tagIds: transaction.tagIds,
  tagNames: transaction.tagNames,
  isN8n: transaction.isN8n,
  hasPendingTag: transaction.hasPendingTag,
  pendingExplanation: transaction.pendingExplanation,
});

const estimateTokens = value => Math.ceil(JSON.stringify(value).length / 4);

const compactFinding = finding => ({
  key: finding.key,
  severity: finding.severity,
  category: finding.category,
  title: finding.title,
  summary: finding.summary,
  status: finding.status,
  evidenceAvailable: Boolean(finding.evidence && Object.keys(finding.evidence).length),
});

const compactEvidenceRecord = value => {
  if (Array.isArray(value)) return value.map(compactEvidenceRecord);
  if (!value || typeof value !== 'object') return value;
  if (value.transactionId || value.rowKey) {
    return {
      transactionId: value.transactionId,
      rowKey: value.rowKey,
      source: value.source,
      date: value.date,
      amountCents: value.amountCents,
      payee: value.payee,
      description: value.description,
      originalPayee: value.originalPayee,
      effectiveStatus: value.effectiveStatus,
      isPending: value.isPending,
      balanceTreatment: value.balanceTreatment,
    };
  }
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['raw', 'notes', 'payload'].includes(key))
    .map(([key, item]) => [key, compactEvidenceRecord(item)]));
};

const sumCents = items => items.reduce((total, item) => total + item.amountCents, 0);

const limitedRecords = (items, mapRecord, limit = 25) => ({
  count: items.length,
  totalCents: sumCents(items),
  records: items.slice(0, limit).map(mapRecord),
  hasMore: items.length > limit,
  nextOffset: items.length > limit ? limit : null,
});

const compactStatementTransaction = transaction => ({
  rowKey: transaction.rowKey,
  date: transaction.date,
  amountCents: transaction.amountCents,
  description: transaction.description,
  transactionType: transaction.transactionType,
});

const isKnownPendingCharge = transaction => Boolean(transaction.pendingExplanation?.taggedPlaceholder);

const isCoveredByStatement = (transaction, statement) => statement
  && transaction.date >= statement.coverageStart
  && transaction.date <= statement.coverageEnd;

const assertPagination = ({ offset = 0, limit = 25, maxLimit = 100 } = {}) => {
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > maxLimit) {
    const error = new Error(`offset must be nonnegative and limit must be 1-${maxLimit}.`);
    error.status = 400;
    throw error;
  }
  return { offset, limit };
};

const lifecycleCandidates = (evidence, transactions) => evidence.flatMap(item => {
  const candidates = transactions.map(transaction => ({
    transaction,
    similarity: Math.max(
      payeeSimilarity(item.payee, transaction.payee),
      payeeSimilarity(item.statementDescription, transaction.originalPayee || transaction.payee)
    ),
    dayDistance: Math.abs(Math.round(
      (new Date(`${item.date}T00:00:00Z`) - new Date(`${transaction.date}T00:00:00Z`)) / 86400000
    )),
  })).filter(candidate => candidate.dayDistance <= 5 && candidate.similarity >= 0.5)
    .sort((left, right) => left.dayDistance - right.dayDistance || right.similarity - left.similarity);
  const best = candidates[0];
  if (!best || best.transaction.amountCents === item.amountCents) return [];
  return [{
    evidence: item,
    transaction: best.transaction,
    amountDifferenceCents: best.transaction.amountCents - item.amountCents,
    payeeSimilarity: Number(best.similarity.toFixed(2)),
    dayDistance: best.dayDistance,
  }];
});

export class FinancialAuditService {
  constructor({ repository, lunchMoney, analytics, duplicateReview, clearances } = {}) {
    this.clearances = clearances || new AuditClearanceRepository();
    this.repository = repository || new FinancialAuditRepository();
    this.lunchMoney = lunchMoney || new LunchMoneyService();
    this.analytics = analytics || new FinancialAnalyticsService({ lunchMoney: this.lunchMoney });
    this.duplicateReview = duplicateReview || new DuplicateReviewService(this.lunchMoney);
  }

  async run(accountKey, anchorDate, options = {}) {
    assertAccountKey(accountKey);
    assertDate(anchorDate);
    const startedAt = new Date().toISOString();
    if (options.capitalOneCsv) {
      this.commitCapitalOneImport(accountKey, options.capitalOneCsv, {
        filename: options.capitalOneFilename,
        ledgerBalanceCents: options.ledgerBalanceCents,
        availableBalanceCents: options.availableBalanceCents,
        observedAt: options.observedAt || startedAt,
      });
    }
    const latestStatement = this.repository.getLatestStatementImport(accountKey);
    const startDate = latestStatement?.coverageStart || addDays(anchorDate, -89);
    const endDate = latestStatement?.coverageEnd || anchorDate;
    const queryStartDate = latestStatement ? addDays(startDate, -5) : startDate;
    const queryEndDate = latestStatement ? addDays(endDate, 5) : endDate;
    const [manualAccounts, plaidAccounts, tags, rawTransactions, overview, duplicateSummary] = await Promise.all([
      this.lunchMoney.getManualAccounts(),
      this.lunchMoney.getPlaidAccounts(),
      this.lunchMoney.getTags(),
      this.lunchMoney.getRawTransactions(queryStartDate, queryEndDate, { includeMetadata: true }),
      this.analytics.getOverview(accountKey, endDate, { view: 'admin' }),
      this.duplicateReview.getReportingSummary(accountKey, endDate),
    ]);
    const account = [...manualAccounts, ...plaidAccounts].find(item => item.key === accountKey);
    if (!account) {
      const error = new Error('Selected account was not found in Lunch Money.');
      error.status = 404;
      throw error;
    }
    const tagNamesById = new Map(tags.map(tag => [Number(tag.id), tag.name]));
    const clearances = this.clearances.list(accountKey);
    const transactions = rawTransactions
      .map(transaction => normalizeAuditTransaction(transaction, tagNamesById))
      .filter(transaction => transaction?.accountKey === accountKey)
      .map(transaction => applyAuditClearance(transaction, clearances));
    const statementTransactions = latestStatement
      ? this.repository.listStatementTransactions(latestStatement.id)
      : [];
    const n8nEvidence = this.repository.listN8nEvidence(accountKey, queryStartDate, queryEndDate);
    const freshStatement = Boolean(latestStatement);
    const externalMatch = latestStatement
      ? matchExternalTransactions(statementTransactions, transactions)
      : { links: [], unmatchedExternal: [], unmatchedLunchMoney: [] };
    const compliance = findTagComplianceIssues(transactions);
    const stalePending = findStalePendingTransactions(
      transactions, endDate, config.auditPendingWarningBusinessDays
    );
    const lifecycleChanges = lifecycleCandidates(
      n8nEvidence,
      transactions.filter(transaction => transaction.source === 'plaid' && !transaction.isPending)
    );
    const capitalOneAvailable = this.repository.getLatestBalanceObservation(
      accountKey, 'capital_one', 'available'
    );
    const capitalOneLedger = this.repository.getLatestBalanceObservation(
      accountKey, 'capital_one', 'ledger'
    );
    const bridge = buildBalanceBridge({
      lunchMoneyBalanceCents: Math.round(account.balance * 100),
      capitalOneLedgerCents: capitalOneLedger?.amountCents ?? latestStatement?.closingBalanceCents,
      capitalOneAvailableCents: capitalOneAvailable?.amountCents,
      transactions,
    });

    const findings = [];
    if (!latestStatement) {
      findings.push(finding(
        'capital-one-evidence-missing', 'unknown', 'source_freshness',
        'Capital One evidence is unavailable',
        'This saved snapshot has no stored bank evidence. For a model-led reconciliation, query live LM data and compare with Capital One evidence attached in the conversation; no upload is required.'
      ));
    }
    if (freshStatement) {
      for (const transaction of externalMatch.unmatchedExternal) {
        findings.push(finding(
          `missing-lunch-money-${transaction.rowKey}`, 'critical', 'missing_import',
          'Capital One transaction is missing from Lunch Money',
          `${transaction.description} on ${transaction.date} is present in the fresh bank export but has no matching Lunch Money transaction.`,
          { capitalOneTransaction: transaction }
        ));
      }
      for (const transaction of externalMatch.unmatchedLunchMoney
        .filter(item => isCoveredByStatement(item, latestStatement) && !isKnownPendingCharge(item))) {
        findings.push(finding(
          `extra-lunch-money-${transaction.transactionId}`, 'warning', 'extra_lunch_money',
          'Lunch Money transaction is not in the Capital One export',
          `${transaction.payee} on ${transaction.date} is present in Lunch Money but has no matching row in the fresh Capital One export and is not classified as a known pending placeholder.`,
          { lunchMoneyTransaction: publicTransaction(transaction), statement: latestStatement }
        ));
      }
    }
    for (const link of externalMatch.links.filter(item => item.payeeSimilarity < 0.35)) {
      findings.push(finding(
        `payee-mismatch-${link.lunchMoney.transactionId}`, 'warning', 'transaction_integrity',
        'Lunch Money payee differs from Capital One evidence',
        `${link.lunchMoney.payee} may represent ${link.external.description}.`,
        { ...link, lunchMoney: publicTransaction(link.lunchMoney) }
      ));
    }
    for (const transaction of compliance.untaggedN8nCandidates) {
      findings.push(finding(
        `untagged-n8n-${transaction.transactionId}`, 'warning', 'tag_compliance',
        'n8n-created transaction lacks the pending tag',
        `${transaction.payee} on ${transaction.date} was identified as n8n-created but lacks n8n_proc.`,
        { transaction: publicTransaction(transaction) }
      ));
    }
    for (const transaction of stalePending) {
      const severity = transaction.businessDaysOpen > config.auditPendingCriticalBusinessDays ? 'critical' : 'warning';
      findings.push(finding(
        `stale-pending-${transaction.transactionId}`, severity, 'stale_pending',
        'Older transaction still has a pending signal',
        `${transaction.payee} is dated ${transaction.businessDaysOpen} business days ago and still has a native pending flag or placeholder tag. This does not prove it remains unsettled at the bank; it may be an intentionally retained manual/API replacement. Verify bank evidence before changing its tags or flag.`,
        { transaction: publicTransaction(transaction), businessDaysOpen: transaction.businessDaysOpen }
      ));
    }
    for (const change of lifecycleChanges) {
      findings.push(finding(
        `settlement-change-${change.transaction.transactionId}`, 'warning', 'transaction_integrity',
        'Settled amount differs from the n8n alert',
        `${change.transaction.payee} changed by ${(change.amountDifferenceCents / 100).toFixed(2)} between alert and settlement.`,
        { ...change, transaction: publicTransaction(change.transaction) }
      ));
    }
    for (const candidate of duplicateSummary.candidates) {
      findings.push(finding(
        `duplicate-${candidate.id}`, candidate.confidence === 'high' ? 'critical' : 'warning', 'duplicate',
        'Possible duplicate transaction',
        `${candidate.manual.payee} and ${candidate.imported.payee} may represent the same transaction.`,
        candidate
      ));
    }
    if (bridge.unexplainedAvailableDifferenceCents != null
      && Math.abs(bridge.unexplainedAvailableDifferenceCents) >= 100) {
      findings.push(finding(
        'unexplained-available-balance', 'warning', 'balance',
        'Available-balance difference remains unexplained',
        `Capital One and the known Lunch Money pending signals differ by ${(bridge.unexplainedAvailableDifferenceCents / 100).toFixed(2)}.`,
        bridge
      ));
    }

    const sourceFreshness = {
      lunchMoney: { fetchedAt: startedAt, accountLastUpdatedAt: account.lastUpdated },
      capitalOne: latestStatement ? {
        importedAt: latestStatement.importedAt,
        coverageStart: latestStatement.coverageStart,
        coverageEnd: latestStatement.coverageEnd,
        usedAsAuditBounds: true,
        freshEnoughForMissingAudit: true,
      } : null,
      n8n: { latestEvidenceAt: this.repository.latestN8nEvidenceTimestamp(accountKey) },
    };
    const health = assessAuditHealth({
      findings,
      hasFreshStatementEvidence: freshStatement,
      balanceDifferenceCents: bridge.unexplainedAvailableDifferenceCents,
    });
    const transactionSources = summarizeTransactionSources(transactions);
    const coveredLunchMoneyOnly = freshStatement
      ? externalMatch.unmatchedLunchMoney.filter(item => isCoveredByStatement(item, latestStatement))
      : [];
    const knownPendingExcludedFromLmOnly = coveredLunchMoneyOnly.filter(isKnownPendingCharge);
    const actionableLunchMoneyOnly = coveredLunchMoneyOnly.filter(item => !isKnownPendingCharge(item));
    const reconciliationSections = {
      capitalOneOnly: limitedRecords(externalMatch.unmatchedExternal, compactStatementTransaction),
      lunchMoneyOnly: limitedRecords(actionableLunchMoneyOnly, publicTransaction),
      knownPendingExcludedFromLunchMoneyOnly: limitedRecords(knownPendingExcludedFromLmOnly, publicTransaction),
    };
    const pendingImpactCents = bridge.taggedN8nPlaceholderCents + bridge.taggedManualPlaceholderCents;
    const balanceAssumption = {
      lunchMoneySyncedBalanceCents: bridge.lunchMoneySyncedBalanceCents,
      capitalOneLedgerBalanceCents: bridge.capitalOneLedgerBalanceCents,
      capitalOneAvailableBalanceCents: bridge.capitalOneAvailableBalanceCents,
      taggedPendingImpactCents: pendingImpactCents,
      ignoredNativePendingCents: bridge.ignoredNativePendingCents,
      expectedAvailableBalanceCents: bridge.expectedAvailableCents,
      unexplainedAvailableDifferenceCents: bridge.unexplainedAvailableDifferenceCents,
      explanation: bridge.unexplainedAvailableDifferenceCents == null
        ? 'No Capital One available balance was supplied, so the audit cannot prove whether the balance difference is fully explained by tagged pending placeholders.'
        : Math.abs(bridge.unexplainedAvailableDifferenceCents) < 100
          ? 'The supplied Capital One available balance is explained by tagged pending placeholders. Lunch Money native pending flags are ignored for this audit because they may not be user-resolvable.'
          : 'Tagged pending placeholders do not fully explain the supplied Capital One available balance difference; review CapOne-only and LM-only sections.',
    };
    const summary = {
      health,
      facts: {
        account: { key: account.key, name: account.name, source: account.source },
        auditWindow: { startDate, endDate, source: latestStatement ? 'capital_one_csv_coverage' : 'default_90_day_window' },
        lunchMoneyQueryWindow: { startDate: queryStartDate, endDate: queryEndDate },
        transactionSources,
        balanceBridge: bridge,
        balanceAssumption,
        reconciliationSections,
        tagCompliance: {
          untaggedN8nCandidateCount: compliance.untaggedN8nCandidates.length,
          suspiciousPendingTagCount: compliance.stalePendingCandidates.length,
        },
        transactionIntegrity: {
          possibleDuplicateCount: duplicateSummary.needsReview,
          missingFromLunchMoneyCount: freshStatement ? externalMatch.unmatchedExternal.length : null,
          extraLunchMoneyCount: freshStatement ? actionableLunchMoneyOnly.length : null,
          knownPendingExcludedFromExtraCount: freshStatement ? knownPendingExcludedFromLmOnly.length : null,
          stalePendingCount: stalePending.length,
          settlementChangeCount: lifecycleChanges.length,
        },
        spendablePosition: overview.openingReconciliation,
        fundReservations: overview.funds,
      },
      unknowns: findings.filter(item => item.severity === 'unknown').map(item => item.summary),
      methodology: {
        calculationVersion: AUDIT_ENGINE_METHODOLOGY_VERSION,
        matchingVersion: MATCHING_METHODOLOGY_VERSION,
      },
    };
    const completedAt = new Date().toISOString();
    const runId = this.repository.saveRun({
      accountKey,
      anchorDate,
      status: health.status,
      confidenceScore: health.confidenceScore,
      startedAt,
      completedAt,
      sourceFreshness,
      summary,
      transactions,
      findings,
    });
    this.repository.saveBalanceObservation({
      runId,
      accountKey,
      source: 'lunch_money',
      balanceKind: 'synced',
      amountCents: Math.round(account.balance * 100),
      observedAt: completedAt,
      metadata: { accountLastUpdatedAt: account.lastUpdated },
    });
    this.repository.replaceTransactionLinks(accountKey, externalMatch.links.map(link => ({
      leftSource: 'capital_one_csv',
      leftId: link.external.rowKey,
      rightSource: 'lunch_money',
      rightId: link.lunchMoney.transactionId,
      relationship: 'same_transaction',
      confidence: link.confidence,
      details: { dateDistance: link.dateDistance, payeeSimilarity: link.payeeSimilarity },
      observedAt: completedAt,
    })));
    return this.getRun(runId);
  }

  getRun(runId) {
    const run = this.repository.getRun(runId);
    if (!run) {
      const error = new Error('Audit run was not found.');
      error.status = 404;
      throw error;
    }
    return { ...run, findings: this.repository.listFindings(run.id) };
  }

  getLatest(accountKey) {
    assertAccountKey(accountKey);
    const run = this.repository.getLatestRun(accountKey);
    if (!run) {
      const error = new Error('No completed audit exists for this account.');
      error.status = 404;
      throw error;
    }
    return { ...run, findings: this.repository.listFindings(run.id) };
  }

  getCompactHealth(accountKey) {
    const run = this.getLatest(accountKey);
    return {
      runId: run.id,
      asOf: run.completedAt,
      anchorDate: run.anchorDate,
      status: run.summary.health.status,
      confidenceScore: run.summary.health.confidenceScore,
      findingCounts: {
        critical: run.summary.health.critical,
        warning: run.summary.health.warnings,
        unknown: run.summary.health.unknowns,
      },
      unexplainedAvailableDifferenceCents:
        run.summary.facts.balanceBridge.unexplainedAvailableDifferenceCents,
      unknowns: run.summary.unknowns,
    };
  }

  getBalanceBridge(accountKey) {
    return this.getLatest(accountKey).summary.facts.balanceBridge;
  }

  getFindings(accountKey, filters = {}) {
    const run = this.getLatest(accountKey);
    return this.repository.listFindings(run.id, filters);
  }

  compactRunSummary(run, { findingLimit = 10 } = {}) {
    const findings = this.repository.listFindings(run.id, { limit: findingLimit });
    const totalFindings = this.repository.countFindings(run.id);
    const summary = {
      auditId: run.id,
      account: run.summary.facts.account,
      dateRange: run.summary.facts.auditWindow,
      dataCoverage: run.sourceFreshness,
      completeness: run.status === 'not_assessable' ? 'incomplete' : 'server_processed',
      reconciliationStatus: run.status,
      transactionCounts: run.summary.facts.transactionSources,
      financialTotals: {
        balanceBridge: run.summary.facts.balanceBridge,
        balanceAssumption: run.summary.facts.balanceAssumption,
        spendablePosition: run.summary.facts.spendablePosition,
      },
      reconciliationSections: run.summary.facts.reconciliationSections,
      unexplainedDifferences: {
        availableBalanceCents: run.summary.facts.balanceBridge.unexplainedAvailableDifferenceCents,
      },
      findingCounts: {
        critical: run.summary.health.critical,
        warning: run.summary.health.warnings,
        unknown: run.summary.health.unknowns,
        total: totalFindings,
      },
      highPriorityFindings: findings.map(compactFinding),
      confidence: {
        score: run.confidenceScore,
        status: run.status,
        evidenceIndicators: {
          freshCapitalOneEvidence: Boolean(run.sourceFreshness.capitalOne?.freshEnoughForMissingAudit),
          lunchMoneyFetchedAt: run.sourceFreshness.lunchMoney?.fetchedAt,
          n8nLatestEvidenceAt: run.sourceFreshness.n8n?.latestEvidenceAt,
        },
      },
      methodology: run.summary.methodology || {
        calculationVersion: AUDIT_ENGINE_METHODOLOGY_VERSION,
        matchingVersion: MATCHING_METHODOLOGY_VERSION,
      },
      retrieval: {
        findingsTool: 'audit_get_findings',
        evidenceTool: 'audit_get_evidence',
        findingOffset: findings.length,
        findingLimit,
        hasMoreFindings: totalFindings > findings.length,
      },
    };
    return {
      ...summary,
      responseSize: {
        estimatedTokens: estimateTokens(summary),
        includedFindings: findings.length,
        totalFindings,
      },
    };
  }

  async runCompactAudit({
    accountKey,
    anchorDate,
    findingLimit = 10,
    capitalOneCsv,
    capitalOneFilename,
    ledgerBalanceCents,
    availableBalanceCents,
  }) {
    const run = await this.run(accountKey, anchorDate, {
      capitalOneCsv,
      capitalOneFilename,
      ledgerBalanceCents,
      availableBalanceCents,
    });
    return this.compactRunSummary(run, { findingLimit });
  }

  getAuditFindings({ auditId, accountKey, severity, category, offset = 0, limit = 25 }) {
    const page = assertPagination({ offset, limit });
    const run = this.getRun(auditId);
    if (accountKey && run.accountKey !== accountKey) {
      const error = new Error('Audit run does not belong to the requested account.');
      error.status = 404;
      throw error;
    }
    const filters = { severity, category };
    const findings = this.repository.listFindings(run.id, { ...filters, ...page });
    const total = this.repository.countFindings(run.id, filters);
    const result = {
      auditId: run.id,
      accountKey: run.accountKey,
      filters,
      pagination: {
        offset,
        limit,
        returned: findings.length,
        total,
        nextOffset: offset + findings.length < total ? offset + findings.length : null,
        hasMore: offset + findings.length < total,
      },
      findings: findings.map(compactFinding),
    };
    return { ...result, responseSize: { estimatedTokens: estimateTokens(result) } };
  }

  getAuditEvidence({ auditId, accountKey, findingKey }) {
    const run = this.getRun(auditId);
    if (accountKey && run.accountKey !== accountKey) {
      const error = new Error('Audit run does not belong to the requested account.');
      error.status = 404;
      throw error;
    }
    const finding = this.repository.getFinding(run.id, findingKey);
    if (!finding) {
      const error = new Error('Audit finding was not found.');
      error.status = 404;
      throw error;
    }
    const result = {
      auditId: run.id,
      accountKey: run.accountKey,
      finding: compactFinding(finding),
      evidence: compactEvidenceRecord(finding.evidence),
      methodology: run.summary.methodology || {
        calculationVersion: AUDIT_ENGINE_METHODOLOGY_VERSION,
        matchingVersion: MATCHING_METHODOLOGY_VERSION,
      },
    };
    return { ...result, responseSize: { estimatedTokens: estimateTokens(result) } };
  }

  getTransactions(accountKey, filters = {}) {
    const run = this.getLatest(accountKey);
    return this.repository.listRunTransactions(run.id, filters);
  }

  getTagCompliance(accountKey) {
    const run = this.getLatest(accountKey);
    return {
      runId: run.id,
      ...run.summary.facts.tagCompliance,
      findings: this.repository.listFindings(run.id, { category: 'tag_compliance' }),
    };
  }

  getSyncHealth(accountKey) {
    const run = this.getLatest(accountKey);
    return {
      runId: run.id,
      health: run.summary.health,
      sourceFreshness: run.sourceFreshness,
      transactionIntegrity: run.summary.facts.transactionIntegrity,
    };
  }

  getFinding(accountKey, key) {
    const run = this.getLatest(accountKey);
    const result = this.repository.getFinding(run.id, key);
    if (!result) {
      const error = new Error('Audit finding was not found.');
      error.status = 404;
      throw error;
    }
    return result;
  }

  previewCapitalOneImport(accountKey, csvText, options = {}) {
    assertAccountKey(accountKey);
    const statement = parseCapitalOneCsv(csvText, { ...options, accountKey });
    return {
      accountKey,
      filename: statement.filename,
      coverageStart: statement.coverageStart,
      coverageEnd: statement.coverageEnd,
      closingBalanceCents: statement.closingBalanceCents,
      rowCount: statement.transactions.length,
      sample: statement.transactions.slice(0, 10),
      contentSha256: statement.contentSha256,
    };
  }

  commitCapitalOneImport(accountKey, csvText, options = {}) {
    assertAccountKey(accountKey);
    const statement = parseCapitalOneCsv(csvText, { ...options, accountKey });
    const saved = this.repository.saveStatementImport(statement);
    const observedAt = options.observedAt || statement.importedAt;
    if (statement.closingBalanceCents != null) {
      this.repository.saveBalanceObservation({
        accountKey,
        source: 'capital_one',
        balanceKind: 'ledger',
        amountCents: statement.closingBalanceCents,
        observedAt,
        metadata: { statementImportId: saved.statement.id },
      });
    }
    if (options.availableBalanceCents != null) {
      this.repository.saveBalanceObservation({
        accountKey,
        source: 'capital_one',
        balanceKind: 'available',
        amountCents: options.availableBalanceCents,
        observedAt,
        metadata: { statementImportId: saved.statement.id },
      });
    }
    return { ...saved.statement, idempotent: saved.existed };
  }

  ingestN8nEvidence(input) {
    assertAccountKey(input.accountKey);
    if (!input.externalId || !input.date || !Number.isInteger(input.amountCents) || !input.payee) {
      const error = new Error('externalId, date, integer amountCents, and payee are required.');
      error.status = 400;
      throw error;
    }
    assertDate(input.date);
    return this.repository.upsertN8nEvidence({
      accountKey: input.accountKey,
      externalId: String(input.externalId),
      emailId: input.emailId == null ? null : String(input.emailId),
      date: input.date,
      amountCents: input.amountCents,
      payee: String(input.payee),
      statementDescription: input.statementDescription || null,
      lunchMoneyTransactionId: input.lunchMoneyTransactionId == null
        ? null
        : String(input.lunchMoneyTransactionId),
      observedAt: input.observedAt || new Date().toISOString(),
      payload: input.payload || {},
    });
  }

}
