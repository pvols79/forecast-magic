import PDFDocument from 'pdfkit';

const COLORS = {
  ink: '#1A202C',
  muted: '#5B6B82',
  line: '#CBD5E0',
  panel: '#F7FAFC',
  blue: '#2B6CB0',
  green: '#2F855A',
  red: '#C53030',
  amber: '#975A16',
};

const formatCurrency = (cents, currency = 'USD') => new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency,
}).format(Number(cents || 0) / 100);

const formatPercent = value => value == null ? 'No prior spending' : `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
const titleCase = value => String(value || '').replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());

const pdfContext = (doc, report) => {
  const currency = report.reportContext?.currency || 'USD';
  const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom - 18;
  const ensureSpace = height => {
    if (doc.y + height > bottom()) doc.addPage();
  };
  const money = cents => formatCurrency(cents, currency);
  return { contentWidth, ensureSpace, money };
};

const drawDocumentHeader = (doc, report, context) => {
  const left = doc.page.margins.left;
  doc.fillColor(COLORS.blue).font('Helvetica-Bold').fontSize(22)
    .text('Forecast Magic', left, doc.y, { width: context.contentWidth });
  doc.fillColor(COLORS.ink).fontSize(15).text('Daily Financial Highlight', left, doc.y, { continued: true });
  doc.fillColor(COLORS.muted).font('Helvetica').fontSize(9)
    .text(`  |  ${titleCase(report.reportContext.view)} report`);
  doc.moveDown(0.3);
  doc.fontSize(9).fillColor(COLORS.muted)
    .text(`${report.account.name}  |  Report date ${report.reportDate}  |  ${report.reportContext.timezone}`);
  doc.text(`Generated ${new Date(report.generatedAt).toLocaleString('en-US', { timeZone: report.reportContext.timezone })}`);
  doc.moveDown(0.7);
  doc.strokeColor(COLORS.blue).lineWidth(2)
    .moveTo(doc.page.margins.left, doc.y)
    .lineTo(doc.page.margins.left + context.contentWidth, doc.y)
    .stroke();
  doc.moveDown(0.8);
  doc.x = left;
};

const sectionTitle = (doc, context, title) => {
  context.ensureSpace(30);
  const left = doc.page.margins.left;
  const titleY = doc.y;
  doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(13)
    .text(title, left, titleY, { width: context.contentWidth, lineBreak: false });
  const lineY = titleY + 18;
  doc.strokeColor(COLORS.line).lineWidth(0.7)
    .moveTo(left, lineY)
    .lineTo(left + context.contentWidth, lineY)
    .stroke();
  doc.x = left;
  doc.y = lineY + 7;
};

const metricBox = (doc, x, y, width, label, value, secondary = '') => {
  doc.save().roundedRect(x, y, width, 48, 4).fill(COLORS.panel).restore();
  doc.fillColor(COLORS.muted).font('Helvetica').fontSize(8).text(label, x + 9, y + 7, { width: width - 18 });
  doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(13).text(value, x + 9, y + 20, { width: width - 18 });
  if (secondary) doc.fillColor(COLORS.muted).font('Helvetica').fontSize(7).text(secondary, x + 9, y + 37, { width: width - 18 });
};

const drawCashPosition = (doc, report, context) => {
  sectionTitle(doc, context, 'Cash Position');
  context.ensureSpace(168);
  const cash = report.cashPosition;
  const gap = 8;
  const width = (context.contentWidth - gap * 2) / 3;
  const x = doc.page.margins.left;
  const firstY = doc.y;
  metricBox(doc, x, firstY, width, 'Available to Spend', context.money(cash.availableToday?.availableCents));
  metricBox(doc, x + (width + gap), firstY, width, 'Current Ledger', context.money(cash.availableToday?.ledgerBalanceCents));
  metricBox(doc, x + (width + gap) * 2, firstY, width, 'Reserved Funds', context.money(cash.availableToday?.reservedFundCents));
  const secondY = firstY + 56;
  metricBox(doc, x, secondY, width, '30-Day Low', context.money(cash.thirtyDayLow?.availableCents), cash.thirtyDayLow?.date);
  metricBox(doc, x + (width + gap), secondY, width, '90-Day Low', context.money(cash.ninetyDayLow?.availableCents), cash.ninetyDayLow?.date);
  metricBox(doc, x + (width + gap) * 2, secondY, width, 'Six-Month Low', context.money(cash.sixMonthLow?.availableCents), cash.sixMonthLow?.date);
  const thirdY = secondY + 56;
  metricBox(doc, x, thirdY, width, 'Six-Month High', context.money(cash.sixMonthHigh?.availableCents), cash.sixMonthHigh?.date);
  metricBox(doc, x + (width + gap), thirdY, width, 'Six-Month Ending', context.money(cash.endingAvailable?.availableCents), cash.endingAvailable?.date);
  metricBox(
    doc, x + (width + gap) * 2, thirdY, width, 'Net Available Change',
    context.money(cash.netAvailableChange?.amountCents),
    `${cash.netAvailableChange?.startDate || ''} to ${cash.netAvailableChange?.endDate || ''}`
  );
  doc.x = x;
  doc.y = thirdY + 56;
};

const drawProjectionChart = (doc, report, context) => {
  sectionTitle(doc, context, 'Cash Flow Projection');
  const points = report.cashPosition.projectionSeries || [];
  if (points.length < 2) {
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(9).text('Projection data is unavailable.');
    return;
  }
  context.ensureSpace(180);
  const x = doc.page.margins.left + 44;
  const y = doc.y + 8;
  const width = context.contentWidth - 54;
  const height = 128;
  const values = points.map(point => point.availableCents);
  let min = Math.min(...values, 0);
  let max = Math.max(...values, 0);
  const padding = Math.max((max - min) * 0.08, 10000);
  min -= padding;
  max += padding;
  const chartY = value => y + height - ((value - min) / (max - min || 1)) * height;
  const chartX = index => x + index / (points.length - 1) * width;

  doc.strokeColor(COLORS.line).lineWidth(0.5);
  for (let step = 0; step <= 4; step += 1) {
    const value = min + (max - min) * step / 4;
    const lineY = chartY(value);
    doc.moveTo(x, lineY).lineTo(x + width, lineY).stroke();
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(7)
      .text(context.money(value), doc.page.margins.left, lineY - 3, { width: 38, align: 'right' });
  }
  if (min < 0 && max > 0) {
    doc.strokeColor(COLORS.red).lineWidth(1).dash(3, { space: 2 })
      .moveTo(x, chartY(0)).lineTo(x + width, chartY(0)).stroke().undash();
  }
  doc.strokeColor(COLORS.blue).lineWidth(1.8).moveTo(chartX(0), chartY(values[0]));
  values.slice(1).forEach((value, index) => doc.lineTo(chartX(index + 1), chartY(value)));
  doc.stroke();

  const labelIndexes = [...new Set([0, 1, 2, 3, 4, 5].map(step => Math.round(step * (points.length - 1) / 5)))];
  labelIndexes.forEach((index, labelIndex) => {
    const labelX = chartX(index);
    const align = labelIndex === 0 ? 'left' : labelIndex === labelIndexes.length - 1 ? 'right' : 'center';
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(7)
      .text(points[index].date, labelX - 32, y + height + 6, { width: 64, align });
  });
  doc.fillColor(COLORS.muted).font('Helvetica').fontSize(7)
    .text('Available to Spend', x, y - 4, { width, align: 'right' });
  doc.x = doc.page.margins.left;
  doc.y = y + height + 24;
};

const urgencyLabel = urgency => ({
  past_due: 'PAST DUE',
  due_today: 'DUE TODAY',
  due_48h: 'DUE WITHIN 48 HOURS',
  upcoming: 'UPCOMING',
}[urgency] || 'UPCOMING');

const drawAttentionRows = (doc, items, context) => {
  for (const item of items) {
    context.ensureSpace(30);
    const y = doc.y;
    const label = urgencyLabel(item.urgency);
    const labelColor = item.urgency === 'past_due' ? COLORS.red : item.urgency === 'due_today' ? COLORS.amber : COLORS.blue;
    doc.fillColor(labelColor).font('Helvetica-Bold').fontSize(8).text(label, doc.page.margins.left, y, { width: 110 });
    doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(9)
      .text(item.description, doc.page.margins.left + 112, y, { width: 245 });
    doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(9)
      .text(context.money(item.amountCents), doc.page.margins.left + 370, y, { width: 100, align: 'right' });
    const timing = item.daysPastDue != null ? `${item.daysPastDue} day${item.daysPastDue === 1 ? '' : 's'} past due` : item.date;
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(7)
      .text(timing, doc.page.margins.left + 112, y + 13, { width: 300 });
    doc.x = doc.page.margins.left;
    doc.y = y + 27;
  }
};

const drawNeedsAttention = (doc, report, context) => {
  sectionTitle(doc, context, 'Needs Attention');
  const items = [
    ...(report.needsAttention.pastDueRecurring || []),
    ...(report.needsAttention.dueWithin48Hours || []),
  ];
  if (!items.length) {
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(9)
      .text('No unpaid Upcoming expenses are past due or due within 48 hours.', doc.page.margins.left, doc.y, { width: context.contentWidth });
    return;
  }
  drawAttentionRows(doc, items, context);
};

const drawSpendingTrends = (doc, report, context) => {
  sectionTitle(doc, context, 'Spending Trends');
  const left = doc.page.margins.left;
  doc.fillColor(COLORS.muted).font('Helvetica').fontSize(8)
    .text(
      `Rolling 30 days: ${report.spendingTrends.currentWindow.startDate} to ${report.spendingTrends.currentWindow.endDate}`,
      left,
      doc.y,
      { width: context.contentWidth }
    );
  doc.moveDown(0.4);
  const top = report.spendingTrends.topCategories || [];
  top.forEach((category, index) => {
    context.ensureSpace(18);
    const rowY = doc.y;
    doc.fillColor(COLORS.ink).font(index < 3 ? 'Helvetica-Bold' : 'Helvetica').fontSize(9)
      .text(`${index + 1}. ${category.categoryName}`, left, rowY, { width: 210 });
    doc.font('Helvetica').text(
      `${context.money(category.amountCents)}  |  ${category.transactionCount} transactions`,
      left + 220,
      rowY,
      { width: context.contentWidth - 220 }
    );
    doc.x = left;
    doc.y = rowY + 14;
  });
  doc.y += 4;
  Object.values(report.spendingTrends.tracked || {}).forEach(trend => {
    context.ensureSpace(20);
    const direction = titleCase(trend.direction);
    const rowY = doc.y;
    doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(9)
      .text(titleCase(trend.key), left, rowY, { width: 90 });
    doc.font('Helvetica').text(
      `Current ${context.money(trend.currentCents)}  |  Previous ${context.money(trend.previousCents)}  |  ${formatPercent(trend.changePercent)}  |  ${direction}`,
      left + 95,
      rowY,
      { width: context.contentWidth - 95 }
    );
    doc.x = left;
    doc.y = rowY + 15;
  });
};

const drawUnallocated = (doc, report, context) => {
  sectionTitle(doc, context, 'Unallocated Spending');
  const left = doc.page.margins.left;
  const data = report.unallocatedSpending;
  doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(10)
    .text(`${context.money(data.totalCents)} across ${data.transactionCount} unplanned transactions`, left, doc.y, { width: context.contentWidth });
  if (data.topPayee) {
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(8)
      .text(`Top payee: ${data.topPayee.payee} (${context.money(data.topPayee.amountCents)})`, left, doc.y, { width: context.contentWidth });
  }
  doc.moveDown(0.4);
  (data.topExpenditures || []).forEach(item => {
    context.ensureSpace(18);
    const rowY = doc.y;
    doc.fillColor(COLORS.ink).font('Helvetica').fontSize(8)
      .text(`${item.date}  ${item.payee}`, left, rowY, { width: context.contentWidth - 110 });
    doc.font('Helvetica-Bold').text(context.money(item.amountCents), left + context.contentWidth - 100, rowY, { width: 100, align: 'right' });
    doc.x = left;
    doc.y = rowY + 14;
  });
};

const drawFunds = (doc, report, context) => {
  sectionTitle(doc, context, 'Fund Allocations');
  if (!report.funds.length) {
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(9).text('No Fund Allocations are visible in this report.');
    return;
  }
  report.funds.forEach(fund => {
    context.ensureSpace(32);
    const y = doc.y;
    doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(9)
      .text(fund.name, doc.page.margins.left, y, { width: 190 });
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(7)
      .text(`${titleCase(fund.fundType)}  |  ${titleCase(fund.periodType)}  |  Household: ${fund.householdVisible ? 'Yes' : 'No'}`, doc.page.margins.left, y + 13, { width: 270 });
    doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(9)
      .text(context.money(fund.remainingCents), doc.page.margins.left + 290, y, { width: 90, align: 'right' });
    const allocation = fund.scheduledAllocationCents == null ? 'Manual balance' : `Allocation ${context.money(fund.scheduledAllocationCents)}`;
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(7)
      .text(allocation, doc.page.margins.left + 290, y + 13, { width: 90, align: 'right' });
    const target = fund.targetCents ? `Target ${context.money(fund.targetCents)}` : 'No target';
    doc.text(target, doc.page.margins.left + 390, y + 13, { width: 80, align: 'right' });
    doc.x = doc.page.margins.left;
    doc.y = y + 29;
  });
};

const drawDuplicateReview = (doc, report, context) => {
  if (!report.duplicateReview) return;
  sectionTitle(doc, context, 'Duplicate Review');
  const review = report.duplicateReview;
  doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(10)
    .text(`${review.needsReview} candidate pair${review.needsReview === 1 ? '' : 's'} need review`);
  doc.fillColor(COLORS.muted).font('Helvetica').fontSize(8)
    .text(`High ${review.confidenceCounts.high}  |  Medium ${review.confidenceCounts.medium}  |  Low ${review.confidenceCounts.low}`);
  doc.moveDown(0.5);
  (review.candidates || []).forEach(candidate => {
    context.ensureSpace(52);
    const y = doc.y;
    doc.save().roundedRect(doc.page.margins.left, y, context.contentWidth, 45, 3).fill(COLORS.panel).restore();
    doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(8)
      .text(`${candidate.confidence.toUpperCase()} CONFIDENCE`, doc.page.margins.left + 8, y + 7, { width: 110 });
    doc.font('Helvetica').text(
      `Manual: ${candidate.manual.date}  ${candidate.manual.payee}`,
      doc.page.margins.left + 120, y + 7, { width: 245 }
    );
    doc.text(
      `Imported: ${candidate.imported.date}  ${candidate.imported.payee}`,
      doc.page.margins.left + 120, y + 19, { width: 245 }
    );
    doc.font('Helvetica-Bold').text(context.money(candidate.manual.amountCents), doc.page.margins.left + 375, y + 7, { width: 90, align: 'right' });
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(7)
      .text(candidate.reasons.join(' | '), doc.page.margins.left + 8, y + 33, { width: context.contentWidth - 16 });
    doc.x = doc.page.margins.left;
    doc.y = y + 51;
  });
  doc.fillColor(COLORS.muted).font('Helvetica').fontSize(7)
    .text(
      'Informational only. Resolve candidates from the Admin Duplicate Review workflow.',
      doc.page.margins.left,
      doc.y,
      { width: context.contentWidth }
    );
};

const addPageFooters = (doc, report) => {
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    const y = doc.page.height - 30;
    const originalBottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.strokeColor(COLORS.line).lineWidth(0.5)
      .moveTo(doc.page.margins.left, y - 6)
      .lineTo(doc.page.width - doc.page.margins.right, y - 6)
      .stroke();
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(7)
      .text(`Forecast Magic  |  ${report.account.name}`, doc.page.margins.left, y, { width: 300, lineBreak: false });
    doc.text(`Page ${index + 1} of ${range.count}`, doc.page.width - doc.page.margins.right - 100, y, { width: 100, align: 'right', lineBreak: false });
    doc.page.margins.bottom = originalBottomMargin;
  }
};

export const streamDailyHighlightPdf = (report, output) => {
  const doc = new PDFDocument({
    size: 'LETTER',
    margins: { top: 36, right: 40, bottom: 42, left: 40 },
    bufferPages: true,
    compress: false,
    info: {
      Title: `Forecast Magic Daily Financial Highlight - ${report.account.name}`,
      Author: 'Forecast Magic',
      Subject: `${titleCase(report.reportContext.view)} financial report for ${report.reportDate}`,
    },
  });
  doc.pipe(output);
  const context = pdfContext(doc, report);
  drawDocumentHeader(doc, report, context);
  drawCashPosition(doc, report, context);
  drawProjectionChart(doc, report, context);
  drawNeedsAttention(doc, report, context);
  drawSpendingTrends(doc, report, context);
  drawUnallocated(doc, report, context);
  drawFunds(doc, report, context);
  drawDuplicateReview(doc, report, context);
  addPageFooters(doc, report);
  doc.end();
  return doc;
};
