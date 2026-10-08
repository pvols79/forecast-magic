import { addDays, getDateInTimezone } from '../domain/periods.js';
import {
  buildMetadataMerge, detectDuplicateCandidates, normalizeReviewTransaction,
  payeeSimilarity, transactionFingerprint, validateResolvablePair,
} from '../domain/duplicateReview.js';
import { DuplicateReviewRepository } from '../repositories/duplicateReviewRepository.js';
import { SettingsRepository } from '../repositories/settingsRepository.js';
import { LunchMoneyService } from './lunchMoneyService.js';

const MATCHED_IMPORT_TAG_NAME = 'matched_import';

const conflictError = message => {
  const error = new Error(message);
  error.status = 409;
  return error;
};

const allowedPreference = (value, allowed, fallback) => allowed.includes(value) ? value : fallback;
const specifiedPayee = value => {
  const payee = typeof value === 'string' ? value.trim() : '';
  if (payee.length > 200) throw conflictError('Specified payee must be 200 characters or less.');
  return payee;
};
const specifiedNotes = value => {
  const notes = typeof value === 'string' ? value.trim() : '';
  if (notes.length > 2000) throw conflictError('Specified notes must be 2000 characters or less.');
  return notes;
};
const dateDistanceDays = (left, right) => {
  const a = new Date(`${left}T00:00:00Z`);
  const b = new Date(`${right}T00:00:00Z`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return Number.POSITIVE_INFINITY;
  return Math.round(Math.abs(a.getTime() - b.getTime()) / 86400000);
};
const amountCents = value => Math.round(Number(value) * 100);
const normalizeTagName = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

const findTagByName = (tags, name) => tags.find(tag => normalizeTagName(tag.name) === normalizeTagName(name));

export class DuplicateReviewService {
  constructor(
    lunchMoney = new LunchMoneyService(),
    repository = new DuplicateReviewRepository(),
    settings = new SettingsRepository()
  ) {
    this.lunchMoney = lunchMoney;
    this.repository = repository;
    this.settings = settings;
  }

  today() {
    return getDateInTimezone(new Date(), this.settings.get('timezone') || 'UTC');
  }

  async scan(accountKey, { anchorDate = this.today() } = {}) {
    if (!accountKey) throw new Error('An account is required for Duplicate Review.');
    const startDate = addDays(anchorDate, -29);
    const [rawTransactions, categories, tags] = await Promise.all([
      this.lunchMoney.getRawTransactions(startDate, anchorDate, { includeMetadata: true }),
      this.lunchMoney.getCategories(),
      this.lunchMoney.getTags(),
    ]);
    const categoryNames = new Map(categories.map(category => [Number(category.id), category.name]));
    const tagNamesById = new Map(tags.map(tag => [Number(tag.id), tag.name]));
    const transactions = rawTransactions
      .map(transaction => normalizeReviewTransaction(transaction, categoryNames, tagNamesById))
      .filter(transaction => transaction?.accountKey === accountKey);
    const ignoredPairIds = this.repository.listIgnoredPairIds(accountKey);
    const candidates = detectDuplicateCandidates({ transactions, ignoredPairIds })
      .map(candidate => ({ ...candidate, mergePreview: buildMetadataMerge(candidate.manual, candidate.imported) }));
    return { accountKey, startDate, endDate: anchorDate, includeLow: true, candidates };
  }

  async getReportingSummary(accountKey, anchorDate = this.today()) {
    const scan = await this.scan(accountKey, { includeLow: true, anchorDate });
    const confidenceCounts = {
      high: scan.candidates.filter(candidate => candidate.confidence === 'high').length,
      medium: scan.candidates.filter(candidate => candidate.confidence === 'medium').length,
      low: scan.candidates.filter(candidate => candidate.confidence === 'low').length,
    };
    const candidates = scan.candidates
      .filter(candidate => candidate.confidence !== 'low')
      .map(candidate => ({
        id: candidate.id,
        confidence: candidate.confidence,
        reasons: candidate.reasons,
        manual: {
          transactionId: candidate.manual.id,
          date: candidate.manual.date,
          payee: candidate.manual.payee,
          amountCents: Math.round(candidate.manual.amount * 100),
          category: candidate.manual.categoryName,
          source: candidate.manual.source,
        },
        imported: {
          transactionId: candidate.imported.id,
          date: candidate.imported.date,
          payee: candidate.imported.payee,
          amountCents: Math.round(candidate.imported.amount * 100),
          category: candidate.imported.categoryName,
          source: candidate.imported.source,
        },
      }));
    return {
      window: { startDate: scan.startDate, endDate: scan.endDate },
      needsReview: candidates.length,
      confidenceCounts,
      candidates,
    };
  }

  ignore({ accountKey, manualTransactionId, importedTransactionId }) {
    return this.repository.ignore({ accountKey, manualTransactionId, importedTransactionId });
  }

  async ensureTag(tags, name) {
    const existing = findTagByName(tags, name);
    if (existing) return existing;
    if (typeof this.lunchMoney.createTag !== 'function') {
      throw conflictError(`Lunch Money tag "${name}" does not exist and cannot be created by this service.`);
    }
    const created = await this.lunchMoney.createTag({ name });
    tags.push(created);
    return created;
  }

  async resolve(input) {
    const { accountKey, manualTransactionId, importedTransactionId } = input;
    if (!accountKey || !manualTransactionId || !importedTransactionId) {
      throw new Error('Account and both transaction IDs are required.');
    }

    const [manualRaw, importedRaw, categories, tags] = await Promise.all([
      this.lunchMoney.getTransaction(manualTransactionId),
      this.lunchMoney.getTransaction(importedTransactionId),
      this.lunchMoney.getCategories(),
      this.lunchMoney.getTags(),
    ]);
    if (!manualRaw || !importedRaw) throw conflictError('One of the transactions no longer exists. Run the scan again.');

    const matchedImportTag = await this.ensureTag(tags, MATCHED_IMPORT_TAG_NAME);
    const categoryNames = new Map(categories.map(category => [Number(category.id), category.name]));
    const tagNamesById = new Map(tags.map(tag => [Number(tag.id), tag.name]));
    const manual = normalizeReviewTransaction(manualRaw, categoryNames, tagNamesById);
    const imported = normalizeReviewTransaction(importedRaw, categoryNames, tagNamesById);
    if (!manual || !imported || manual.accountKey !== accountKey || imported.accountKey !== accountKey) {
      throw conflictError('A transaction account changed. Run the scan again.');
    }
    if (input.manualFingerprint !== transactionFingerprint(manual)
      || input.importedFingerprint !== transactionFingerprint(imported)) {
      throw conflictError('A transaction changed since this scan. Run Check for Duplicates again before resolving it.');
    }
    validateResolvablePair(manual, imported);

    const merge = buildMetadataMerge(manual, imported, {
      payeePreference: allowedPreference(input.payeePreference, ['manual', 'imported', 'specified'], 'manual'),
      specifiedPayee: specifiedPayee(input.specifiedPayee),
      categoryPreference: allowedPreference(input.categoryPreference, ['manual', 'imported'], 'manual'),
      notesPreference: allowedPreference(input.notesPreference, ['combine', 'manual', 'imported', 'specified'], 'combine'),
      specifiedNotes: specifiedNotes(input.specifiedNotes),
      recurringPreference: allowedPreference(input.recurringPreference, ['manual', 'imported'], 'imported'),
      matchedImportTagId: matchedImportTag.id,
    });

    await this.lunchMoney.updateTransaction(imported.id, merge.update);
    let updated = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt > 0) await sleep(500);
      const updatedRaw = await this.lunchMoney.getTransaction(imported.id);
      updated = normalizeReviewTransaction(updatedRaw, categoryNames, tagNamesById);
      if (updated?.id === imported.id && updated.role === 'matchedImport') break;
    }
    if (!updated || updated.id !== imported.id || updated.role !== 'matchedImport') {
      throw conflictError('Lunch Money did not confirm the imported transaction update with matched_import. The placeholder was not deleted.');
    }

    await this.lunchMoney.deleteTransaction(manual.id);
    return {
      keptTransactionId: imported.id,
      deletedTransactionId: manual.id,
      mergedMetadata: merge.update,
    };
  }

  async preflight(input = {}) {
    const { accountKey, date, amount, payee = '', externalId = '', notes = '' } = input;
    if (!accountKey || !date || amount == null) {
      throw new Error('Account, date, and amount are required for duplicate preflight.');
    }
    const amountInCents = amountCents(amount);
    if (!Number.isFinite(amountInCents)) throw new Error('Amount must be numeric.');
    const startDate = addDays(date, -5);
    const endDate = addDays(date, 5);
    const [rawTransactions, categories, tags] = await Promise.all([
      this.lunchMoney.getRawTransactions(startDate, endDate, { includeMetadata: true }),
      this.lunchMoney.getCategories(),
      this.lunchMoney.getTags(),
    ]);
    const categoryNames = new Map(categories.map(category => [Number(category.id), category.name]));
    const tagNamesById = new Map(tags.map(tag => [Number(tag.id), tag.name]));
    const probe = normalizeReviewTransaction({
      id: 'preflight',
      date,
      amount: String(amountInCents / 100),
      to_base: String(amountInCents / 100),
      payee,
      notes,
      external_id: externalId || 'n8n-preflight',
      source: 'api',
      ...(accountKey.startsWith('plaid:')
        ? { plaid_account_id: accountKey.split(':')[1] }
        : { manual_account_id: accountKey.split(':')[1] }),
    }, categoryNames, tagNamesById);
    const transactions = rawTransactions
      .map(transaction => normalizeReviewTransaction(transaction, categoryNames, tagNamesById))
      .filter(transaction => transaction?.accountKey === accountKey);
    const existingExternalId = externalId
      ? transactions.find(transaction => transaction.id !== 'preflight'
        && String(transaction.externalId || '') === String(externalId))
      : null;
    const amountMatches = transactions
      .filter(transaction => transaction.apiAmount === probe.apiAmount && dateDistanceDays(transaction.date, date) <= 5)
      .map(transaction => ({
        transactionId: transaction.id,
        date: transaction.date,
        payee: transaction.payee,
        amount: transaction.amount,
        source: transaction.source,
        origin: transaction.origin,
        role: transaction.role,
        daysApart: dateDistanceDays(transaction.date, date),
        payeeSimilarity: Number(payeeSimilarity(payee, transaction.payee).toFixed(2)),
        reason: transaction.role === 'imported' || transaction.role === 'matchedImport'
          ? 'existing_import'
          : transaction.role === 'placeholder' && transaction.source === 'manual'
            ? 'existing_manual_placeholder'
            : transaction.role === 'placeholder'
              ? 'existing_placeholder'
              : 'existing_amount_date_match',
        notes: transaction.notes,
        tagNames: transaction.tagNames,
      }))
      .sort((left, right) => (
        left.daysApart - right.daysApart
        || right.payeeSimilarity - left.payeeSimilarity
        || String(left.transactionId).localeCompare(String(right.transactionId))
      ));
    return {
      shouldCreate: !existingExternalId && amountMatches.length === 0,
      duplicateRisk: Boolean(existingExternalId || amountMatches.length > 0),
      reason: existingExternalId ? 'exact_external_id' : amountMatches[0]?.reason || null,
      exactExternalIdMatch: existingExternalId ? {
        transactionId: existingExternalId.id,
        date: existingExternalId.date,
        payee: existingExternalId.payee,
        source: existingExternalId.source,
      } : null,
      amountDateMatches: amountMatches,
      window: { startDate, endDate },
    };
  }
}
