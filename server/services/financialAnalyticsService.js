import { applyOperationalFunds } from '../../src/availableToSpend.js';
import { projectCashFlow } from '../../src/projection.js';
import {
  householdFundCards, summarizeCashPosition, summarizeRecurringAttention,
  summarizeSpendingTrends, summarizeUnallocatedSpending,
} from '../domain/financialAnalytics.js';
import { addDays } from '../domain/periods.js';
import { OperationalFundRepository } from '../repositories/operationalFundRepository.js';
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

export class FinancialAnalyticsService {
  constructor({ lunchMoney, fundRepository, fundService } = {}) {
    this.lunchMoney = lunchMoney || new LunchMoneyService();
    this.fundRepository = fundRepository || new OperationalFundRepository();
    this.fundService = fundService || new OperationalFundService(this.fundRepository, this.lunchMoney);
  }

  async getOverview(accountKey, anchorDate) {
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
      funds: householdFundCards(currentFunds),
    };
  }

  async getDailyHighlight(accountKey, anchorDate) {
    return {
      schemaVersion: '1.0',
      reportDate: anchorDate,
      ...await this.getOverview(accountKey, anchorDate),
    };
  }
}
