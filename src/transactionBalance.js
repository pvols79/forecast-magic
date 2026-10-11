const PENDING_PLACEHOLDER_TAGS = new Set([
  'forecastmagicpending',
  'n8nproc',
  'n8npending',
  'lmmanual',
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

export const explainTransactionPending = input => {
  const source = String(input.lunchMoneySource || '').toLowerCase();
  const placeholderTags = (input.tagNames || []).filter(isPendingPlaceholderTag);
  const nativePending = Boolean(input.isPending);
  const taggedPlaceholder = PLACEHOLDER_SOURCES.has(source) && placeholderTags.length > 0;
  return {
    nativePending,
    taggedPlaceholder,
    placeholderTags,
    nativePendingEditableViaApi: false,
    resolutionAction: nativePending ? 'investigate_lm_native_pending'
      : taggedPlaceholder ? 'remove_placeholder_tags_after_bank_verification' : 'none',
    classification: nativePending ? 'lm_pending_flag'
      : taggedPlaceholder ? 'tagged_placeholder'
        : source === 'recurring' ? 'recurring_projection' : 'no_pending_signal',
    balanceTreatment: getTransactionBalanceTreatment(input),
    explanation: nativePending
      ? 'Lunch Money reports is_pending=true. This is a system-defined field, not a tag. The LM v2 API ignores attempts to update it. Removing tags or setting status=reviewed does not clear this flag.'
      : taggedPlaceholder
        ? 'A manual/API record has explicit placeholder tags. Tags persist until removed; age does not prove the bank transaction is unsettled.'
        : source === 'recurring'
          ? 'This is a recurring projection, not evidence of a bank authorization awaiting settlement.'
          : 'No native pending flag or applicable placeholder tag. Manual/API origin and n8n notes alone do not make a transaction pending. This does not independently prove bank settlement.',
    resolution: 'First verify the posted bank row and confirm only one LM record represents it. If deliberately retaining a manual/API replacement for a deleted import with is_pending=false, an admin can remove all placeholder tags using LM tag editing or an authorized tag_ids API update while preserving unrelated tags. If is_pending=true, inspect source and Plaid metadata and investigate with LM support; the v2 API cannot clear it. Do not add matched_import to disguise a manual record as a Plaid import. Keep a note explaining the replacement. Refresh live data afterward; saved audits are historical. The read-only MCP cannot make these changes.',
  };
};
