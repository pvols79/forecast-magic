import axios from 'axios';

const api = axios.create({ baseURL: '/api' });

export const getAuthStatus = async () => (await api.get('/auth/status')).data;
export const loginAdmin = async password => (await api.post('/auth/login', { password })).data;
export const logoutAdmin = async () => api.delete('/auth/logout');

export const getSettings = async () => (await api.get('/settings')).data;
export const updateTimezone = async timezone => (await api.put('/settings/timezone', { timezone })).data;
export const saveApiKey = async apiKey => api.put('/settings/api-key', { apiKey });
export const clearApiKey = async () => api.delete('/settings/api-key');

export const getCategories = async () => (await api.get('/lunch-money/categories')).data.categories;

export const getFinancialOverview = async (accountKey, anchorDate) => (
  await api.get('/analytics/overview', { params: { accountKey, anchorDate } })
).data;

export const getDailyHighlightPdf = async (accountKey, view) => {
  const response = await api.get('/reporting/daily-highlight.pdf', {
    params: { accountKey, view },
    responseType: 'blob',
  });
  const disposition = response.headers['content-disposition'] || '';
  const filename = /filename="?([^";]+)"?/i.exec(disposition)?.[1]
    || `forecast-magic-daily-highlight-${new Date().toISOString().slice(0, 10)}.pdf`;
  return { blob: response.data, filename };
};

export const getOperationalFunds = async accountKey => (
  await api.get('/funds', { params: { accountKey } })
).data.funds;

export const getOperationalFundProjection = async (accountKey, anchorDate, endDate, householdView) => (
  await api.get('/funds/projection', {
    params: { accountKey, anchorDate, endDate, view: householdView ? 'household' : 'admin' },
  })
).data;

export const createOperationalFund = async fund => (await api.post('/funds', fund)).data.fund;
export const updateOperationalFund = async (id, fund) => (await api.put(`/funds/${id}`, fund)).data.fund;
export const deleteOperationalFund = async id => api.delete(`/funds/${id}`);
export const excludeFundTransaction = async (fundId, transactionId) => (
  await api.post(`/funds/${fundId}/exclusions`, { transactionId })
).data.fund;
export const includeFundTransaction = async (fundId, transactionId) => (
  await api.delete(`/funds/${fundId}/exclusions/${transactionId}`)
).data.fund;

export const scanDuplicateTransactions = async (accountKey, includeLow = false) => (
  await api.get('/duplicate-review/scan', { params: { accountKey, includeLow } })
).data;

export const ignoreDuplicateTransactions = async candidate => (
  await api.post('/duplicate-review/ignore', {
    accountKey: candidate.manual.accountKey,
    manualTransactionId: candidate.manual.id,
    importedTransactionId: candidate.imported.id,
  })
).data;

export const resolveDuplicateTransactions = async (candidate, preferences) => (
  await api.post('/duplicate-review/resolve', {
    accountKey: candidate.manual.accountKey,
    manualTransactionId: candidate.manual.id,
    importedTransactionId: candidate.imported.id,
    manualFingerprint: candidate.manualFingerprint,
    importedFingerprint: candidate.importedFingerprint,
    ...preferences,
  })
).data;

export const getApiErrorMessage = error => error.response?.data?.error || error.message || 'Unexpected error.';
