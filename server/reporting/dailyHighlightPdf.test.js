import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { streamDailyHighlightPdf } from './dailyHighlightPdf.js';

const projectionPoint = (date, availableCents) => ({
  date,
  availableCents,
  ledgerBalanceCents: availableCents + 100000,
  reservedFundCents: 100000,
});

const sampleReport = view => ({
  schemaVersion: '1.2',
  reportDate: '2026-08-15',
  generatedAt: '2026-08-15T12:00:00.000Z',
  reportContext: { view, timezone: 'America/Chicago', currency: 'USD', projectionHorizonDays: 2 },
  account: { key: 'plaid:1', name: 'Main Checking' },
  cashPosition: {
    availableToday: projectionPoint('2026-08-15', 100000),
    thirtyDayLow: projectionPoint('2026-08-16', 80000),
    ninetyDayLow: projectionPoint('2026-08-16', 80000),
    sixMonthLow: projectionPoint('2026-08-16', 80000),
    sixMonthHigh: projectionPoint('2026-08-17', 120000),
    endingAvailable: projectionPoint('2026-08-17', 120000),
    netAvailableChange: { startDate: '2026-08-15', endDate: '2026-08-17', amountCents: 20000 },
    projectionSeries: [
      projectionPoint('2026-08-15', 100000),
      projectionPoint('2026-08-16', 80000),
      projectionPoint('2026-08-17', 120000),
    ],
  },
  needsAttention: {
    pastDueRecurring: [{
      description: 'Mortgage', date: '2026-08-01', amountCents: -200000,
      daysPastDue: 14, daysUntilDue: null, urgency: 'past_due',
    }],
    dueWithin48Hours: [{
      description: 'Electric', date: '2026-08-16', amountCents: -20000,
      daysPastDue: null, daysUntilDue: 1, urgency: 'due_48h',
    }],
  },
  spendingTrends: {
    currentWindow: { startDate: '2026-07-17', endDate: '2026-08-15' },
    topCategories: [{ categoryName: 'Groceries', amountCents: 40000, transactionCount: 4 }],
    tracked: {
      gas: { key: 'gas', currentCents: 10000, previousCents: 9000, changePercent: 11.1, direction: 'up' },
      dining: { key: 'dining', currentCents: 8000, previousCents: 10000, changePercent: -20, direction: 'down' },
      groceries: { key: 'groceries', currentCents: 40000, previousCents: 40000, changePercent: 0, direction: 'flat' },
    },
  },
  unallocatedSpending: {
    totalCents: 12000,
    transactionCount: 1,
    topPayee: { payee: 'Store', amountCents: 12000, transactionCount: 1 },
    topExpenditures: [{ date: '2026-08-14', payee: 'Store', amountCents: 12000 }],
  },
  funds: [{
    name: 'Groceries', fundType: 'operating', periodType: 'weekly', remainingCents: 20000,
    scheduledAllocationCents: 40000, targetCents: null, householdVisible: true,
  }],
  ...(view === 'admin' ? {
    duplicateReview: {
      needsReview: 1,
      confidenceCounts: { high: 1, medium: 0, low: 0 },
      candidates: [{
        confidence: 'high', reasons: ['Exact amount', 'Similar payee'],
        manual: { date: '2026-08-14', payee: 'Spotify', amountCents: -2079 },
        imported: { date: '2026-08-15', payee: 'SPOTIFY USA', amountCents: -2079 },
      }],
    },
  } : {}),
});

const render = report => new Promise((resolve, reject) => {
  const output = new PassThrough();
  const chunks = [];
  output.on('data', chunk => chunks.push(chunk));
  output.on('end', () => resolve(Buffer.concat(chunks)));
  output.on('error', reject);
  streamDailyHighlightPdf(report, output).on('error', reject);
});

describe('Daily Highlight PDF', () => {
  it('generates a non-empty printable PDF from the shared report model', async () => {
    const pdf = await render(sampleReport('household'));
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(5000);
  });

  it('renders the Admin report model containing Duplicate Review data', async () => {
    const householdPdf = await render(sampleReport('household'));
    const pdf = await render(sampleReport('admin'));
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(householdPdf.length);
  });
});
