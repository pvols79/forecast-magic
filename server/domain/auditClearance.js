// Audit settlement is a local assertion, never a mutation of LM's native flags.
export const applyAuditClearance = (transaction, entries) => {
  if (!transaction) return transaction;
  const entry = entries.find(item => !item.revokedAt
    && item.accountKey === transaction.accountKey && item.transactionId === transaction.transactionId);
  const valid = entry && ['date', 'amountCents', 'source'].every(key =>
    entry.snapshot[key] === transaction[key]);
  const pending = transaction.pendingExplanation?.nativePending
    || transaction.pendingExplanation?.taggedPlaceholder;
  if (!valid) return {
    ...transaction, effectiveStatus: pending ? 'pending'
      : transaction.source === 'recurring' ? 'projected' : 'cleared',
    clearanceNeedsReview: Boolean(entry),
  };
  return {
    ...transaction,
    lmIsPending: transaction.isPending,
    isPending: false,
    effectiveStatus: 'cleared',
    auditClearance: entry,
    pendingExplanation: {
      classification: 'verified_cleared', balanceTreatment: 'included',
      explanation: 'Verified posted by an administrator. Treat as cleared in audits, even if LM retains pending flags or placeholder tags.',
      originalSignals: transaction.pendingExplanation,
      resolutionAction: 'none',
    },
  };
};
