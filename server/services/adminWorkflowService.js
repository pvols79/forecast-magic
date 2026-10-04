import { LunchMoneyService } from './lunchMoneyService.js';

const DELETED_PENDING_STATUSES = new Set(['deleted_pending', 'delete_pending']);

const accountKey = transaction => {
  if (transaction.manual_account_id != null) return `manual:${transaction.manual_account_id}`;
  if (transaction.plaid_account_id != null) return `plaid:${transaction.plaid_account_id}`;
  return null;
};

const summarizeTransaction = transaction => ({
  id: transaction.id,
  date: transaction.date,
  payee: transaction.payee || transaction.notes || 'Unnamed transaction',
  amount: Number(transaction.to_base ?? transaction.amount ?? 0),
  status: transaction.status || null,
  accountKey: accountKey(transaction),
});

const recurringAccountKey = item => {
  const criteria = item.transaction_criteria || item;
  if (criteria.manual_account_id != null || criteria.asset_id != null) {
    return `manual:${criteria.manual_account_id ?? criteria.asset_id}`;
  }
  if (criteria.plaid_account_id != null) return `plaid:${criteria.plaid_account_id}`;
  return null;
};

const summarizeRecurringItem = item => {
  const criteria = item.transaction_criteria || item;
  const overrides = item.overrides || {};
  return {
    id: item.id,
    payee: overrides.payee || criteria.payee || item.description || 'Suggested recurring item',
    amount: Number(criteria.to_base ?? criteria.amount ?? 0),
    status: item.status || 'suggested',
    accountKey: recurringAccountKey(item),
  };
};

const suggestionTransactionIds = suggestion => [
  ...new Set((suggestion.matches?.found_transactions || [])
    .map(match => Number(match.transaction_id))
    .filter(Number.isFinite)),
];

const filterByAccount = (items, selectedAccountKey, getItemAccountKey) => {
  if (!selectedAccountKey) return items;
  return items.filter(item => getItemAccountKey(item) === selectedAccountKey);
};

export class AdminWorkflowService {
  constructor(lunchMoney = new LunchMoneyService()) {
    this.lunchMoney = lunchMoney;
  }

  async getDeletedPendingTransactions(accountKeyFilter) {
    const transactions = await this.lunchMoney.getAllRawTransactions();
    return filterByAccount(
      transactions.filter(transaction => DELETED_PENDING_STATUSES.has(transaction.status)),
      accountKeyFilter,
      accountKey
    );
  }

  async reviewDeletedPending(accountKeyFilter) {
    const transactions = await this.getDeletedPendingTransactions(accountKeyFilter);
    if (transactions.length === 0) {
      return { reviewed: 0, transactions: [] };
    }
    const updates = transactions.map(transaction => ({ id: transaction.id, status: 'reviewed' }));
    await this.lunchMoney.bulkUpdateTransactions(updates);
    return {
      reviewed: transactions.length,
      transactions: transactions.map(summarizeTransaction),
    };
  }

  async getRecurringSuggestions(accountKeyFilter) {
    const today = new Date();
    const startDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1))
      .toISOString().slice(0, 10);
    const endDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0))
      .toISOString().slice(0, 10);
    const suggestions = filterByAccount(
      await this.lunchMoney.getSuggestedRecurringItems({ start_date: startDate, end_date: endDate }),
      accountKeyFilter,
      recurringAccountKey
    ).filter(suggestion => suggestionTransactionIds(suggestion).length > 0);
    const suggestionIds = new Set(suggestions.map(suggestion => Number(suggestion.id)));
    const linkedTransactions = await this.lunchMoney.getAllRawTransactions({
      include_metadata: true,
      start_date: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 5, 1)).toISOString().slice(0, 10),
      end_date: endDate,
    });
    const linkedTransactionIdsBySuggestion = new Map();
    for (const transaction of linkedTransactions) {
      const recurringId = Number(transaction.recurring_id);
      if (!suggestionIds.has(recurringId) || accountKey(transaction) !== accountKeyFilter) continue;
      const transactionIds = linkedTransactionIdsBySuggestion.get(recurringId) || [];
      transactionIds.push(Number(transaction.id));
      linkedTransactionIdsBySuggestion.set(recurringId, transactionIds);
    }
    const preview = suggestions.map(suggestion => ({
      ...summarizeRecurringItem(suggestion),
      transactionIds: linkedTransactionIdsBySuggestion.get(Number(suggestion.id)) || [],
    })).filter(suggestion => suggestion.transactionIds.length > 0);
    return {
      count: preview.length,
      startDate,
      endDate,
      suggestions: preview,
    };
  }

  async clearRecurringSuggestions(accountKeyFilter, expectedTransactionIds = []) {
    const preview = await this.getRecurringSuggestions(accountKeyFilter);
    const expectedIds = new Set(expectedTransactionIds.map(Number).filter(Number.isFinite));
    const currentIds = new Set(preview.suggestions.flatMap(suggestion => suggestion.transactionIds));
    if (expectedIds.size > 0 && (
      expectedIds.size !== currentIds.size || [...expectedIds].some(id => !currentIds.has(id))
    )) {
      const error = new Error('Recurring suggestions changed since preview. Refresh the preview before clearing.');
      error.status = 409;
      throw error;
    }
    const unlinkedTransactions = [];
    for (const suggestion of preview.suggestions) {
      for (const transactionId of suggestion.transactionIds) {
        const transaction = await this.lunchMoney.getTransaction(transactionId);
        if (Number(transaction?.recurring_id) !== Number(suggestion.id)) {
          const error = new Error('A transaction recurring relationship changed since preview. Refresh the preview before clearing.');
          error.status = 409;
          throw error;
        }
        await this.lunchMoney.updateTransaction(transactionId, { recurring_id: null });
        unlinkedTransactions.push({
          id: transactionId,
          recurringId: transaction.recurring_id,
          payee: transaction.payee || transaction.notes || 'Unnamed transaction',
          date: transaction.date,
        });
      }
    }
    return {
      cleared: unlinkedTransactions.length,
      suggestionCount: preview.suggestions.length,
      suggestions: preview.suggestions,
      unlinkedTransactions,
    };
  }
}
