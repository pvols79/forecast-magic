import crypto from 'node:crypto';
import { ReconciliationRepository } from '../repositories/reconciliationRepository.js';
import { AuditClearanceRepository } from '../repositories/auditClearanceRepository.js';
import { LunchMoneyService } from './lunchMoneyService.js';
import { normalizeAuditTransaction } from '../domain/financialAudit.js';
import { applyAuditClearance, buildClearanceRegister } from '../domain/auditClearance.js';
import { addDays } from '../domain/periods.js';
import { parseReconciliationCsv, parsePendingText, validateEvidenceReview } from '../domain/reconciliationEvidence.js';
import { reconcileEvidence } from '../domain/reconciliation.js';
import { extractScreenshotText } from './reconciliationOcr.js';

const badRequest = message => Object.assign(new Error(message), { status: 400 });
export const assertReconciliationAccount = key => {
  if (!/^(plaid|manual):\d+$/.test(key || '')) throw badRequest('Select a Lunch Money account for the evidence.');
};
const accountKeyFor = row => row.manual_account_id != null ? `manual:${row.manual_account_id}` : row.plaid_account_id != null ? `plaid:${row.plaid_account_id}` : null;

export const reconciliationLedger = (raw, accountKey, tags, clearances) => {
  const records = new Map(); const limitations = []; const structural = [];
  const collect = row => {
    if (!row || typeof row !== 'object' || row.id == null) return;
    const existing = records.get(String(row.id));
    if (existing && ['amount', 'date', 'source', 'is_pending'].some(key => existing[key] != null && row[key] != null && existing[key] !== row[key])) {
      throw Object.assign(new Error('Lunch Money data changed while pages were being fetched. Run reconciliation again.'), { status: 409 });
    }
    records.set(String(row.id), { ...existing, ...row });
    for (const child of row.children || []) collect(child);
  };
  raw.forEach(collect);
  const ledger = [];
  for (const row of records.values()) {
    const key = accountKeyFor(row);
    if (row.is_group_parent) {
      if (!(row.children || []).length && key === accountKey) limitations.push(`LM group #${row.id} did not include its underlying transactions.`);
      if (key === accountKey) structural.push({ transactionId: String(row.id), disposition: 'group_parent_excluded', reason: 'Underlying bank transactions are reconciled individually.' });
      continue;
    }
    if (key !== accountKey) continue;
    if (row.split_parent_id != null) {
      if (!records.has(String(row.split_parent_id))) limitations.push(`Split child LM #${row.id} has no parent in the fetched data.`);
      structural.push({ transactionId: String(row.id), disposition: 'split_child_excluded', parentId: String(row.split_parent_id), reason: 'The original unsplit bank amount is reconciled once.' });
      continue;
    }
    const normalized = normalizeAuditTransaction(row, tags);
    if (!normalized) { limitations.push(`LM #${row.id} could not be normalized.`); structural.push({ transactionId: String(row.id), disposition: 'unreadable' }); continue; }
    if (row.currency && row.currency.toLowerCase() !== 'usd') limitations.push(`LM #${row.id} uses ${row.currency}; verify its USD conversion separately.`);
    ledger.push(applyAuditClearance(normalized, clearances));
  }
  return { transactions: ledger, structural, limitations, uniqueRawCount: [...records.values()].filter(row => accountKeyFor(row) === accountKey).length };
};

export class ReconciliationService {
  constructor({ repository = new ReconciliationRepository(), lunchMoney = new LunchMoneyService(), clearances = new AuditClearanceRepository(), ocr = extractScreenshotText } = {}) {
    Object.assign(this, { repository, lunchMoney, clearances, ocr });
    this.running = new Set();
  }
  create(accountKey) { assertReconciliationAccount(accountKey); return this.repository.create(accountKey); }
  latest(accountKey) { assertReconciliationAccount(accountKey); return this.repository.latest(accountKey); }
  async upload(sessionId, kind, filename, content) {
    this.repository.getSession(sessionId);
    if (!['capital_one', 'venmo', 'pending'].includes(kind)) throw badRequest('Choose Capital One CSV, Venmo CSV, or pending screenshot.');
    if (!Buffer.isBuffer(content) || !content.length || content.length > 10 * 1024 * 1024) throw badRequest('Select a nonempty evidence file up to 10 MB.');
    const safeFilename = String(filename || 'evidence').split(/[\\/]/).at(-1).split('').filter(char => char.charCodeAt(0) >= 32).join('').slice(0, 180);
    let mimeType = 'text/csv'; let extractedText; let extraction;
    if (kind === 'pending') {
      const png = content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      const jpeg = content[0] === 255 && content[1] === 216 && content[2] === 255;
      if (!png && !jpeg) throw badRequest('Pending screenshots must be PNG or JPEG images.');
      mimeType = png ? 'image/png' : 'image/jpeg';
      let warning;
      try { extractedText = await this.ocr(content); }
      catch (error) { warning = error.message; extractedText = ''; }
      extraction = parsePendingText(extractedText);
      if (warning) extraction.warnings.push(warning);
    } else {
      extractedText = content.toString('utf8');
      if (extractedText.includes('\0')) throw badRequest('Select a CSV export, not a spreadsheet workbook or PDF.');
      extraction = parseReconciliationCsv(extractedText, kind);
    }
    if (extraction.rows.length > 10000) throw badRequest('Use CSV exports with at most 10,000 rows per file.');
    const id = this.repository.saveEvidence(sessionId, { kind, filename: safeFilename, mimeType, content,
      sha256: crypto.createHash('sha256').update(content).digest('hex'), extractedText, extraction });
    return this.repository.getEvidence(sessionId, id);
  }
  review(sessionId, evidenceId, input) {
    const original = this.repository.getEvidence(sessionId, evidenceId);
    const review = validateEvidenceReview(input, original.kind);
    if (review.useDocument !== false) {
      const originalKeys = original.extraction.rows.map(row => row.key);
      if (originalKeys.some(key => !review.rows.some(row => row.key === key))) throw badRequest('Keep every original row in the review. Exclude a row with a reason instead of deleting it.');
      for (const row of review.rows) {
        const source = original.extraction.rows.find(item => item.key === row.key);
        row.sourceRow = source?.sourceRow ?? row.sourceRow ?? 'manual';
      }
    }
    this.repository.saveReview(sessionId, evidenceId, review);
    return this.repository.getSession(sessionId);
  }
  async run(sessionId, anchorDate, decisions) {
    if (this.running.has(sessionId)) throw Object.assign(new Error('This reconciliation is already running.'), { status: 409 });
    this.running.add(sessionId);
    try {
      let session = this.repository.getSession(sessionId);
      if (!session.evidence.length || session.evidence.some(file => !file.reviewedAt)) throw badRequest('Review and confirm every uploaded document before running reconciliation.');
      if (decisions != null) {
        if (!Array.isArray(decisions) || decisions.length > 10000) throw badRequest('Manual evidence matches must be an array of at most 10,000 decisions.');
        if (JSON.stringify(decisions) !== JSON.stringify(session.decisions)) {
          this.repository.saveDecisions(sessionId, decisions); session = this.repository.getSession(sessionId);
        }
      }
      const bank = session.evidence.filter(file => file.kind === 'capital_one' && file.review.useDocument !== false);
      if (!bank.length) throw badRequest('Include at least one reviewed Capital One export. Venmo and pending screenshots supplement the posted bank ledger.');
      const startDate = bank.map(file => file.review.coverageStart).sort()[0];
      const endDate = bank.map(file => file.review.coverageEnd).sort().at(-1);
      const queriedRange = { startDate: addDays(startDate, -5), endDate: addDays(endDate, 5), paddingDays: 5 };
      const [manualAccounts, plaidAccounts, tags, raw] = await Promise.all([
        this.lunchMoney.getManualAccounts(), this.lunchMoney.getPlaidAccounts(), this.lunchMoney.getTags(),
        this.lunchMoney.getAllRawTransactions({ start_date: queriedRange.startDate, end_date: queriedRange.endDate,
          include_metadata: true, include_children: true, include_group_children: true, include_split_parents: true }),
      ]);
      const account = [...manualAccounts, ...plaidAccounts].find(item => item.key === session.accountKey);
      if (!account) throw badRequest('This session account is no longer available in Lunch Money.');
      const entries = this.clearances.list(session.accountKey);
      const snapshot = reconciliationLedger(raw, session.accountKey, new Map(tags.map(tag => [Number(tag.id), tag.name])), entries);
      for (const file of bank) {
        for (const row of file.review.rows.filter(row => !row.relevant && row.date && row.amountCents)) {
          snapshot.limitations.push(`Excluded bank transaction in ${file.filename}, line ${row.sourceRow}: ${row.exclusionReason}. This prevents a full-coverage verdict.`);
        }
      }
      const result = reconcileEvidence({ evidence: session.evidence, transactions: snapshot.transactions, account, anchorDate, queriedRange,
        clearanceRegister: buildClearanceRegister(entries, snapshot.transactions, queriedRange), limitations: snapshot.limitations, decisions: session.decisions });
      result.sourceSnapshot = { uniqueRawRecordCount: snapshot.uniqueRawCount, accountingRecordCount: snapshot.transactions.length,
        structuralRecords: snapshot.structural, allLunchMoneyPagesRead: true, splitAndGroupPolicy: 'Split parents once; grouped bank transactions individually; structural containers excluded.' };
      const runId = this.repository.saveRun(sessionId, session.revision, result);
      return { ...this.repository.getSession(sessionId), completedRunId: runId };
    } finally { this.running.delete(sessionId); }
  }
}
