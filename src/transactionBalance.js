const PENDING_PLACEHOLDER_TAGS = new Set([
  'forecastmagicpending',
  'n8npending',
]);
const PLACEHOLDER_SOURCES = new Set(['api', 'manual']);

const normalizeTagName = value => String(value || '')
  .toLowerCase()
  .replace(/[^a-z0-9]/g, '');

export const isPendingPlaceholderTag = value =>
  PENDING_PLACEHOLDER_TAGS.has(normalizeTagName(value));

export const getTransactionBalanceTreatment = ({
  accountSource,
  lunchMoneySource,
  isPending = false,
  tagNames = [],
}) => {
  const normalizedSource = String(lunchMoneySource || '').toLowerCase();

  // A transaction's API source describes how it was created, not whether it is
  // already represented by the current bank balance. Only explicit pending
  // signals may turn a synced-account transaction into an adjustment.
  if (normalizedSource === 'recurring' || (
    accountSource === 'plaid'
    && (isPending || (
      PLACEHOLDER_SOURCES.has(normalizedSource)
      && tagNames.some(isPendingPlaceholderTag)
    ))
  )) {
    return 'unreflected';
  }

  return 'included';
};

export const isUnreflectedTransaction = event => event.balanceTreatment === 'unreflected';
