import crypto from 'node:crypto';
import { parse } from 'csv-parse/sync';
import { payeeSimilarity } from './duplicateReview.js';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const N8N_NOTE_PATTERN = /created from capital one gmail alert by n8n/i;
const PENDING_TAG_NAMES = new Set(['forecastmagicpending', 'n8npending']);
const N8N_TAG_NAMES = new Set(['n8nproc', 'n8nprocessed', 'n8ncreated']);

const normalizeName = value => String(value || '')
  .toLowerCase()
  .replace(/[^a-z0-9]/g, '');

const parseMoney = value => {
  if (value == null || value === '') return null;
  const number = Number(String(value).replace(/[$,]/g, '').trim());
  return Number.isFinite(number) ? Math.round(number * 100) : null;
};

const isoDate = value => {
  const text = String(value || '').trim();
  if (DATE_PATTERN.test(text)) return text;
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(text);
  if (!match) return null;
  const year = Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3]);
  return `${year}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
};

const accountKeyFor = transaction => transaction.manual_account_id != null
  ? `manual:${transaction.manual_account_id}`
  : transaction.plaid_account_id != null
    ? `plaid:${transaction.plaid_account_id}`
    : null;

const unique = values => [...new Set(values.filter(value => value != null))];

export const businessDaysBetween = (startDate, endDate) => {
  if (!DATE_PATTERN.test(startDate) || !DATE_PATTERN.test(endDate) || startDate >= endDate) return 0;
  const cursor = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  let count = 0;
  while (cursor < end) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const day = cursor.getUTCDay();
    if (cursor <= end && day !== 0 && day !== 6) count += 1;
  }
  return count;
};

export const normalizeAuditTransaction = (transaction, tagNamesById = new Map()) => {
  const accountKey = accountKeyFor(transaction);
  const apiAmount = Number(transaction.to_base ?? transaction.amount);
  if (transaction.id == null || !accountKey || !transaction.date || !Number.isFinite(apiAmount)) return null;
  const tagIds = unique((transaction.tag_ids || []).map(Number));
  const tagNames = tagIds.map(id => tagNamesById.get(id)).filter(Boolean);
  const normalizedTags = new Set(tagNames.map(normalizeName));
  const externalId = transaction.external_id == null ? null : String(transaction.external_id);
  const notes = String(transaction.notes || '');
  const isN8n = N8N_NOTE_PATTERN.test(notes)
    || externalId?.startsWith('n8n-capone-gmail-')
    || [...normalizedTags].some(tag => N8N_TAG_NAMES.has(tag));
  const hasPendingTag = [...normalizedTags].some(tag => PENDING_TAG_NAMES.has(tag));
  const result = {
    transactionId: String(transaction.id),
    accountKey,
    source: String(transaction.source || 'unknown').toLowerCase(),
    date: transaction.date,
    amountCents: Math.round(-apiAmount * 100),
    payee: transaction.payee || transaction.notes || 'Transaction',
    originalPayee: transaction.original_name || transaction.original_payee || null,
    categoryId: transaction.category_id == null ? null : Number(transaction.category_id),
    recurringId: transaction.recurring_id == null ? null : String(transaction.recurring_id),
    isPending: Boolean(transaction.is_pending),
    tagIds,
    tagNames,
    notes,
    externalId,
    isN8n,
    hasPendingTag,
    createdAt: transaction.created_at || null,
    updatedAt: transaction.updated_at || null,
  };
  result.fingerprint = crypto.createHash('sha256').update(JSON.stringify({
    date: result.date,
    amountCents: result.amountCents,
    payee: result.payee,
    originalPayee: result.originalPayee,
    isPending: result.isPending,
    tags: [...result.tagIds].sort((a, b) => a - b),
  })).digest('hex');
  return result;
};

const findHeader = (row, aliases) => {
  const entries = Object.entries(row);
  const match = entries.find(([key]) => aliases.includes(normalizeName(key)));
  return match?.[1];
};

export const parseCapitalOneCsv = (csvText, options = {}) => {
  const rows = parse(String(csvText || '').replace(/^\uFEFF/, ''), {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  });
  const transactions = rows.map((row, index) => {
    const date = isoDate(findHeader(row, ['transactiondate', 'date', 'posteddate']));
    const description = String(findHeader(row, ['transactiondescription', 'description', 'payee', 'merchant']) || '').trim();
    const transactionType = String(findHeader(row, ['transactiontype', 'type']) || '').trim();
    const debitCents = parseMoney(findHeader(row, ['debit', 'withdrawal']));
    const creditCents = parseMoney(findHeader(row, ['credit', 'deposit']));
    let amountCents = parseMoney(findHeader(row, ['transactionamount', 'amount']));
    if (amountCents == null && debitCents != null) amountCents = -Math.abs(debitCents);
    if (amountCents == null && creditCents != null) amountCents = Math.abs(creditCents);
    if (!date || !description || amountCents == null) return null;
    if (debitCents == null && creditCents == null) {
      if (/debit|withdrawal|purchase/i.test(transactionType)) amountCents = -Math.abs(amountCents);
      else if (/credit|deposit/i.test(transactionType)) amountCents = Math.abs(amountCents);
      else if (amountCents > 0) amountCents = -amountCents;
    }
    const balanceAfterCents = parseMoney(findHeader(row, ['balance', 'runningbalance']));
    const rowKey = crypto.createHash('sha256').update(JSON.stringify({
      index, date, description, amountCents, balanceAfterCents, transactionType,
    })).digest('hex');
    return { rowKey, date, description, amountCents, balanceAfterCents, transactionType };
  }).filter(Boolean);
  if (!transactions.length) {
    const error = new Error('The Capital One CSV did not contain recognizable transactions.');
    error.status = 400;
    throw error;
  }
  const dates = transactions.map(transaction => transaction.date).sort();
  const newest = transactions.reduce((candidate, transaction) => (
    !candidate || transaction.date > candidate.date ? transaction : candidate
  ), null);
  return {
    accountKey: options.accountKey,
    source: 'capital_one_csv',
    filename: options.filename || 'capital-one.csv',
    contentSha256: crypto.createHash('sha256').update(String(csvText)).digest('hex'),
    coverageStart: dates[0],
    coverageEnd: dates.at(-1),
    closingBalanceCents: options.ledgerBalanceCents ?? newest?.balanceAfterCents ?? null,
    importedAt: options.importedAt || new Date().toISOString(),
    transactions,
  };
};

const daysApart = (left, right) => Math.abs(
  Math.round((new Date(`${left}T00:00:00Z`) - new Date(`${right}T00:00:00Z`)) / 86400000)
);

const matchScore = (external, lunchMoney) => {
  if (external.amountCents !== lunchMoney.amountCents) return null;
  const dateDistance = daysApart(external.date, lunchMoney.date);
  if (dateDistance > 3) return null;
  const similarity = Math.max(
    payeeSimilarity(external.description || external.payee, lunchMoney.payee),
    payeeSimilarity(external.description || external.payee, lunchMoney.originalPayee)
  );
  return { score: 100 - dateDistance * 15 + Math.round(similarity * 30), dateDistance, similarity };
};

export const matchExternalTransactions = (externalTransactions, lunchMoneyTransactions) => {
  const available = new Set(lunchMoneyTransactions.map(transaction => transaction.transactionId));
  const links = [];
  const unmatchedExternal = [];
  for (const external of externalTransactions) {
    const candidates = lunchMoneyTransactions
      .filter(transaction => available.has(transaction.transactionId))
      .map(transaction => ({ transaction, match: matchScore(external, transaction) }))
      .filter(candidate => candidate.match)
      .sort((left, right) => {
        const leftImported = left.transaction.source === 'plaid' && !left.transaction.isPending ? 1 : 0;
        const rightImported = right.transaction.source === 'plaid' && !right.transaction.isPending ? 1 : 0;
        return rightImported - leftImported || right.match.score - left.match.score;
      });
    const best = candidates[0];
    if (!best) {
      unmatchedExternal.push(external);
      continue;
    }
    available.delete(best.transaction.transactionId);
    links.push({
      external,
      lunchMoney: best.transaction,
      confidence: best.match.dateDistance <= 1 && best.match.similarity >= 0.5 ? 'high' : 'medium',
      dateDistance: best.match.dateDistance,
      payeeSimilarity: Number(best.match.similarity.toFixed(2)),
    });
  }
  return {
    links,
    unmatchedExternal,
    unmatchedLunchMoney: lunchMoneyTransactions.filter(transaction => available.has(transaction.transactionId)),
  };
};

export const summarizeTransactionSources = transactions => {
  const sum = items => items.reduce((total, item) => total + item.amountCents, 0);
  const summary = items => ({ count: items.length, netCents: sum(items) });
  return {
    all: summary(transactions),
    imported: summary(transactions.filter(transaction => transaction.source === 'plaid' && !transaction.isPending)),
    nativePending: summary(transactions.filter(transaction => transaction.source === 'plaid' && transaction.isPending)),
    n8nCreated: summary(transactions.filter(transaction => transaction.isN8n)),
    taggedPendingPlaceholders: summary(transactions.filter(transaction => transaction.isN8n && transaction.hasPendingTag)),
  };
};

export const buildBalanceBridge = ({ lunchMoneyBalanceCents, capitalOneLedgerCents, capitalOneAvailableCents, transactions }) => {
  const nativePending = transactions.filter(transaction => transaction.source === 'plaid' && transaction.isPending);
  const placeholders = transactions.filter(transaction => transaction.isN8n && transaction.hasPendingTag && !transaction.isPending);
  const nativePendingCents = nativePending.reduce((total, transaction) => total + transaction.amountCents, 0);
  const placeholderCents = placeholders.reduce((total, transaction) => total + transaction.amountCents, 0);
  const expectedAvailableCents = lunchMoneyBalanceCents + nativePendingCents + placeholderCents;
  return {
    lunchMoneySyncedBalanceCents: lunchMoneyBalanceCents,
    capitalOneLedgerBalanceCents: capitalOneLedgerCents ?? null,
    capitalOneAvailableBalanceCents: capitalOneAvailableCents ?? null,
    nativePendingCents,
    taggedN8nPlaceholderCents: placeholderCents,
    expectedAvailableCents,
    unexplainedAvailableDifferenceCents: capitalOneAvailableCents == null
      ? null
      : capitalOneAvailableCents - expectedAvailableCents,
  };
};

export const findTagComplianceIssues = transactions => ({
  untaggedN8nCandidates: transactions.filter(transaction => transaction.isN8n && !transaction.hasPendingTag),
  stalePendingCandidates: transactions.filter(transaction => transaction.hasPendingTag && !transaction.isN8n),
});

export const findStalePendingTransactions = (transactions, anchorDate, warningDays = 3) => transactions
  .filter(transaction => transaction.isPending || transaction.hasPendingTag)
  .map(transaction => ({ ...transaction, businessDaysOpen: businessDaysBetween(transaction.date, anchorDate) }))
  .filter(transaction => transaction.businessDaysOpen > warningDays)
  .sort((left, right) => right.businessDaysOpen - left.businessDaysOpen);

export const compareObservedTransactions = (previousById, current) => current.flatMap(transaction => {
  const previous = previousById.get(transaction.transactionId);
  if (!previous || previous.fingerprint === transaction.fingerprint) return [];
  const changes = {};
  for (const field of ['date', 'amountCents', 'payee', 'originalPayee', 'isPending']) {
    if (previous[field] !== transaction[field]) changes[field] = { from: previous[field], to: transaction[field] };
  }
  return Object.keys(changes).length ? [{ transactionId: transaction.transactionId, changes }] : [];
});

export const assessAuditHealth = ({ findings, hasFreshStatementEvidence, balanceDifferenceCents }) => {
  const critical = findings.filter(finding => finding.severity === 'critical').length;
  const warnings = findings.filter(finding => finding.severity === 'warning').length;
  const unknowns = findings.filter(finding => finding.severity === 'unknown').length;
  if (!hasFreshStatementEvidence) {
    return { status: 'not_assessable', confidenceScore: Math.max(10, 45 - warnings * 3), critical, warnings, unknowns };
  }
  let score = 100 - critical * 25 - warnings * 8 - unknowns * 3;
  if (balanceDifferenceCents != null) score -= Math.min(25, Math.floor(Math.abs(balanceDifferenceCents) / 2500));
  score = Math.max(0, Math.min(100, score));
  return {
    status: critical ? 'unreliable' : warnings || Math.abs(balanceDifferenceCents || 0) >= 100 ? 'attention' : 'healthy',
    confidenceScore: score,
    critical,
    warnings,
    unknowns,
  };
};
