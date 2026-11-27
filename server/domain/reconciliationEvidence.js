import { parse } from 'csv-parse/sync';

export const validEvidenceDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const norm = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
export const evidenceDate = value => {
  const text = String(value || '').trim();
  const iso = text.slice(0, 10);
  if (validEvidenceDate(iso)) return iso;
  const named = /^(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),?\s+(\d{4})$/i.exec(text);
  if (named) {
    const month = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(named[1].slice(0, 3).toLowerCase()) + 1;
    const date = `${named[3]}-${String(month).padStart(2, '0')}-${named[2].padStart(2, '0')}`;
    return validEvidenceDate(date) ? date : null;
  }
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?:\s|$)/.exec(text);
  if (!match) return null;
  const date = `${match[3].length === 2 ? '20' : ''}${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
  return validEvidenceDate(date) ? date : null;
};
export const evidenceMoney = value => {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const clean = text.replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1');
  if (!/^[+-]?\d+(?:\.\d{1,4})?$/.test(clean)) return null;
  const cents = Math.round(Number(clean) * 100);
  return Number.isSafeInteger(cents) ? cents : null;
};

// Do not drop unrecognized data rows. They remain in the review with a warning
// until the user corrects or explicitly excludes them.
export const parseReconciliationCsv = (text, kind) => {
  const records = parse(String(text).replace(/^\uFEFF/, ''), { skip_empty_lines: true, relax_column_count: true, trim: true, info: true });
  const headerIndex = records.findIndex(({ record }) => {
    const keys = record.map(norm);
    return keys.some(key => ['date', 'transactiondate', 'posteddate', 'datetime'].includes(key))
      && keys.some(key => ['amount', 'transactionamount', 'amounttotal', 'debit', 'credit', 'withdrawal', 'deposit'].includes(key));
  });
  if (headerIndex < 0) throw Object.assign(new Error('CSV headings were not recognized. Use a Capital One transaction export or Venmo account statement CSV.'), { status: 400 });
  const headings = records[headerIndex].record.map(norm);
  const get = (row, keys) => {
    const index = keys.map(key => headings.indexOf(key)).find(index => index >= 0) ?? -1;
    return index < 0 ? '' : String(row[index] || '').trim();
  };
  const warnings = [];
  const rows = records.slice(headerIndex + 1).map(({ record, info }) => {
    const dateText = get(record, kind === 'capital_one' ? ['posteddate', 'transactiondate', 'date'] : ['datetime', 'date']);
    const date = evidenceDate(dateText);
    const type = get(record, ['transactiontype', 'type']);
    const status = get(record, ['status']);
    const from = get(record, ['from']);
    const to = get(record, ['to']);
    const amountText = get(record, ['transactionamount', 'amounttotal', 'amount']);
    const debit = evidenceMoney(get(record, ['debit', 'withdrawal']));
    const credit = evidenceMoney(get(record, ['credit', 'deposit']));
    let amountCents = evidenceMoney(amountText);
    let issue = '';
    if (kind === 'capital_one') {
      if (debit && credit) issue = 'Both debit and credit columns have amounts; verify the signed amount.';
      if (debit) amountCents = -Math.abs(debit);
      else if (credit) amountCents = Math.abs(credit);
      else if (/debit|withdrawal|purchase|payment sent/i.test(type) && amountCents != null) amountCents = -Math.abs(amountCents);
      else if (/credit|deposit|refund/i.test(type) && amountCents != null) amountCents = Math.abs(amountCents);
      else if (amountCents > 0 && !/^[+-]/.test(amountText)) issue = 'Unsigned amount with no debit/credit type; verify whether this is an inflow or outflow.';
    } else if (amountCents != null && !/^[+-]/.test(amountText.replace(/\s/g, ''))) {
      issue = 'Venmo amount has no explicit sign; verify the payment direction.';
    }
    const description = kind === 'capital_one'
      ? get(record, ['transactiondescription', 'description', 'payee', 'merchant'])
      : [amountCents < 0 ? to : from, get(record, ['note']), type].filter(Boolean).join(' · ');
    const currency = get(record, ['currency', 'isocurrencycode']) || 'USD';
    if (currency.toUpperCase() !== 'USD') issue = 'This workflow currently reconciles USD evidence only.';
    if (!date || !description || amountCents == null) issue = issue || 'Unrecognized row: correct its date, description and signed amount, or exclude it with a reason.';
    if (issue) warnings.push(`CSV line ${info.lines}: ${issue}`);
    return { key: `line:${info.lines}`, sourceRow: info.lines, date: date || '', description: description || record.join(' · '),
      amountCents, currency: currency.toUpperCase(), relevant: kind === 'capital_one' && !issue && amountCents !== 0,
      issue, status, type, fundingSource: get(record, ['fundingsource']), destination: get(record, ['destination']),
      counterparty: kind === 'venmo' ? (amountCents < 0 ? to : from) : '',
      externalId: get(record, ['id', 'transactionid']), balanceAfterCents: evidenceMoney(get(record, ['balance', 'runningbalance'])), exclusionReason: '' };
  });
  if (!rows.length) throw Object.assign(new Error('No data rows were found after the CSV headings.'), { status: 400 });
  const dates = rows.map(row => row.date).filter(Boolean).sort();
  return { rows, warnings, coverageStart: dates[0] || '', coverageEnd: dates.at(-1) || '', headerLine: records[headerIndex].info.lines };
};

// OCR is a draft only. Date-less entries deliberately stay undated instead of
// assuming the upload date was the transaction's authorization date.
export const parsePendingText = text => {
  let date = '';
  const rows = [];
  const lines = String(text).split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const dateMatch = line.match(/\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{4}\b|\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4}\b/i);
    if (dateMatch) date = evidenceDate(dateMatch[0]) || date;
    if (/available|balance|total|credit limit|rewards|statement/i.test(line)) continue;
    const amountMatch = line.match(/[+-]?\$\s*[\d,]+\.\d{2}(?!\d)/);
    if (!amountMatch) continue;
    const amount = evidenceMoney(amountMatch[0]);
    let description = line.replace(amountMatch[0], '').replace(dateMatch?.[0] || /$^/, '').trim();
    const prior = (lines[index - 1] || '').trim();
    if (!description && prior && !/\$|balance|total|available/i.test(prior) && !evidenceDate(prior)) description = prior;
    rows.push({ key: `line:${index + 1}`, sourceRow: index + 1, date, description,
      amountCents: amountMatch[0].startsWith('+') ? Math.abs(amount) : -Math.abs(amount),
      currency: 'USD', relevant: true, exclusionReason: '', issue: 'Verify screenshot amount, merchant and date.' });
  }
  return { rows, warnings: ['Screenshot extraction is a draft. Compare every included row with the image and confirm the review.'], coverageStart: '', coverageEnd: '' };
};

export const validateEvidenceReview = (review, kind) => {
  const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
  if (!review?.confirmed) fail('Confirm that you checked the extracted evidence against the original file.');
  if (review.useDocument === false) {
    if (!String(review.documentExclusionReason || '').trim()) fail('Explain why this document is excluded.');
    return review;
  }
  if (!Array.isArray(review.rows) || review.rows.length > 10000) fail('Provide at most 10,000 reviewed evidence rows.');
  const keys = new Set();
  for (const row of review.rows) {
    if (typeof row.key !== 'string' || !row.key || keys.has(row.key)) fail('Evidence row keys must be unique.');
    keys.add(row.key);
    if (!row.relevant) {
      if (!String(row.exclusionReason || '').trim()) fail('Give a reason for each excluded evidence row (including Venmo rows funded elsewhere).');
      continue;
    }
    if (!validEvidenceDate(row.date) || !Number.isSafeInteger(row.amountCents) || row.amountCents === 0
      || typeof row.description !== 'string' || !row.description.trim() || row.description.length > 1000 || row.currency !== 'USD') {
      fail('Every included row needs a valid date, description, nonzero signed amount, and USD currency.');
    }
    if (kind === 'venmo' && !row.fundingVerified) fail('Verify that every selected Venmo payment was funded by or transferred to this bank account.');
  }
  if (kind === 'pending' && !review.rows.some(row => row.relevant) && !review.noRelevantRows) fail('Confirm that the image contains no relevant pending rows, or enter its pending charges.');
  if (kind === 'capital_one' && (!validEvidenceDate(review.coverageStart) || !validEvidenceDate(review.coverageEnd)
    || review.coverageStart > review.coverageEnd || !review.rows.some(row => row.relevant))) fail('Confirm the bank export coverage dates and include at least one bank transaction.');
  if (kind === 'capital_one' && review.rows.some(row => row.relevant && (row.date < review.coverageStart || row.date > review.coverageEnd))) fail('Included bank rows must lie within the declared export coverage.');
  return review;
};
