import { config } from '../config.js';
import {
  assessAuditHealth, buildBalanceBridge, compareObservedTransactions,
  findStalePendingTransactions, findTagComplianceIssues, matchExternalTransactions,
  normalizeAuditTransaction, parseCapitalOneCsv, summarizeTransactionSources,
} from '../domain/financialAudit.js';
import { payeeSimilarity } from '../domain/duplicateReview.js';
import { addDays } from '../domain/periods.js';
import { FinancialAuditRepository } from '../repositories/financialAuditRepository.js';
import { DuplicateReviewService } from './duplicateReviewService.js';
import { FinancialAnalyticsService } from './financialAnalyticsService.js';
import { LunchMoneyService } from './lunchMoneyService.js';

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

const ageHours = timestamp => timestamp
  ? (Date.now() - new Date(timestamp).getTime()) / 3600000
  : Number.POSITIVE_INFINITY;

const statementIsFresh = (statement, anchorDate) => Boolean(
  statement
  && statement.coverageEnd >= addDays(anchorDate, -1)
  && ageHours(statement.importedAt) <= config.auditStatementFreshHours
);

const publicTransaction = transaction => ({
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
});

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
  constructor({ repository, lunchMoney, analytics, duplicateReview } = {}) {
    this.repository = repository || new FinancialAuditRepository();
    this.lunchMoney = lunchMoney || new LunchMoneyService();
    this.analytics = analytics || new FinancialAnalyticsService({ lunchMoney: this.lunchMoney });
    this.duplicateReview = duplicateReview || new DuplicateReviewService(this.lunchMoney);
  }

  async run(accountKey, anchorDate) {
    assertAccountKey(accountKey);
    assertDate(anchorDate);
    const startedAt = new Date().toISOString();
    const startDate = addDays(anchorDate, -89);
    const previousRun = this.repository.getLatestRun(accountKey);
    const previousTransactions = previousRun
      ? new Map(this.repository.listRunTransactions(previousRun.id).map(item => [item.transactionId, item]))
      : new Map();
    const [manualAccounts, plaidAccounts, tags, rawTransactions, overview, duplicateSummary] = await Promise.all([
      this.lunchMoney.getManualAccounts(),
      this.lunchMoney.getPlaidAccounts(),
      this.lunchMoney.getTags(),
      this.lunchMoney.getRawTransactions(startDate, anchorDate, { includeMetadata: true }),
      this.analytics.getOverview(accountKey, anchorDate, { view: 'admin' }),
      this.duplicateReview.getReportingSummary(accountKey, anchorDate),
    ]);
    const account = [...manualAccounts, ...plaidAccounts].find(item => item.key === accountKey);
    if (!account) {
      const error = new Error('Selected account was not found in Lunch Money.');
      error.status = 404;
      throw error;
    }
    const tagNamesById = new Map(tags.map(tag => [Number(tag.id), tag.name]));
    const transactions = rawTransactions
      .map(transaction => normalizeAuditTransaction(transaction, tagNamesById))
      .filter(transaction => transaction?.accountKey === accountKey);
    const latestStatement = this.repository.getLatestStatementImport(accountKey);
    const statementTransactions = latestStatement
      ? this.repository.listStatementTransactions(latestStatement.id)
      : [];
    const n8nEvidence = this.repository.listN8nEvidence(accountKey, startDate, anchorDate);
    const freshStatement = statementIsFresh(latestStatement, anchorDate);
    const externalMatch = latestStatement
      ? matchExternalTransactions(statementTransactions, transactions)
      : { links: [], unmatchedExternal: [], unmatchedLunchMoney: [] };
    const compliance = findTagComplianceIssues(transactions);
    const stalePending = findStalePendingTransactions(
      transactions, anchorDate, config.auditPendingWarningBusinessDays
    );
    const observedChanges = compareObservedTransactions(previousTransactions, transactions);
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
        'Import a Capital One CSV and provide current ledger and available balances before judging missing transactions.'
      ));
    } else if (!freshStatement) {
      findings.push(finding(
        'capital-one-evidence-stale', 'unknown', 'source_freshness',
        'Capital One evidence is too old for a missing-transaction audit',
        `The latest import covers ${latestStatement.coverageStart} through ${latestStatement.coverageEnd}.`,
        { statement: latestStatement }
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
        `${transaction.payee} on ${transaction.date} was identified as n8n-created but lacks Forecast Magic Pending.`,
        { transaction: publicTransaction(transaction) }
      ));
    }
    for (const transaction of stalePending) {
      const severity = transaction.businessDaysOpen > config.auditPendingCriticalBusinessDays ? 'critical' : 'warning';
      findings.push(finding(
        `stale-pending-${transaction.transactionId}`, severity, 'stale_pending',
        'Pending transaction has not cleared',
        `${transaction.payee} has remained pending for ${transaction.businessDaysOpen} business days.`,
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
    for (const change of observedChanges) {
      findings.push(finding(
        `observed-change-${change.transactionId}`, 'warning', 'transaction_integrity',
        'Lunch Money transaction changed since the prior audit',
        `Transaction ${change.transactionId} changed after the previous audit.`,
        change
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
        freshEnoughForMissingAudit: freshStatement,
      } : null,
      n8n: { latestEvidenceAt: this.repository.latestN8nEvidenceTimestamp(accountKey) },
    };
    const health = assessAuditHealth({
      findings,
      hasFreshStatementEvidence: freshStatement,
      balanceDifferenceCents: bridge.unexplainedAvailableDifferenceCents,
    });
    const transactionSources = summarizeTransactionSources(transactions);
    const summary = {
      health,
      facts: {
        account: { key: account.key, name: account.name, source: account.source },
        auditWindow: { startDate, endDate: anchorDate },
        transactionSources,
        balanceBridge: bridge,
        tagCompliance: {
          untaggedN8nCandidateCount: compliance.untaggedN8nCandidates.length,
          suspiciousPendingTagCount: compliance.stalePendingCandidates.length,
        },
        transactionIntegrity: {
          possibleDuplicateCount: duplicateSummary.needsReview,
          missingFromLunchMoneyCount: freshStatement ? externalMatch.unmatchedExternal.length : null,
          stalePendingCount: stalePending.length,
          settlementChangeCount: lifecycleChanges.length,
          observedChangeCount: observedChanges.length,
        },
        spendablePosition: overview.openingReconciliation,
        fundReservations: overview.funds,
      },
      unknowns: findings.filter(item => item.severity === 'unknown').map(item => item.summary),
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
