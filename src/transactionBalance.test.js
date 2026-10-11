import { describe, expect, it } from 'vitest';
import { explainTransactionPending } from './transactionBalance.js';

describe('Pending explanations', () => {
  const base = { accountSource: 'plaid', lunchMoneySource: 'manual', isPending: false };
  it('explains retained manual records before and after removing placeholder tags', () => {
    expect(explainTransactionPending({ ...base, tagNames: ['LM Manual', 'Forecast Magic Pending'] })).toMatchObject({
      classification: 'tagged_placeholder', balanceTreatment: 'unreflected',
      placeholderTags: ['LM Manual', 'Forecast Magic Pending'],
    });
    expect(explainTransactionPending({ ...base, tagNames: [] })).toMatchObject({
      classification: 'no_pending_signal', balanceTreatment: 'included',
    });
  });
  it('does not let matched_import hide native pending or placeholder tags', () => {
    expect(explainTransactionPending({ ...base, isPending: true, tagNames: ['matched_import'] })).toMatchObject({
      classification: 'lm_pending_flag', balanceTreatment: 'unreflected',
      nativePendingEditableViaApi: false, resolutionAction: 'investigate_lm_native_pending',
    });
    expect(explainTransactionPending({ ...base, tagNames: ['matched_import', 'n8n_proc'] }).taggedPlaceholder).toBe(true);
  });
  it('offers tag reconciliation only for a tagged record without native pending', () => {
    expect(explainTransactionPending({ ...base, tagNames: ['LM Manual'] }).resolutionAction)
      .toBe('remove_placeholder_tags_after_bank_verification');
    expect(explainTransactionPending({ ...base, isPending: true, tagNames: ['LM Manual'] }).resolutionAction)
      .toBe('investigate_lm_native_pending');
  });
  it('does not classify API origin alone or inherited tags on a settled Plaid row as pending', () => {
    expect(explainTransactionPending({ ...base, lunchMoneySource: 'api', tagNames: [] }).classification).toBe('no_pending_signal');
    expect(explainTransactionPending({ ...base, lunchMoneySource: 'plaid', tagNames: ['n8n_proc'] })).toMatchObject({
      classification: 'no_pending_signal', balanceTreatment: 'included',
    });
  });
});
