import { applyOperationalFunds } from '../../src/availableToSpend.js';
import { projectCashFlow } from '../../src/projection.js';
import {
  fundCards, summarizeCashPosition, summarizeRecurringAttention,
  summarizeSpendingTrends, summarizeUnallocatedSpending,
} from '../domain/financialAnalytics.js';
import { addDays } from '../domain/periods.js';
import { OperationalFundRepository } from '../repositories/operationalFundRepository.js';
import { DuplicateReviewService } from './duplicateReviewService.js';
import { LunchMoneyService } from './lunchMoneyService.js';
import { OperationalFundService } from './operationalFundService.js';

const addMonths = (dateString, months) => {
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
};

const recurringLookback = dateString => {
  const [year, month] = dateString.split('-').map(Number);
  return new Date(Date.UTC(year, month - 4, 1)).toISOString().slice(0, 10);
};

const normalizeView = view => view === 'household' ? 'household' : 'admin';

export class FinancialAnalyticsService {
  constructor({ lunchMoney, fundRepository, fundService, duplicateReviewService } = {}) {
    this.lunchMoney = lunchMoney || new LunchMoneyService();
    this.fundRepository = fundRepository || new OperationalFundRepository();
    this.fundService = fundService || new OperationalFundService(this.fundRepository, this.lunchMoney);
    this.duplicateReviewService = duplicateReviewService || new DuplicateReviewService(this.lunchMoney);
  }

  async getOverview(accountKey, anchorDate, { view = 'household' } = {}) {
    if (!accountKey) {
      const error = new Error('Account key is required.');
      error.status = 400;
      throw error;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(anchorDate || '')) {
      const error = new Error('Anchor date must use YYYY-MM-DD.');
      error.status = 400;
      throw error;
    }

    const projectionEndDate = addMonths(anchorDate, 6);
    const transactionStartDate = recurringLookback(anchorDate) < addDays(anchorDate, -59)
      ? recurringLookback(anchorDate)
      : addDays(anchorDate, -59);
    const [manualAccounts, plaidAccounts, categories, transactions, recurringData, fundProjection] = await Promise.all([
      this.lunchMoney.getManualAccounts(),
      this.lunchMoney.getPlaidAccounts(),
      this.lunchMoney.getCategories(),
      this.lunchMoney.getTransactions(transactionStartDate, projectionEndDate, anchorDate),
      this.lunchMoney.getRecurringData(recurringLookback(anchorDate), projectionEndDate),
      this.fundService.getProjection(accountKey, anchorDate, projectionEndDate),
    ]);
    const recurringEvents = recurringData.events;
    const accounts = [...manualAccounts, ...plaidAccounts];
    const account = accounts.find(candidate => candidate.key === accountKey);
    if (!account) {
      const error = new Error('Selected account was not found.');
      error.status = 404;
      throw error;
    }

    const ledgerProjection = projectCashFlow(
      accounts,
      [...transactions, ...recurringEvents],
      accountKey,
      6,
      { anchorDate }
    );
    const projection = applyOperationalFunds(ledgerProjection, fundProjection);
    const currentFunds = fundProjection.currentFunds || [];

    return {
      generatedAt: new Date().toISOString(),
      account: {
        key: account.key,
        id: account.id,
        source: account.source,
        name: account.name,
      },
      cashPosition: summarizeCashPosition(projection, anchorDate),
      needsAttention: summarizeRecurringAttention(recurringEvents, recurringData.occurrences, accountKey, anchorDate),
      spendingTrends: summarizeSpendingTrends(transactions, categories, accountKey, anchorDate),
      unallocatedSpending: summarizeUnallocatedSpending(
        transactions,
        categories,
        currentFunds,
        accountKey,
        anchorDate
      ),
      funds: fundCards(currentFunds, normalizeView(view)),
    };
  }

  async buildDailyHighlightReport(accountKey, anchorDate, context = {}) {
    const view = normalizeView(context.view);
    const overviewPromise = this.getOverview(accountKey, anchorDate, { view });
    const [overview, duplicateReview] = view === 'admin'
      ? await Promise.all([
        overviewPromise,
        this.duplicateReviewService.getReportingSummary(accountKey, anchorDate),
      ])
      : [await overviewPromise, null];
    const projectionHorizonDays = Math.max(0, overview.cashPosition.projectionSeries.length - 1);
    const report = {
      schemaVersion: '1.2',
      reportDate: anchorDate,
      reportContext: {
        view,
        timezone: context.timezone || 'UTC',
        currency: context.currency || 'USD',
        projectionHorizonDays,
      },
      ...overview,
    };
    if (view === 'admin') report.duplicateReview = duplicateReview;
    return report;
  }

  async getDailyHighlight(accountKey, anchorDate, context = {}) {
    return this.buildDailyHighlightReport(accountKey, anchorDate, context);
  }
}
