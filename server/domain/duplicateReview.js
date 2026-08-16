import crypto from 'node:crypto';

const DAY_MS = 24 * 60 * 60 * 1000;
const USER_ENTERED_SOURCES = new Set(['manual', 'api']);
const IMPORTED_SOURCE = 'plaid';

const asId = value => value == null ? null : String(value);
const asNumber = value => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const parseDate = value => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
};

const unique = values => [...new Set(values.filter(value => value != null))];

export const getTransactionAccountKey = transaction => {
  if (transaction.manual_account_id != null) return `manual:${transaction.manual_account_id}`;
  if (transaction.plaid_account_id != null) return `plaid:${transaction.plaid_account_id}`;
  return null;
};

export const normalizePayee = value => String(value || '')
  .toLocaleLowerCase('en-US')
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const bigrams = value => {
  if (value.length < 2) return value ? [value] : [];
  return Array.from({ length: value.length - 1 }, (_, index) => value.slice(index, index + 2));
};

export const payeeSimilarity = (left, right) => {
  const a = normalizePayee(left);
  const b = normalizePayee(right);
  if (!a || !b) return 0;
  if (a === b) return 1;

  const shorter = a.length <= b.length ? a : b;
  const longer = a.length > b.length ? a : b;
  if (shorter.length >= 4 && longer.includes(shorter)) return 0.9;

  const aBigrams = bigrams(a);
  const bBigrams = bigrams(b);
  const remaining = [...bBigrams];
  let overlap = 0;
  for (const pair of aBigrams) {
    const index = remaining.indexOf(pair);
    if (index < 0) continue;
    overlap += 1;
    remaining.splice(index, 1);
  }
  return (2 * overlap) / (aBigrams.length + bBigrams.length || 1);
};

export const normalizeReviewTransaction = (transaction, categoryNames = new Map()) => {
  const source = String(transaction.source || '').toLocaleLowerCase('en-US');
  const accountKey = getTransactionAccountKey(transaction);
  const apiAmount = asNumber(transaction.to_base ?? transaction.amount);
  if (!transaction.id || !accountKey || apiAmount == null || !transaction.date) return null;

  return {
    id: asId(transaction.id),
    accountKey,
    date: transaction.date,
    payee: transaction.payee || '',
    amount: -apiAmount,
    apiAmount,
    categoryId: transaction.category_id == null ? null : Number(transaction.category_id),
    categoryName: transaction.category_id == null
      ? 'Uncategorized'
      : categoryNames.get(Number(transaction.category_id)) || `Category #${transaction.category_id}`,
    notes: transaction.notes || '',
    tagIds: unique((transaction.tag_ids || []).map(Number)),
    recurringId: transaction.recurring_id == null ? null : asId(transaction.recurring_id),
    recurringName: transaction.recurring_id == null ? null : `Recurring #${transaction.recurring_id}`,
    source,
    // Lunch Money labels entries created through its API as "api". They are
    // user-authored candidates for the same manual-versus-imported workflow.
    origin: USER_ENTERED_SOURCES.has(source) ? 'manual' : source === IMPORTED_SOURCE ? 'imported' : 'other',
    isPending: Boolean(transaction.is_pending),
    updatedAt: transaction.updated_at || null,
  };
};

export const transactionFingerprint = transaction => crypto.createHash('sha256').update(JSON.stringify({
  id: transaction.id,
  accountKey: transaction.accountKey,
  date: transaction.date,
  apiAmount: transaction.apiAmount,
  payee: transaction.payee,
  categoryId: transaction.categoryId,
  notes: transaction.notes,
  tagIds: [...transaction.tagIds].sort((a, b) => a - b),
  recurringId: transaction.recurringId,
  source: transaction.source,
  updatedAt: transaction.updatedAt,
})).digest('hex');

const dateDifference = (left, right) => {
  const a = parseDate(left);
  const b = parseDate(right);
  if (!a || !b) return Number.POSITIVE_INFINITY;
  return Math.round(Math.abs(a.getTime() - b.getTime()) / DAY_MS);
};

const candidateId = (manual, imported) => `${manual.id}:${imported.id}`;

const scorePair = (manual, imported) => {
  if (manual.origin !== 'manual' || imported.origin !== 'imported') return null;
  if (manual.accountKey !== imported.accountKey) return null;
  if (manual.apiAmount !== imported.apiAmount) return null;

  const daysApart = dateDifference(manual.date, imported.date);
  if (daysApart > 3) return null;

  const similarity = payeeSimilarity(manual.payee, imported.payee);
  const sameCategory = manual.categoryId != null && manual.categoryId === imported.categoryId;
  const sameRecurring = manual.recurringId != null && manual.recurringId === imported.recurringId;
  let confidence;
  if (daysApart <= 1 && similarity >= 0.72) confidence = 'high';
  else if (daysApart <= 2 || similarity >= 0.35 || sameCategory || sameRecurring) confidence = 'medium';
  else confidence = 'low';

  const reasons = [
    'Exact amount',
    manual.source === 'api' ? 'API-created plus imported' : 'Manual plus imported',
  ];
  reasons.push(daysApart === 0 ? 'Same date' : `${daysApart}-day date difference`);
  if (similarity >= 0.55) reasons.push('Similar payee');
  if (sameCategory) reasons.push('Same category');
  if (sameRecurring) reasons.push('Same recurring item');

  return {
    id: candidateId(manual, imported),
    confidence,
    reasons,
    daysApart,
    payeeSimilarity: Number(similarity.toFixed(2)),
    manual,
    imported,
    manualFingerprint: transactionFingerprint(manual),
    importedFingerprint: transactionFingerprint(imported),
  };
};

const confidenceRank = { high: 0, medium: 1, low: 2 };

export const detectDuplicateCandidates = ({ transactions, ignoredPairIds = new Set(), includeLow = false }) => {
  const groups = new Map();
  for (const transaction of transactions) {
    if (!transaction || !['manual', 'imported'].includes(transaction.origin)) continue;
    const key = `${transaction.accountKey}|${transaction.apiAmount.toFixed(4)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(transaction);
  }

  const candidates = [];
  for (const group of groups.values()) {
    const manualTransactions = group.filter(transaction => transaction.origin === 'manual');
    const importedTransactions = group.filter(transaction => transaction.origin === 'imported');
    for (const manual of manualTransactions) {
      for (const imported of importedTransactions) {
        const id = candidateId(manual, imported);
        if (ignoredPairIds.has(id)) continue;
        const candidate = scorePair(manual, imported);
        if (candidate && (includeLow || candidate.confidence !== 'low')) candidates.push(candidate);
      }
    }
  }

  return candidates.sort((left, right) => (
    confidenceRank[left.confidence] - confidenceRank[right.confidence]
    || left.imported.date.localeCompare(right.imported.date)
    || left.id.localeCompare(right.id)
  ));
};

const combineNotes = (manualNotes, importedNotes) => {
  if (!manualNotes) return importedNotes;
  if (!importedNotes) return manualNotes;
  if (manualNotes.trim() === importedNotes.trim()) return importedNotes;
  return `${importedNotes.trim()}\n\nManual note: ${manualNotes.trim()}`;
};

export const buildMetadataMerge = (manual, imported, options = {}) => {
  const categoryConflict = manual.categoryId != null
    && imported.categoryId != null
    && manual.categoryId !== imported.categoryId;
  const notesConflict = Boolean(manual.notes && imported.notes && manual.notes.trim() !== imported.notes.trim());
  const recurringConflict = manual.recurringId != null
    && imported.recurringId != null
    && manual.recurringId !== imported.recurringId;

  let categoryId = imported.categoryId;
  if (manual.categoryId != null && (!categoryConflict || options.categoryPreference !== 'imported')) {
    categoryId = manual.categoryId;
  }

  let notes;
  if (notesConflict && options.notesPreference === 'manual') notes = manual.notes;
  else if (notesConflict && options.notesPreference === 'imported') notes = imported.notes;
  else notes = combineNotes(manual.notes, imported.notes);

  let recurringId = imported.recurringId;
  if (imported.recurringId == null && manual.recurringId != null) recurringId = manual.recurringId;
  else if (recurringConflict && options.recurringPreference === 'manual') recurringId = manual.recurringId;

  const tagIds = unique([...imported.tagIds, ...manual.tagIds]).sort((a, b) => a - b);
  return {
    update: {
      payee: manual.payee || imported.payee,
      category_id: categoryId,
      notes,
      tag_ids: tagIds,
      recurring_id: recurringId,
    },
    conflicts: {
      category: categoryConflict,
      notes: notesConflict,
      recurring: recurringConflict,
    },
    summary: [
      manual.payee ? `Use manual payee: ${manual.payee}` : null,
      categoryId != null ? `Use category: ${categoryId === manual.categoryId ? manual.categoryName : imported.categoryName}` : null,
      notes ? (notesConflict ? 'Merge or preserve both transaction notes' : 'Copy available notes') : null,
      tagIds.length ? `Keep ${tagIds.length} unique tag${tagIds.length === 1 ? '' : 's'}` : null,
      recurringId ? `Keep recurring relationship #${recurringId}` : null,
      'Keep imported date, amount, account, and bank identity',
      'Permanently delete the manual transaction',
    ].filter(Boolean),
  };
};

export const validateResolvablePair = (manual, imported) => {
  const candidate = scorePair(manual, imported);
  if (!candidate) {
    const error = new Error('The transactions no longer satisfy the duplicate-review safety checks. Run the scan again.');
    error.status = 409;
    throw error;
  }
  return candidate;
};
