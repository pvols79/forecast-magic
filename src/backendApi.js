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

export const getApiErrorMessage = error => error.response?.data?.error || error.message || 'Unexpected error.';
