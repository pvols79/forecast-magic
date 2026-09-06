import { getDatabase, withTransaction } from '../db/database.js';

const parseJson = (value, fallback) => {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const hydrateRun = row => row ? {
  id: Number(row.id),
  accountKey: row.account_key,
  anchorDate: row.anchor_date,
  status: row.status,
  confidenceScore: Number(row.confidence_score),
  startedAt: row.started_at,
  completedAt: row.completed_at,
  sourceFreshness: parseJson(row.source_freshness_json, {}),
  summary: parseJson(row.summary_json, {}),
} : null;

const hydrateFinding = row => ({
  id: Number(row.id),
  runId: Number(row.run_id),
  key: row.finding_key,
  severity: row.severity,
  category: row.category,
  title: row.title,
  summary: row.summary,
  status: row.status,
  evidence: parseJson(row.evidence_json, {}),
});

const hydrateStatement = row => row ? {
  id: Number(row.id),
  accountKey: row.account_key,
  source: row.source,
  filename: row.filename,
  contentSha256: row.content_sha256,
  coverageStart: row.coverage_start,
  coverageEnd: row.coverage_end,
  closingBalanceCents: row.closing_balance_cents == null ? null : Number(row.closing_balance_cents),
  importedAt: row.imported_at,
  rowCount: Number(row.row_count),
} : null;

export class FinancialAuditRepository {
  saveRun({ accountKey, anchorDate, status, confidenceScore, startedAt, completedAt, sourceFreshness, summary, transactions, findings }) {
    return withTransaction(db => {
      const run = db.prepare(`
        INSERT INTO audit_runs (
          account_key, anchor_date, status, confidence_score, started_at, completed_at,
          source_freshness_json, summary_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        accountKey, anchorDate, status, confidenceScore, startedAt, completedAt,
        JSON.stringify(sourceFreshness), JSON.stringify(summary)
      );
      const runId = Number(run.lastInsertRowid);
      const insertTransaction = db.prepare(`
        INSERT INTO audit_transaction_observations (
          run_id, account_key, transaction_id, source, date, amount_cents, payee,
          original_payee, category_id, recurring_id, is_pending, tag_ids_json,
          is_n8n, has_pending_tag, tag_names_json, notes, external_id,
          created_at_api, updated_at_api, fingerprint
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const transaction of transactions) {
        insertTransaction.run(
          runId, accountKey, String(transaction.transactionId), transaction.source,
          transaction.date, transaction.amountCents, transaction.payee,
          transaction.originalPayee || null, transaction.categoryId ?? null,
          transaction.recurringId == null ? null : String(transaction.recurringId),
          transaction.isPending ? 1 : 0, JSON.stringify(transaction.tagIds || []),
          transaction.isN8n ? 1 : 0, transaction.hasPendingTag ? 1 : 0,
          JSON.stringify(transaction.tagNames || []), transaction.notes || null,
          transaction.externalId || null, transaction.createdAt || null,
          transaction.updatedAt || null, transaction.fingerprint
        );
      }
      const insertFinding = db.prepare(`
        INSERT INTO audit_findings (
          run_id, finding_key, severity, category, title, summary, status, evidence_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const finding of findings) {
        insertFinding.run(
          runId, finding.key, finding.severity, finding.category, finding.title,
          finding.summary, finding.status || 'open', JSON.stringify(finding.evidence || {})
        );
      }
      return runId;
    });
  }

  getLatestRun(accountKey) {
    const row = getDatabase().prepare(`
      SELECT * FROM audit_runs WHERE account_key = ? ORDER BY completed_at DESC, id DESC LIMIT 1
    `).get(accountKey);
    return hydrateRun(row);
  }

  getRun(runId) {
    return hydrateRun(getDatabase().prepare('SELECT * FROM audit_runs WHERE id = ?').get(runId));
  }

  listFindings(runId, { severity, category } = {}) {
    const clauses = ['run_id = ?'];
    const values = [runId];
    if (severity) {
      clauses.push('severity = ?');
      values.push(severity);
    }
    if (category) {
      clauses.push('category = ?');
      values.push(category);
    }
    return getDatabase().prepare(`
      SELECT * FROM audit_findings
      WHERE ${clauses.join(' AND ')}
      ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, id
    `).all(...values).map(hydrateFinding);
  }

  getFinding(runId, findingKey) {
    const row = getDatabase().prepare(`
      SELECT * FROM audit_findings WHERE run_id = ? AND finding_key = ?
    `).get(runId, findingKey);
    return row ? hydrateFinding(row) : null;
  }

  listRunTransactions(runId, filters = {}) {
    const clauses = ['run_id = ?'];
    const values = [runId];
    if (filters.source) {
      clauses.push('source = ?');
      values.push(filters.source);
    }
    if (filters.pending != null) {
      clauses.push('is_pending = ?');
      values.push(filters.pending ? 1 : 0);
    }
    return getDatabase().prepare(`
      SELECT * FROM audit_transaction_observations
      WHERE ${clauses.join(' AND ')}
      ORDER BY date DESC, transaction_id DESC
    `).all(...values).map(row => ({
      transactionId: row.transaction_id,
      accountKey: row.account_key,
      source: row.source,
      date: row.date,
      amountCents: Number(row.amount_cents),
      payee: row.payee,
      originalPayee: row.original_payee,
      categoryId: row.category_id == null ? null : Number(row.category_id),
      recurringId: row.recurring_id,
      isPending: Boolean(row.is_pending),
      isN8n: Boolean(row.is_n8n),
      hasPendingTag: Boolean(row.has_pending_tag),
      tagIds: parseJson(row.tag_ids_json, []),
      tagNames: parseJson(row.tag_names_json, []),
      notes: row.notes,
      externalId: row.external_id,
      createdAt: row.created_at_api,
      updatedAt: row.updated_at_api,
      fingerprint: row.fingerprint,
    }));
  }

  listPreviousTransactionObservations(accountKey, beforeRunId) {
    const rows = getDatabase().prepare(`
      SELECT observation.*
      FROM audit_transaction_observations observation
      JOIN (
        SELECT transaction_id, MAX(run_id) AS run_id
        FROM audit_transaction_observations
        WHERE account_key = ? AND run_id < ?
        GROUP BY transaction_id
      ) previous ON previous.transaction_id = observation.transaction_id
        AND previous.run_id = observation.run_id
      WHERE observation.account_key = ?
    `).all(accountKey, beforeRunId, accountKey);
    return new Map(rows.map(row => [row.transaction_id, {
      transactionId: row.transaction_id,
      date: row.date,
      amountCents: Number(row.amount_cents),
      payee: row.payee,
      originalPayee: row.original_payee,
      isPending: Boolean(row.is_pending),
      fingerprint: row.fingerprint,
    }]));
  }

  saveBalanceObservation({ runId = null, accountKey, source, balanceKind, amountCents, observedAt, metadata = {} }) {
    getDatabase().prepare(`
      INSERT INTO audit_balance_observations (
        run_id, account_key, source, balance_kind, amount_cents, observed_at, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(runId, accountKey, source, balanceKind, amountCents, observedAt, JSON.stringify(metadata));
  }

  getLatestBalanceObservation(accountKey, source, balanceKind) {
    const row = getDatabase().prepare(`
      SELECT * FROM audit_balance_observations
      WHERE account_key = ? AND source = ? AND balance_kind = ?
      ORDER BY observed_at DESC, id DESC LIMIT 1
    `).get(accountKey, source, balanceKind);
    return row ? {
      id: Number(row.id),
      runId: row.run_id == null ? null : Number(row.run_id),
      accountKey: row.account_key,
      source: row.source,
      balanceKind: row.balance_kind,
      amountCents: Number(row.amount_cents),
      observedAt: row.observed_at,
      metadata: parseJson(row.metadata_json, {}),
    } : null;
  }

  saveStatementImport(statement) {
    return withTransaction(db => {
      const existing = db.prepare(`
        SELECT * FROM audit_statement_imports WHERE account_key = ? AND content_sha256 = ?
      `).get(statement.accountKey, statement.contentSha256);
      if (existing) return { statement: hydrateStatement(existing), existed: true };
      const result = db.prepare(`
        INSERT INTO audit_statement_imports (
          account_key, source, filename, content_sha256, coverage_start, coverage_end,
          closing_balance_cents, imported_at, row_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        statement.accountKey, statement.source, statement.filename, statement.contentSha256,
        statement.coverageStart, statement.coverageEnd, statement.closingBalanceCents,
        statement.importedAt, statement.transactions.length
      );
      const importId = Number(result.lastInsertRowid);
      const insert = db.prepare(`
        INSERT INTO audit_statement_transactions (
          import_id, row_key, date, description, amount_cents, balance_after_cents, transaction_type
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const transaction of statement.transactions) {
        insert.run(
          importId, transaction.rowKey, transaction.date, transaction.description,
          transaction.amountCents, transaction.balanceAfterCents, transaction.transactionType
        );
      }
      return {
        statement: hydrateStatement(db.prepare('SELECT * FROM audit_statement_imports WHERE id = ?').get(importId)),
        existed: false,
      };
    });
  }

  getLatestStatementImport(accountKey) {
    return hydrateStatement(getDatabase().prepare(`
      SELECT * FROM audit_statement_imports
      WHERE account_key = ?
      ORDER BY coverage_end DESC, imported_at DESC, id DESC LIMIT 1
    `).get(accountKey));
  }

  listStatementTransactions(importId) {
    return getDatabase().prepare(`
      SELECT * FROM audit_statement_transactions WHERE import_id = ? ORDER BY date DESC, id
    `).all(importId).map(row => ({
      id: String(row.id),
      rowKey: row.row_key,
      date: row.date,
      description: row.description,
      amountCents: Number(row.amount_cents),
      balanceAfterCents: row.balance_after_cents == null ? null : Number(row.balance_after_cents),
      transactionType: row.transaction_type,
    }));
  }

  upsertN8nEvidence(evidence) {
    getDatabase().prepare(`
      INSERT INTO audit_n8n_evidence (
        account_key, external_id, email_id, date, amount_cents, payee,
        statement_description, lunch_money_transaction_id, observed_at, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_key, external_id) DO UPDATE SET
        email_id = excluded.email_id,
        date = excluded.date,
        amount_cents = excluded.amount_cents,
        payee = excluded.payee,
        statement_description = excluded.statement_description,
        lunch_money_transaction_id = COALESCE(excluded.lunch_money_transaction_id, audit_n8n_evidence.lunch_money_transaction_id),
        observed_at = excluded.observed_at,
        payload_json = excluded.payload_json
    `).run(
      evidence.accountKey, evidence.externalId, evidence.emailId || null, evidence.date,
      evidence.amountCents, evidence.payee, evidence.statementDescription || null,
      evidence.lunchMoneyTransactionId || null, evidence.observedAt, JSON.stringify(evidence.payload || {})
    );
    return evidence;
  }

  listN8nEvidence(accountKey, startDate, endDate) {
    return getDatabase().prepare(`
      SELECT * FROM audit_n8n_evidence
      WHERE account_key = ? AND date BETWEEN ? AND ?
      ORDER BY date DESC, id DESC
    `).all(accountKey, startDate, endDate).map(row => ({
      id: String(row.id),
      accountKey: row.account_key,
      externalId: row.external_id,
      emailId: row.email_id,
      date: row.date,
      amountCents: Number(row.amount_cents),
      payee: row.payee,
      statementDescription: row.statement_description,
      lunchMoneyTransactionId: row.lunch_money_transaction_id,
      observedAt: row.observed_at,
      payload: parseJson(row.payload_json, {}),
    }));
  }

  latestN8nEvidenceTimestamp(accountKey) {
    return getDatabase().prepare(`
      SELECT MAX(observed_at) AS observed_at FROM audit_n8n_evidence WHERE account_key = ?
    `).get(accountKey)?.observed_at || null;
  }

  replaceTransactionLinks(accountKey, links) {
    return withTransaction(db => {
      db.prepare('DELETE FROM audit_transaction_links WHERE account_key = ?').run(accountKey);
      const insert = db.prepare(`
        INSERT INTO audit_transaction_links (
          account_key, left_source, left_id, right_source, right_id,
          relationship, confidence, details_json, observed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const link of links) {
        insert.run(
          accountKey, link.leftSource, link.leftId, link.rightSource, link.rightId,
          link.relationship, link.confidence, JSON.stringify(link.details || {}), link.observedAt
        );
      }
      return links.length;
    });
  }
}
