import crypto from 'node:crypto';

const DAY_MS = 24 * 60 * 60 * 1000;
const IMPORTED_SOURCE = 'plaid';
const N8N_NOTE_PATTERN = /created from .* by n8n/i;
const N8N_EXTERNAL_ID_PATTERN = /^n8n-/i;
const N8N_PLACEHOLDER_TAG_NAMES = new Set([
  'n8nproc',
  'n8npending',
]);
const MANUAL_PLACEHOLDER_TAG_NAMES = new Set([
  'lmmanual',
]);
const LEGACY_PLACEHOLDER_TAG_NAMES = new Set([
  'forecastmagicpending',
]);
const AUTOMATION_TAG_NAMES = new Set([
  ...N8N_PLACEHOLDER_TAG_NAMES,
  'n8nprocessed',
  'n8ncreated',
]);
const PIPELINE_TAG_NAMES = new Set([
  ...N8N_PLACEHOLDER_TAG_NAMES,
  ...MANUAL_PLACEHOLDER_TAG_NAMES,
  ...LEGACY_PLACEHOLDER_TAG_NAMES,
  'n8nprocessed',
  'n8ncreated',
]);
const MATCHED_IMPORT_TAG_NAME = 'matchedimport';
const MEDIUM_MAX_DATE_DIFFERENCE_DAYS = 3;
const LOW_MAX_DATE_DIFFERENCE_DAYS = 5;

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

const normalizeTagName = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const isAutomationTagName = value => AUTOMATION_TAG_NAMES.has(normalizeTagName(value));
const isPipelineTagName = value => PIPELINE_TAG_NAMES.has(normalizeTagName(value));
const isMatchedImportTagName = value => normalizeTagName(value) === MATCHED_IMPORT_TAG_NAME;
const tagNameFor = (tag, tagNamesById = new Map()) => {
  if (typeof tag === 'string') return tag;
  if (tag?.name) return tag.name;
  const id = Number(tag?.id ?? tag);
  return Number.isFinite(id) ? tagNamesById.get(id) || '' : '';
};

const hasNamedTag = (transaction, predicate) => (
  (transaction.tagNames || []).some(predicate)
  || (transaction.tagIds || []).some(tagId => predicate(transaction.tagNamesByTransactionTagId?.[tagId]))
);

const isAutomationCreated = (transaction, tagNamesById = new Map()) => {
  const notes = String(transaction.notes || '');
  const externalId = transaction.external_id == null ? '' : String(transaction.external_id);
  const tagNames = transaction.tag_names || transaction.tags || [];
  return N8N_NOTE_PATTERN.test(notes)
    || N8N_EXTERNAL_ID_PATTERN.test(externalId)
    || tagNames.some(tag => isAutomationTagName(tagNameFor(tag, tagNamesById)))
    || (transaction.tag_ids || []).some(tagId => isAutomationTagName(tagNamesById.get(Number(tagId))));
};

const classifyTransactionRole = (transaction, source, automationCreated) => {
  const hasN8nPlaceholderTag = hasNamedTag(transaction, value => (
    N8N_PLACEHOLDER_TAG_NAMES.has(normalizeTagName(value))
    || LEGACY_PLACEHOLDER_TAG_NAMES.has(normalizeTagName(value))
  ));
  const hasManualPlaceholderTag = hasNamedTag(transaction, value => (
    MANUAL_PLACEHOLDER_TAG_NAMES.has(normalizeTagName(value))
    || LEGACY_PLACEHOLDER_TAG_NAMES.has(normalizeTagName(value))
  ));
  const hasMatchedImportTag = hasNamedTag(transaction, isMatchedImportTagName);

  if (source === IMPORTED_SOURCE) return hasMatchedImportTag ? 'matchedImport' : 'imported';
  if (source === 'api' && (automationCreated || hasN8nPlaceholderTag)) return 'placeholder';
  if (source === 'manual' && hasManualPlaceholderTag) return 'placeholder';
  return 'ordinary';
};

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

export const normalizeReviewTransaction = (
  transaction,
  categoryNames = new Map(),
  tagNamesById = new Map()
) => {
  const source = String(transaction.source || '').toLocaleLowerCase('en-US');
  const accountKey = getTransactionAccountKey(transaction);
  const apiAmount = asNumber(transaction.to_base ?? transaction.amount);
  if (!transaction.id || !accountKey || apiAmount == null || !transaction.date) return null;
  const tagIds = unique((transaction.tag_ids || []).map(Number));
  const tagNamesByTransactionTagId = Object.fromEntries(tagIds.map(tagId => [tagId, tagNamesById.get(tagId) || '']));
  const tagNames = unique([
    ...(transaction.tag_names || []),
    ...((transaction.tags || []).map(tag => tagNameFor(tag, tagNamesById))),
    ...tagIds.map(tagId => tagNamesById.get(tagId)),
  ].filter(Boolean));
  const automationCreated = isAutomationCreated(transaction, tagNamesById);
  const role = classifyTransactionRole({
    tagIds,
    tagNames,
    tagNamesByTransactionTagId,
  }, source, automationCreated);
  const origin = role === 'placeholder'
    ? 'manual'
    : role === 'imported'
      ? 'imported'
      : role;

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
    externalId: transaction.external_id == null ? null : asId(transaction.external_id),
    tagIds,
    tagNames,
    tagNamesByTransactionTagId,
    recurringId: transaction.recurring_id == null ? null : asId(transaction.recurring_id),
    recurringName: transaction.recurring_id == null ? null : `Recurring #${transaction.recurring_id}`,
    source,
    origin,
    role,
    isMatchedImport: role === 'matchedImport',
    isPending: Boolean(transaction.is_pending),
    updatedAt: transaction.updated_at || null,
    automationCreated,
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
  if (manual.role !== 'placeholder' || imported.role !== 'imported') return null;
  if (manual.accountKey !== imported.accountKey) return null;
  if (manual.apiAmount !== imported.apiAmount) return null;

  const daysApart = dateDifference(manual.date, imported.date);
  const similarity = payeeSimilarity(manual.payee, imported.payee);
  const sameCategory = manual.categoryId != null && manual.categoryId === imported.categoryId;
  const sameRecurring = manual.recurringId != null && manual.recurringId === imported.recurringId;
  if (daysApart > LOW_MAX_DATE_DIFFERENCE_DAYS) return null;

  let confidence;
  if (daysApart <= 1 && similarity >= 0.72) confidence = 'high';
  else if (daysApart <= MEDIUM_MAX_DATE_DIFFERENCE_DAYS && (similarity >= 0.35 || sameCategory || sameRecurring)) confidence = 'medium';
  else confidence = 'low';

  const sourceReason = manual.source === 'api'
    ? 'API-created plus imported'
    : 'Manual placeholder plus imported';
  const reasons = ['Exact amount', sourceReason];
  reasons.push(daysApart === 0 ? 'Same date' : `${daysApart}-day date difference`);
  if (similarity >= 0.55) reasons.push('Similar payee');
  if (manual.automationCreated) reasons.push('n8n-created placeholder');
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

const pairPriority = candidate => {
  const sameCategory = candidate.manual.categoryId != null
    && candidate.manual.categoryId === candidate.imported.categoryId;
  const sameRecurring = candidate.manual.recurringId != null
    && candidate.manual.recurringId === candidate.imported.recurringId;
  return (candidate.payeeSimilarity * 100)
    + (sameRecurring ? 20 : 0)
    + (sameCategory ? 10 : 0)
    - (candidate.daysApart * 5);
};

const compareCandidates = (left, right) => (
  confidenceRank[left.confidence] - confidenceRank[right.confidence]
  || pairPriority(right) - pairPriority(left)
  || left.daysApart - right.daysApart
  || right.payeeSimilarity - left.payeeSimilarity
  || left.imported.date.localeCompare(right.imported.date)
  || left.id.localeCompare(right.id)
);

export const detectDuplicateCandidates = ({ transactions, ignoredPairIds = new Set() }) => {
  const groups = new Map();
  for (const transaction of transactions) {
    if (!transaction || !['placeholder', 'imported'].includes(transaction.role)) continue;
    const key = `${transaction.accountKey}|${transaction.apiAmount.toFixed(4)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(transaction);
  }

  const candidates = [];
  for (const group of groups.values()) {
    const manualTransactions = group.filter(transaction => transaction.role === 'placeholder');
    const importedTransactions = group.filter(transaction => transaction.role === 'imported');
    for (const manual of manualTransactions) {
      for (const imported of importedTransactions) {
        const id = candidateId(manual, imported);
        if (ignoredPairIds.has(id)) continue;
        const candidate = scorePair(manual, imported);
        if (candidate) candidates.push(candidate);
      }
    }
  }

  const selected = [];
  const selectedManualIds = new Set();
  const selectedImportedIds = new Set();
  for (const candidate of candidates.sort(compareCandidates)) {
    if (selectedManualIds.has(candidate.manual.id) || selectedImportedIds.has(candidate.imported.id)) continue;
    selected.push(candidate);
    selectedManualIds.add(candidate.manual.id);
    selectedImportedIds.add(candidate.imported.id);
  }
  return selected.sort((left, right) => (
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
  const payeeConflict = Boolean(manual.payee && imported.payee && manual.payee.trim() !== imported.payee.trim());
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
  else if (options.notesPreference === 'specified') notes = options.specifiedNotes || '';
  else notes = combineNotes(manual.notes, imported.notes);

  let recurringId = imported.recurringId;
  if (imported.recurringId == null && manual.recurringId != null) recurringId = manual.recurringId;
  else if (recurringConflict && options.recurringPreference === 'manual') recurringId = manual.recurringId;

  let payee = manual.payee || imported.payee;
  if (options.payeePreference === 'imported') payee = imported.payee || manual.payee;
  else if (options.payeePreference === 'specified' && options.specifiedPayee?.trim()) {
    payee = options.specifiedPayee.trim();
  }

  const tagIds = unique([
    ...imported.tagIds.filter(tagId => !isPipelineTagName(imported.tagNamesByTransactionTagId?.[tagId])),
    options.matchedImportTagId == null ? null : Number(options.matchedImportTagId),
  ])
    .sort((a, b) => a - b);
  return {
    update: {
      payee,
      category_id: categoryId,
      notes,
      tag_ids: tagIds,
      recurring_id: recurringId,
    },
    conflicts: {
      payee: payeeConflict,
      category: categoryConflict,
      notes: notesConflict,
      recurring: recurringConflict,
    },
    summary: [
      payee ? `Use payee: ${payee}` : null,
      categoryId != null ? `Use category: ${categoryId === manual.categoryId ? manual.categoryName : imported.categoryName}` : null,
      notes ? (notesConflict ? 'Merge or preserve both transaction notes' : 'Copy available notes') : null,
      tagIds.length ? `Keep ${tagIds.length} imported tag${tagIds.length === 1 ? '' : 's'}` : 'Remove n8n/manual review tags from kept import',
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
