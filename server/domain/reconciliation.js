import { payeeSimilarity } from './duplicateReview.js';
import { businessDaysBetween } from './financialAudit.js';

const daysApart = (a, b) => Math.abs((Date.parse(a) - Date.parse(b)) / 86400000);
const normalized = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const label = row => row.description || row.payee || '';
const pending = row => row.effectiveStatus === 'pending';
export const directionTotals = rows => {
  const debits = rows.filter(row => row.amountCents < 0);
  const credits = rows.filter(row => row.amountCents > 0);
  const result = { count: rows.length, debitCount: debits.length, debitCents: -debits.reduce((sum, row) => sum + row.amountCents, 0),
    creditCount: credits.length, creditCents: credits.reduce((sum, row) => sum + row.amountCents, 0) };
  if (!Object.values(result).every(Number.isSafeInteger)) throw new Error('Amounts exceed the exact-cent accounting range. Use a smaller evidence period.');
  return result;
};

export const consolidateBankEvidence = evidence => {
  const retained = [];
  const buckets = new Map();
  const overlaps = [];
  for (const file of evidence.filter(file => file.kind === 'capital_one' && file.review?.useDocument !== false)) {
    const ordinals = new Map();
    for (const row of file.review.rows.filter(row => row.relevant)) {
      const signature = JSON.stringify([row.date, row.amountCents, normalized(row.description), row.balanceAfterCents ?? null]);
      const ordinal = ordinals.get(signature) || 0;
      ordinals.set(signature, ordinal + 1);
      const bucket = buckets.get(signature) || [];
      const locator = { evidenceId: file.id, filename: file.filename, sourceRow: row.sourceRow, rowKey: row.key };
      if (bucket[ordinal]) {
        bucket[ordinal].evidence.push(locator);
        overlaps.push({ retainedKey: bucket[ordinal].key, duplicateEvidence: locator });
      } else {
        const bank = { ...row, key: `${file.id}:${row.key}`, evidence: [locator], disposition: null };
        bucket[ordinal] = bank;
        retained.push(bank);
        buckets.set(signature, bucket);
      }
    }
  }
  return { rows: retained, overlaps };
};

const similarity = (bank, lm, venmo = []) => {
  const direct = Math.max(payeeSimilarity(label(bank), lm.payee), payeeSimilarity(label(bank), lm.originalPayee));
  if (!/venmo/i.test(label(bank))) return direct;
  const supplemental = venmo.filter(row => row.amountCents === bank.amountCents && daysApart(row.date, bank.date) <= 5);
  return Math.max(direct, ...supplemental.map(row => Math.max(payeeSimilarity(row.counterparty || row.description, lm.payee), payeeSimilarity(row.counterparty || row.description, lm.originalPayee))), 0);
};
const candidatesFor = (bank, lmRows, venmo) => lmRows.filter(row => row.amountCents === bank.amountCents
  && daysApart(row.date, bank.date) <= 5 && similarity(bank, row, venmo) >= 0.55);

const maximumMatching = (banks, adjacency, omit = '') => {
  const assigned = new Map();
  const visit = (bank, seen) => {
    for (const lm of adjacency.get(bank.key) || []) {
      if (`${bank.key}|${lm.transactionId}` === omit || seen.has(lm.transactionId)) continue;
      seen.add(lm.transactionId);
      if (!assigned.has(lm.transactionId) || visit(assigned.get(lm.transactionId), seen)) {
        assigned.set(lm.transactionId, bank); return true;
      }
    }
    return false;
  };
  for (const bank of banks) visit(bank, new Set());
  return assigned;
};

// All accounting records get exactly one disposition. Supplemental Venmo and
// pending screenshot rows never become extra posted bank transactions.
export const reconcileEvidence = ({ evidence, transactions, account, anchorDate, queriedRange, clearanceRegister = [], limitations = [], decisions = [] }) => {
  const files = evidence.filter(file => file.review?.useDocument !== false);
  const bankFiles = files.filter(file => file.kind === 'capital_one');
  const covered = date => bankFiles.some(file => date >= file.review.coverageStart && date <= file.review.coverageEnd);
  const { rows: bankRows, overlaps } = consolidateBankEvidence(files);
  const supplement = kind => files.filter(file => file.kind === kind).flatMap(file => file.review.rows.filter(row => row.relevant).map(row => ({
    ...row, key: `${file.id}:${row.key}`, filename: file.filename, evidenceId: file.id,
  })));
  const venmo = supplement('venmo');
  const pendingRows = consolidateBankEvidence(files.filter(file => file.kind === 'pending').map(file => ({ ...file, kind: 'capital_one' }))).rows
    .map(row => ({ ...row, evidenceId: row.evidence[0].evidenceId, filename: row.evidence[0].filename }));
  const lmRows = transactions.map(row => ({ ...row, disposition: row.source === 'recurring' ? 'projected_not_bank' : null }));
  const bankByKey = new Map(bankRows.map(row => [row.key, row]));
  const lmById = new Map(lmRows.map(row => [row.transactionId, row]));
  const matches = [];
  const findings = [];
  const ambiguousGroups = [];
  const addFinding = (category, title, bank = [], lm = [], supportingEvidence = [], extra = {}) => findings.push({
    id: `finding:${findings.length + 1}`, category, title, bankKeys: bank.map(row => row.key), transactionIds: lm.map(row => row.transactionId), supportingEvidence, ...extra,
  });
  const match = (bank, lm, method, reason = null) => {
    bank.disposition = 'matched'; lm.disposition = 'matched';
    bank.transactionId = lm.transactionId; lm.bankKey = bank.key;
    matches.push({ bankKey: bank.key, transactionId: lm.transactionId, method, reason,
      dayDifference: daysApart(bank.date, lm.date), similarity: similarity(bank, lm, venmo) });
  };
  for (const item of decisions) {
    const bank = bankByKey.get(item.bankKey); const lm = lmById.get(String(item.transactionId));
    if (!bank || !lm || bank.disposition || lm.disposition || bank.amountCents !== lm.amountCents || !String(item.reason || '').trim()) {
      throw Object.assign(new Error('A saved manual match is no longer valid. Review its bank row, current LM record, amount and reason.'), { status: 409 });
    }
    match(bank, lm, 'reviewed_manual_match', item.reason);
  }
  for (const phase of ['cleared', 'pending']) {
    const banks = bankRows.filter(row => !row.disposition);
    const available = lmRows.filter(row => !row.disposition && (phase === 'pending' ? pending(row) : !pending(row)));
    const adjacency = new Map(banks.map(bank => [bank.key, candidatesFor(bank, available, venmo)]));
    const visited = new Set();
    for (const seed of banks) {
      if (visited.has(seed.key) || !adjacency.get(seed.key).length) continue;
      const componentBanks = []; const componentLm = new Map(); const queue = [seed];
      while (queue.length) {
        const bank = queue.shift();
        if (visited.has(bank.key)) continue;
        visited.add(bank.key); componentBanks.push(bank);
        for (const lm of adjacency.get(bank.key)) {
          if (componentLm.has(lm.transactionId)) continue;
          componentLm.set(lm.transactionId, lm);
          for (const neighbor of banks) if (!visited.has(neighbor.key) && adjacency.get(neighbor.key).some(row => row.transactionId === lm.transactionId)) queue.push(neighbor);
        }
      }
      const assigned = maximumMatching(componentBanks, adjacency);
      const perfect = assigned.size === componentBanks.length && assigned.size === componentLm.size;
      const unique = perfect && [...assigned].every(([id, bank]) => maximumMatching(componentBanks, adjacency, `${bank.key}|${id}`).size < assigned.size);
      const sameBankRows = new Set(componentBanks.map(row => `${row.date}|${row.amountCents}|${normalized(row.description)}`)).size === 1;
      const sameLmMerchant = new Set([...componentLm.values()].map(row => normalized(row.payee))).size === 1;
      const venmoSetSupported = componentBanks.every(row => /venmo/i.test(row.description)) && [...componentLm.values()].every(lm =>
        venmo.some(v => v.amountCents === lm.amountCents && daysApart(v.date, lm.date) <= 5 && payeeSimilarity(v.counterparty || v.description, lm.payee) >= 0.72));
      const equivalentSet = perfect && sameBankRows && (sameLmMerchant || venmoSetSupported);
      if (unique || equivalentSet) {
        for (const [id, bank] of assigned) match(bank, componentLm.get(id), equivalentSet && !unique ? 'equivalent_set_by_count_and_total' : 'account_amount_date_payee');
      } else {
        for (const bank of componentBanks) bank.disposition = 'ambiguous';
        for (const lm of componentLm.values()) lm.disposition = 'ambiguous';
        ambiguousGroups.push({ bankKeys: componentBanks.map(row => row.key), transactionIds: [...componentLm.keys()] });
        addFinding('ambiguous_match', 'Multiple plausible representations need review', componentBanks, [...componentLm.values()]);
      }
    }
  }
  for (const bank of bankRows.filter(row => !row.disposition)) {
    bank.disposition = 'missing_in_lm';
    addFinding('missing_in_lm', 'Bank-posted transaction has no confirmed LM match', [bank]);
  }
  for (const lm of lmRows.filter(row => !row.disposition)) {
    if (!covered(lm.date)) lm.disposition = 'boundary';
    else if (pending(lm)) lm.disposition = 'pending_unmatched';
    else lm.disposition = 'extra_in_lm';
    if (lm.disposition === 'extra_in_lm') addFinding('extra_in_lm', 'LM transaction has no bank row in the covered period', [], [lm]);
  }
  for (const bank of bankRows.filter(row => row.disposition === 'matched')) {
    const lm = lmById.get(bank.transactionId);
    if (pending(lm)) addFinding('posted_represented_by_placeholder', 'Bank-posted activity is represented by a retained placeholder; import may still be settling', [bank], [lm]);
    const extras = lmRows.filter(row => row.transactionId !== lm.transactionId && row.disposition !== 'matched'
      && row.amountCents === bank.amountCents && daysApart(row.date, bank.date) <= 5 && similarity(bank, row, venmo) >= 0.55);
    if (extras.length) addFinding('potential_duplicate', 'More than one LM record may represent this bank-posted transaction', [bank], [lm, ...extras]);
  }
  for (const lm of lmRows.filter(row => pending(row) && row.disposition !== 'matched')) {
    const screenshotCandidates = pendingRows.filter(row => row.amountCents === lm.amountCents && daysApart(row.date, lm.date) <= 5 && similarity(row, lm) >= 0.55);
    if (businessDaysBetween(lm.date, anchorDate) >= 5) addFinding('stale_placeholder', 'Older pending signal needs review; age alone does not prove it is stale', [], [lm], screenshotCandidates.map(row => ({ evidenceId: row.evidenceId, filename: row.filename, sourceRow: row.sourceRow })));
    const changed = bankRows.filter(row => ['matched', 'missing_in_lm'].includes(row.disposition) && Math.sign(row.amountCents) === Math.sign(lm.amountCents)
      && row.amountCents !== lm.amountCents && daysApart(row.date, lm.date) <= 7 && similarity(row, lm, venmo) >= 0.72);
    if (changed.length) addFinding('possible_hold_amount_change', 'Possible authorization hold or placeholder with a different settled amount', changed, [lm, ...changed.map(row => lmById.get(row.transactionId))].filter(Boolean));
  }
  const pendingAssigned = new Set();
  const pendingEvidence = pendingRows.map(row => {
    const eligible = lmRows.filter(lm => pending(lm) && lm.disposition !== 'matched' && row.amountCents === lm.amountCents && daysApart(row.date, lm.date) <= 5 && similarity(row, lm) >= 0.55);
    const settled = lmRows.filter(lm => (!pending(lm) || lm.disposition === 'matched') && row.amountCents === lm.amountCents && daysApart(row.date, lm.date) <= 5 && similarity(row, lm) >= 0.55);
    const disposition = eligible.length === 1 && !pendingAssigned.has(eligible[0].transactionId) ? 'represented_pending' : eligible.length ? 'ambiguous' : settled.length ? 'possibly_settled_since_screenshot' : 'not_represented';
    if (disposition === 'represented_pending') pendingAssigned.add(eligible[0].transactionId);
    if (disposition !== 'represented_pending') addFinding('pending_screenshot', disposition === 'not_represented' ? 'Screenshot pending charge is not represented in LM' : 'Screenshot pending activity needs review', [], [...eligible, ...settled], [{ evidenceId: row.evidenceId, filename: row.filename, sourceRow: row.sourceRow }]);
    const changed = lmRows.filter(lm => pending(lm) && lm.amountCents !== row.amountCents && Math.sign(lm.amountCents) === Math.sign(row.amountCents)
      && daysApart(row.date, lm.date) <= 5 && similarity(row, lm) >= 0.72);
    if (changed.length) addFinding('pending_amount_mismatch', 'Screenshot and possible LM placeholder have different amounts', [], changed, [{ evidenceId: row.evidenceId, filename: row.filename, sourceRow: row.sourceRow, amountCents: row.amountCents }]);
    return { ...row, disposition, transactionIds: eligible.map(lm => lm.transactionId) };
  });
  const stats = {
    bank: directionTotals(bankRows), bankMatched: directionTotals(bankRows.filter(row => row.disposition === 'matched')),
    bankMissing: directionTotals(bankRows.filter(row => row.disposition === 'missing_in_lm')),
    bankAmbiguous: directionTotals(bankRows.filter(row => row.disposition === 'ambiguous')),
    lm: directionTotals(lmRows),
    lmMatched: directionTotals(lmRows.filter(row => row.disposition === 'matched')),
    lmExtra: directionTotals(lmRows.filter(row => row.disposition === 'extra_in_lm')),
    lmPending: directionTotals(lmRows.filter(row => row.disposition === 'pending_unmatched')),
    lmBoundary: directionTotals(lmRows.filter(row => row.disposition === 'boundary')),
    lmAmbiguous: directionTotals(lmRows.filter(row => row.disposition === 'ambiguous')),
    lmProjected: directionTotals(lmRows.filter(row => row.disposition === 'projected_not_bank')),
  };
  const conserved = ['count', 'debitCount', 'debitCents', 'creditCount', 'creditCents'].every(key =>
    stats.bank[key] === stats.bankMatched[key] + stats.bankMissing[key] + stats.bankAmbiguous[key]
    && stats.lm[key] === ['lmMatched', 'lmExtra', 'lmPending', 'lmBoundary', 'lmAmbiguous', 'lmProjected'].reduce((sum, name) => sum + stats[name][key], 0)
    && stats.bankMatched[key] === stats.lmMatched[key]);
  if (!conserved) throw new Error('Reconciliation accounting failed its count/amount checks. No verdict was saved.');
  const completeness = limitations.length ? 'incomplete' : ambiguousGroups.length ? 'inconclusive' : 'complete';
  const reconciled = completeness === 'complete' && !stats.bankMissing.count && !stats.lmExtra.count;
  return {
    methodology: 'evidence-reconciliation-v1', account, anchorDate, fetchedAt: new Date().toISOString(), queriedRange,
    coverage: bankFiles.map(file => ({ evidenceId: file.id, filename: file.filename, startDate: file.review.coverageStart, endDate: file.review.coverageEnd })),
    completeness, reconciliation: reconciled ? 'reconciled' : 'needs_review',
    bankToLm: !stats.bankMissing.count && !stats.bankAmbiguous.count ? 'accounted_for' : 'needs_review',
    lmToBank: !stats.lmExtra.count && !stats.lmAmbiguous.count ? 'posted_accounted_for' : 'needs_review',
    countsAndAmountsVerified: conserved, stats, bankRows, lmRows, matches, ambiguousGroups, pendingEvidence, findings,
    overlapHandling: { excludedDuplicateRows: overlaps.length, rows: overlaps, policy: 'Maximum multiplicity across files; identical purchases inside each export remain distinct.' },
    evidenceManifest: evidence.map(file => ({ id: file.id, kind: file.kind, filename: file.filename, sha256: file.sha256,
      reviewedAt: file.reviewedAt, included: file.review?.useDocument !== false,
      exclusionReason: file.review?.documentExclusionReason || null,
      excludedRows: (file.review?.rows || []).filter(row => !row.relevant).map(row => ({ sourceRow: row.sourceRow, description: row.description, reason: row.exclusionReason })) })),
    clearanceRegister, limitations,
    balanceNote: 'This verdict reconciles the transaction register within the declared bank-export coverage. The current LM synced balance is context, not proof of reconciliation or a same-date bank balance comparison. Pending screenshot charges are supplemental and never added to posted bank totals.',
  };
};
