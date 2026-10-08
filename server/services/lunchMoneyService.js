import axios from 'axios';
import { getTransactionBalanceTreatment } from '../../src/transactionBalance.js';
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
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const DAY_MS = 24 * 60 * 60 * 1000;

const retryDelayMs = error => {
  const retryAfter = error.response?.headers?.['retry-after'];
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, 15_000);
  const date = Date.parse(retryAfter);
  if (Number.isFinite(date)) return Math.min(Math.max(date - Date.now(), 1000), 15_000);
  return 2000;
};

const dateDistanceDays = (left, right) => {
  const a = new Date(`${left}T00:00:00Z`);
  const b = new Date(`${right}T00:00:00Z`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return Number.POSITIVE_INFINITY;
  return Math.round(Math.abs(a.getTime() - b.getTime()) / DAY_MS);
};

const isSatisfiedByNearbyFoundTransaction = (missingDate, foundTransactions, maxDays = 3) =>
  foundTransactions.some(match => match.date && dateDistanceDays(missingDate, match.date) <= maxDays);

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
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await axios.get(`${config.lunchMoneyBaseUrl}${path}`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          params,
        });
        return response.data;
      } catch (error) {
        if (error.response?.status !== 429 || attempt === 2) throw error;
        await sleep(retryDelayMs(error));
      }
    }
    return null;
  }

  async put(path, data, params = {}) {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      const error = new Error('Lunch Money API key is not configured.');
      error.status = 401;
      throw error;
    }
    const response = await axios.put(`${config.lunchMoneyBaseUrl}${path}`, data, {
      headers: { Authorization: `Bearer ${apiKey}` },
      params,
    });
    return response.data;
  }

  async post(path, data, params = {}) {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      const error = new Error('Lunch Money API key is not configured.');
      error.status = 401;
      throw error;
    }
    const response = await axios.post(`${config.lunchMoneyBaseUrl}${path}`, data, {
      headers: { Authorization: `Bearer ${apiKey}` },
      params,
    });
    return response.data;
  }

  async delete(path, data) {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      const error = new Error('Lunch Money API key is not configured.');
      error.status = 401;
      throw error;
    }
    const response = await axios.delete(`${config.lunchMoneyBaseUrl}${path}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      data,
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
      lastUpdated: account.balance_last_update || account.last_import || account.updated_at || null,
      status: account.status || null,
    };
  }

  normalizeTransaction(transaction, anchorDate, tagNamesById = new Map()) {
    const source = transaction.manual_account_id != null ? 'manual' : 'plaid';
    const id = transaction.manual_account_id ?? transaction.plaid_account_id;
    if (id == null) return null;
    const lunchMoneySource = transaction.source;
    const tagIds = transaction.tag_ids || [];
    const tagNames = tagIds.map(tagId => tagNamesById.get(Number(tagId))).filter(Boolean);
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
      lunchMoneySource,
      balanceTreatment: getTransactionBalanceTreatment({
        accountSource: source,
        lunchMoneySource,
        isPending: Boolean(transaction.is_pending),
        tagNames,
      }),
      categoryId: transaction.category_id,
      tagIds,
      tagNames,
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
    const foundTransactions = matches.found_transactions || matches.transactions_within_range || [];
    return (matches.missing_transaction_dates || matches.missing_dates_within_range || [])
      .filter(date => !isSatisfiedByNearbyFoundTransaction(date, foundTransactions))
      .map(date => ({
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

  async getTags() {
    const data = await this.get('/tags');
    return unwrapList(data, 'tags').map(tag => ({
      id: Number(tag.id),
      name: tag.name,
      archived: Boolean(tag.archived_at || tag.archived),
    }));
  }

  async createTag(tag) {
    const data = await this.post('/tags', tag);
    const created = data?.tag || data;
    return {
      id: Number(created.id),
      name: created.name,
      archived: Boolean(created.archived_at || created.archived),
    };
  }

  async getTransactions(startDate, endDate, anchorDate = startDate) {
    const [transactions, tags] = await Promise.all([
      this.getRawTransactions(startDate, endDate),
      this.getTags(),
    ]);
    const tagNamesById = new Map(tags.map(tag => [tag.id, tag.name]));
    return transactions
      .map(transaction => this.normalizeTransaction(transaction, anchorDate, tagNamesById))
      .filter(Boolean);
  }

  async getRawTransactions(startDate, endDate, { includeMetadata = false } = {}) {
    const data = await this.get('/transactions', {
      start_date: startDate,
      end_date: endDate,
      include_pending: true,
      ...(includeMetadata ? { include_metadata: true } : {}),
    });
    // Default v2 behavior omits split parents and grouped children, preventing double-counting.
    return unwrapList(data, 'transactions');
  }

  async getAllRawTransactions(params = {}) {
    const limit = 2000;
    let offset = 0;
    const transactions = [];
    let hasMore = true;
    while (hasMore) {
      const data = await this.get('/transactions', {
        include_pending: true,
        limit,
        offset,
        ...params,
      });
      const page = unwrapList(data, 'transactions');
      transactions.push(...page);
      hasMore = Boolean(data?.has_more) || page.length === limit;
      offset += limit;
    }
    return transactions;
  }

  async getTransaction(transactionId) {
    const data = await this.get(`/transactions/${transactionId}`);
    return data?.transaction || data;
  }

  async updateTransaction(transactionId, update) {
    const data = await this.put(`/transactions/${transactionId}`, update, { update_balance: false });
    return data?.transaction || data;
  }

  async bulkUpdateTransactions(transactions) {
    const data = await this.put('/transactions', { transactions });
    return unwrapList(data, 'transactions');
  }

  async deleteTransaction(transactionId) {
    await this.delete(`/transactions/${transactionId}`);
    return true;
  }

  async getSuggestedRecurringItems(params = {}) {
    let data;
    try {
      data = await this.get('/recurring_items', { include_suggested: true, ...params });
    } catch (error) {
      if (error.response?.status !== 404) throw error;
      data = await this.get('/recurring', { include_suggested: true, ...params });
    }
    const items = unwrapList(data, 'recurring_items');
    const recurringItems = items.length > 0 ? items : unwrapList(data, 'recurring');
    return recurringItems.filter(item => (
      item.status === 'suggested'
      || item.status === 'recurring_suggested'
      || item.is_suggested === true
      || item.suggested === true
    ));
  }

  async deleteRecurringItem(recurringItemId) {
    try {
      await this.delete(`/recurring_items/${recurringItemId}`);
    } catch (error) {
      if (error.response?.status !== 404) throw error;
      await this.delete(`/recurring/${recurringItemId}`);
    }
    return true;
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
