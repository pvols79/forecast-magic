import axios from 'axios';
import { config } from '../config.js';
import { SettingsRepository } from '../repositories/settingsRepository.js';

const unwrapList = (data, key) => {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.[key])) return data[key];
  if (Array.isArray(data?.data)) return data.data;
  return [];
};

const toNumber = value => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const accountKey = (source, id) => `${source}:${id}`;

export class LunchMoneyService {
  constructor(settingsRepository = new SettingsRepository()) {
    this.settingsRepository = settingsRepository;
  }

  getApiKey() {
    return config.lunchMoneyApiKey || this.settingsRepository.get('lunch_money_api_key');
  }

  hasEnvironmentApiKey() {
    return Boolean(config.lunchMoneyApiKey);
  }

  setApiKey(apiKey) {
    if (this.hasEnvironmentApiKey()) throw new Error('The Lunch Money API key is configured by the server environment.');
    this.settingsRepository.set('lunch_money_api_key', apiKey);
  }

  clearApiKey() {
    if (this.hasEnvironmentApiKey()) throw new Error('The Lunch Money API key is configured by the server environment.');
    this.settingsRepository.delete('lunch_money_api_key');
  }

  async get(path, params = {}) {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      const error = new Error('Lunch Money API key is not configured.');
      error.status = 401;
      throw error;
    }
    const response = await axios.get(`${config.lunchMoneyBaseUrl}${path}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      params,
    });
    return response.data;
  }

  normalizeAccount(account, source) {
    return {
      id: account.id,
      source,
      key: accountKey(source, account.id),
      name: account.display_name || account.name,
      display_name: account.display_name || account.name,
      institution: account.institution_name,
      balance: toNumber(account.balance),
    };
  }

  normalizeTransaction(transaction, anchorDate) {
    const source = transaction.manual_account_id != null ? 'manual' : 'plaid';
    const id = transaction.manual_account_id ?? transaction.plaid_account_id;
    if (id == null) return null;
    return {
      id: `transaction:${transaction.id}`,
      accountId: id,
      accountSource: source,
      accountKey: accountKey(source, id),
      date: transaction.date,
      description: transaction.payee || transaction.notes || 'Transaction',
      amount: -toNumber(transaction.to_base ?? transaction.amount),
      type: transaction.is_pending ? 'pending' : (transaction.date > anchorDate ? 'future' : 'actual'),
      transactionId: transaction.id,
      recurringId: transaction.recurring_id,
      lunchMoneySource: transaction.source,
      categoryId: transaction.category_id,
      isPending: Boolean(transaction.is_pending),
      is_pending: Boolean(transaction.is_pending),
    };
  }

  normalizeRecurringItem(item) {
    const criteria = item.transaction_criteria || item;
    const matches = item.matches || item;
    const overrides = item.overrides || {};
    const source = criteria.manual_account_id != null || criteria.asset_id != null ? 'manual' : 'plaid';
    const id = criteria.manual_account_id ?? criteria.asset_id ?? criteria.plaid_account_id;
    if (id == null) return [];
    return (matches.missing_transaction_dates || matches.missing_dates_within_range || []).map(date => ({
      id: `recurring:${item.id}:${date}`,
      accountId: id,
      accountSource: source,
      accountKey: accountKey(source, id),
      date,
      description: overrides.payee || criteria.payee || item.description || 'Recurring Transaction',
      amount: -toNumber(criteria.to_base ?? criteria.amount),
      type: 'recurring-projected',
      recurringId: item.id,
      categoryId: overrides.category_id ?? criteria.category_id ?? null,
    }));
  }

  normalizeRecurringOccurrences(item) {
    const criteria = item.transaction_criteria || item;
    const matches = item.matches || item;
    const overrides = item.overrides || {};
    const source = criteria.manual_account_id != null || criteria.asset_id != null ? 'manual' : 'plaid';
    const id = criteria.manual_account_id ?? criteria.asset_id ?? criteria.plaid_account_id;
    if (id == null) return [];
    const missingDates = new Set(matches.missing_transaction_dates || matches.missing_dates_within_range || []);
    const foundByDate = new Map((matches.found_transactions || matches.transactions_within_range || []).map(match => [
      match.date,
      match.transaction_id ?? match.id ?? null,
    ]));
    const expectedDates = (matches.expected_occurrence_dates || matches.occurrences || [])
      .map(occurrence => typeof occurrence === 'string' ? occurrence : occurrence.date)
      .filter(Boolean);
    const occurrenceDates = [...new Set([...expectedDates, ...missingDates, ...foundByDate.keys()])].sort();
    const amount = -toNumber(criteria.to_base ?? criteria.amount);
    return occurrenceDates.map(date => ({
      id: `recurring-occurrence:${item.id}:${date}`,
      accountId: id,
      accountSource: source,
      accountKey: accountKey(source, id),
      date,
      description: overrides.payee || criteria.payee || item.description || 'Recurring Transaction',
      amount,
      type: 'recurring-occurrence',
      recurringId: item.id,
      transactionId: foundByDate.get(date) ?? undefined,
      status: missingDates.has(date) ? 'missing' : foundByDate.has(date) ? 'matched' : 'expected',
      categoryId: overrides.category_id ?? criteria.category_id ?? null,
    }));
  }

  async getManualAccounts() {
    const data = await this.get('/manual_accounts');
    return unwrapList(data, 'manual_accounts').map(account => this.normalizeAccount(account, 'manual'));
  }

  async getPlaidAccounts() {
    const data = await this.get('/plaid_accounts');
    return unwrapList(data, 'plaid_accounts').map(account => this.normalizeAccount(account, 'plaid'));
  }

  async getCategories() {
    const data = await this.get('/categories', { format: 'flattened', is_group: false });
    return unwrapList(data, 'categories')
      .filter(category => !category.is_group)
      .map(category => ({
        id: Number(category.id),
        name: category.name,
        groupName: category.group_name || null,
        isIncome: Boolean(category.is_income),
        excludeFromBudget: Boolean(category.exclude_from_budget),
        excludeFromTotals: Boolean(category.exclude_from_totals),
        archived: Boolean(category.archived_at || category.archived),
      }));
  }

  async getTransactions(startDate, endDate, anchorDate = startDate) {
    const data = await this.get('/transactions', {
      start_date: startDate,
      end_date: endDate,
      include_pending: true,
    });
    // Default v2 behavior omits split parents and grouped children, preventing double-counting.
    return unwrapList(data, 'transactions')
      .map(transaction => this.normalizeTransaction(transaction, anchorDate))
      .filter(Boolean);
  }

  async getRecurringData(startDate, endDate) {
    const params = { start_date: startDate, end_date: endDate };
    let items;
    try {
      const data = await this.get('/recurring', params);
      items = unwrapList(data, 'recurring');
    } catch (error) {
      if (error.response?.status !== 404) throw error;
      const data = await this.get('/recurring_items', params);
      items = unwrapList(data, 'recurring_items');
    }
    return {
      events: items.flatMap(item => this.normalizeRecurringItem(item)),
      occurrences: items.flatMap(item => this.normalizeRecurringOccurrences(item)),
    };
  }

  async getRecurring(startDate, endDate) {
    return (await this.getRecurringData(startDate, endDate)).events;
  }
}
