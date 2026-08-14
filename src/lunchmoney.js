import axios from 'axios';

const API_URL = '/api/lunch-money';

export const getAccountKey = (source, id) => `${source}:${id}`;

const unwrapList = (data, key) => {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.[key])) return data[key];
  if (Array.isArray(data?.data)) return data.data;
  return [];
};

const toNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

export const normalizeManualAccount = (account) => ({
  id: account.id,
  source: 'manual',
  key: getAccountKey('manual', account.id),
  name: account.display_name || account.name,
  display_name: account.display_name || account.name,
  institution: account.institution_name,
  balance: toNumber(account.balance),
});

export const normalizePlaidAccount = (account) => ({
  id: account.id,
  source: 'plaid',
  key: getAccountKey('plaid', account.id),
  name: account.display_name || account.name,
  display_name: account.display_name || account.name,
  institution: account.institution_name,
  balance: toNumber(account.balance),
});

// Lunch Money v2 uses positive amounts for debits and negative amounts for credits.
// Internally, positive means cash entering the selected account and negative means leaving it.
export const normalizeLunchMoneyAmount = (amount) => -toNumber(amount);

export const normalizeTransaction = (transaction) => {
  const source = transaction.manual_account_id ? 'manual' : 'plaid';
  const accountId = transaction.manual_account_id ?? transaction.plaid_account_id;
  if (accountId == null) return null;

  return {
    id: `transaction:${transaction.id}`,
    accountId,
    accountSource: source,
    accountKey: getAccountKey(source, accountId),
    date: transaction.date,
    description: transaction.payee || transaction.notes || 'Transaction',
    amount: normalizeLunchMoneyAmount(transaction.to_base ?? transaction.amount),
    type: transaction.is_pending ? 'pending' : (transaction.date > new Date().toISOString().slice(0, 10) ? 'future' : 'actual'),
    transactionId: transaction.id,
    recurringId: transaction.recurring_id,
    lunchMoneySource: transaction.source,
    is_pending: Boolean(transaction.is_pending),
  };
};

export const normalizeRecurringItem = (item) => {
  const criteria = item.transaction_criteria || item;
  const matches = item.matches || item;
  const overrides = item.overrides || {};
  const source = criteria.manual_account_id || criteria.asset_id ? 'manual' : 'plaid';
  const accountId = criteria.manual_account_id ?? criteria.asset_id ?? criteria.plaid_account_id;
  if (accountId == null) return [];

  return (matches.missing_transaction_dates || matches.missing_dates_within_range || []).map(date => ({
    id: `recurring:${item.id}:${date}`,
    accountId,
    accountSource: source,
    accountKey: getAccountKey(source, accountId),
    date,
    description: overrides.payee || criteria.payee || item.description || 'Recurring Transaction',
    amount: normalizeLunchMoneyAmount(criteria.to_base ?? criteria.amount),
    type: 'recurring-projected',
    recurringId: item.id,
  }));
};

export const getAccounts = async () => {
  const response = await axios.get(`${API_URL}/manual-accounts`);
  return unwrapList(response.data, 'accounts');
};

export const getRecurringItems = async (startDate, endDate) => {
  const response = await axios.get(`${API_URL}/recurring`, {
    params: { startDate, endDate },
  });
  return unwrapList(response.data, 'events');
};

export const getPlaidAccounts = async () => {
  const response = await axios.get(`${API_URL}/plaid-accounts`);
  return unwrapList(response.data, 'accounts');
};

export const getTransactions = async (startDate, endDate, anchorDate = startDate) => {
  const response = await axios.get(`${API_URL}/transactions`, {
    params: {
      startDate,
      endDate,
      anchorDate,
    },
  });
  return unwrapList(response.data, 'transactions');
};
