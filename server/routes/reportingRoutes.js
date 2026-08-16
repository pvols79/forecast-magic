import { Router } from 'express';
import { requireReportingToken } from '../auth.js';
import { getDateInTimezone } from '../domain/periods.js';
import { SettingsRepository } from '../repositories/settingsRepository.js';
import { streamDailyHighlightPdf } from '../reporting/dailyHighlightPdf.js';
import { FinancialAnalyticsService } from '../services/financialAnalyticsService.js';

const requestedView = value => {
  if (value == null || value === '') return 'admin';
  if (value === 'admin' || value === 'household') return value;
  const error = new Error('Report view must be admin or household.');
  error.status = 400;
  throw error;
};

const reportContext = (request, settings) => ({
  view: requestedView(request.query.view),
  timezone: settings.get('timezone') || 'UTC',
  currency: 'USD',
});

const safeFilenamePart = value => String(value || 'account')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '') || 'account';

export const createReportingRouter = (
  service = new FinancialAnalyticsService(),
  settings = new SettingsRepository(),
  tokenGuard = requireReportingToken,
  pdfRenderer = streamDailyHighlightPdf
) => {
  const router = Router();

  router.get('/daily-highlight', tokenGuard, async (request, response) => {
    const context = reportContext(request, settings);
    const anchorDate = request.query.anchorDate || getDateInTimezone(new Date(), context.timezone);
    response.json(await service.buildDailyHighlightReport(request.query.accountKey, anchorDate, context));
  });

  router.get('/daily-highlight.pdf', async (request, response) => {
    const context = reportContext(request, settings);
    if (context.view === 'admin' && !request.isAdmin) {
      return response.status(401).json({ error: 'Admin access is required for an Admin report.' });
    }
    const anchorDate = request.query.anchorDate || getDateInTimezone(new Date(), context.timezone);
    const report = await service.buildDailyHighlightReport(request.query.accountKey, anchorDate, context);
    const filename = `forecast-magic-daily-highlight-${report.reportDate}-${safeFilenamePart(report.account.name)}.pdf`;
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    pdfRenderer(report, response);
    return undefined;
  });

  return router;
};
