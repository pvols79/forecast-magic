// Verified settlement is shared by audits and forecasts; LM provenance stays unchanged.
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
    balanceTreatment: 'included',
    auditClearance: entry,
    pendingExplanation: {
      classification: 'verified_cleared', balanceTreatment: 'included',
      explanation: 'Verified posted by an administrator. Treat as cleared in audits and forecasts, even if LM retains pending flags or placeholder tags.',
      originalSignals: transaction.pendingExplanation,
      resolutionAction: 'none',
    },
  };
};


// Report the complete account register, independently of transaction pagination.
// Entries outside the query are retained without claiming their current validity.
export const buildClearanceRegister = (entries, transactions, { startDate, endDate }) => {
  const byId = new Map(transactions.map(transaction => [transaction.transactionId, transaction]));
  return entries.map(entry => {
    const transaction = byId.get(entry.transactionId);
    const outsideRange = entry.snapshot.date < startDate || entry.snapshot.date > endDate;
    const status = entry.revokedAt ? 'revoked'
      : transaction?.clearanceNeedsReview ? 'needs_review'
        : transaction?.auditClearance ? 'applied'
          : outsideRange ? 'outside_query_range' : 'transaction_not_found';
    return {
      accountKey: entry.accountKey, transactionId: entry.transactionId,
      date: entry.snapshot.date, payee: transaction?.payee || entry.snapshot.payee,
      amountCents: entry.snapshot.amountCents, source: entry.snapshot.source,
      reason: entry.reason, verifiedAt: entry.verifiedAt, revokedAt: entry.revokedAt,
      status,
    };
  });
};
