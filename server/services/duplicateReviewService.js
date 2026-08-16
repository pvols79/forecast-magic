import { addDays, getDateInTimezone } from '../domain/periods.js';
import {
  buildMetadataMerge, detectDuplicateCandidates, normalizeReviewTransaction,
  transactionFingerprint, validateResolvablePair,
} from '../domain/duplicateReview.js';
import { DuplicateReviewRepository } from '../repositories/duplicateReviewRepository.js';
import { SettingsRepository } from '../repositories/settingsRepository.js';
import { LunchMoneyService } from './lunchMoneyService.js';

const conflictError = message => {
  const error = new Error(message);
  error.status = 409;
  return error;
};

const allowedPreference = (value, allowed, fallback) => allowed.includes(value) ? value : fallback;

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

  async scan(accountKey, { includeLow = false, anchorDate = this.today() } = {}) {
    if (!accountKey) throw new Error('An account is required for Duplicate Review.');
    const startDate = addDays(anchorDate, -29);
    const [rawTransactions, categories] = await Promise.all([
      this.lunchMoney.getRawTransactions(startDate, anchorDate),
      this.lunchMoney.getCategories(),
    ]);
    const categoryNames = new Map(categories.map(category => [Number(category.id), category.name]));
    const transactions = rawTransactions
      .map(transaction => normalizeReviewTransaction(transaction, categoryNames))
      .filter(transaction => transaction?.accountKey === accountKey);
    const ignoredPairIds = this.repository.listIgnoredPairIds(accountKey);
    const candidates = detectDuplicateCandidates({ transactions, ignoredPairIds, includeLow })
      .map(candidate => ({ ...candidate, mergePreview: buildMetadataMerge(candidate.manual, candidate.imported) }));
    return { accountKey, startDate, endDate: anchorDate, includeLow, candidates };
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

  async resolve(input) {
    const { accountKey, manualTransactionId, importedTransactionId } = input;
    if (!accountKey || !manualTransactionId || !importedTransactionId) {
      throw new Error('Account and both transaction IDs are required.');
    }

    const [manualRaw, importedRaw, categories] = await Promise.all([
      this.lunchMoney.getTransaction(manualTransactionId),
      this.lunchMoney.getTransaction(importedTransactionId),
      this.lunchMoney.getCategories(),
    ]);
    if (!manualRaw || !importedRaw) throw conflictError('One of the transactions no longer exists. Run the scan again.');

    const categoryNames = new Map(categories.map(category => [Number(category.id), category.name]));
    const manual = normalizeReviewTransaction(manualRaw, categoryNames);
    const imported = normalizeReviewTransaction(importedRaw, categoryNames);
    if (!manual || !imported || manual.accountKey !== accountKey || imported.accountKey !== accountKey) {
      throw conflictError('A transaction account changed. Run the scan again.');
    }
    if (input.manualFingerprint !== transactionFingerprint(manual)
      || input.importedFingerprint !== transactionFingerprint(imported)) {
      throw conflictError('A transaction changed since this scan. Run Check for Duplicates again before resolving it.');
    }
    validateResolvablePair(manual, imported);

    const merge = buildMetadataMerge(manual, imported, {
      categoryPreference: allowedPreference(input.categoryPreference, ['manual', 'imported'], 'manual'),
      notesPreference: allowedPreference(input.notesPreference, ['combine', 'manual', 'imported'], 'combine'),
      recurringPreference: allowedPreference(input.recurringPreference, ['manual', 'imported'], 'imported'),
    });

    const updatedRaw = await this.lunchMoney.updateTransaction(imported.id, merge.update);
    const updated = normalizeReviewTransaction(updatedRaw, categoryNames);
    if (!updated || updated.id !== imported.id || updated.origin !== 'imported') {
      throw conflictError('Lunch Money did not confirm the imported transaction update. The manual transaction was not deleted.');
    }

    await this.lunchMoney.deleteTransaction(manual.id);
    return {
      keptTransactionId: imported.id,
      deletedTransactionId: manual.id,
      mergedMetadata: merge.update,
    };
  }
}
