const USER_ENTERED_LUNCH_MONEY_SOURCES = new Set(['api', 'manual', 'recurring']);

export const getTransactionBalanceTreatment = ({ accountSource, lunchMoneySource }) => {
  const normalizedSource = String(lunchMoneySource || '').toLowerCase();

  // Transactions created by a user or automation against a synced account do
  // not change its bank-supplied balance. Keep recurring-created transactions
  // compatible with the existing opening-adjustment behavior for all accounts.
  if (normalizedSource === 'recurring'
    || (accountSource === 'plaid' && USER_ENTERED_LUNCH_MONEY_SOURCES.has(normalizedSource))) {
    return 'unreflected';
  }

  return 'included';
};

export const isUnreflectedTransaction = event => event.balanceTreatment === 'unreflected';
