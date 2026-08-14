import { Router } from 'express';
import { requireReportingToken } from '../auth.js';
import { getDateInTimezone } from '../domain/periods.js';
import { SettingsRepository } from '../repositories/settingsRepository.js';
import { FinancialAnalyticsService } from '../services/financialAnalyticsService.js';

export const createReportingRouter = (
  service = new FinancialAnalyticsService(),
  settings = new SettingsRepository(),
  tokenGuard = requireReportingToken
) => {
  const router = Router();

  router.get('/daily-highlight', tokenGuard, async (request, response) => {
    const timezone = settings.get('timezone') || 'UTC';
    const anchorDate = request.query.anchorDate || getDateInTimezone(new Date(), timezone);
    response.json(await service.getDailyHighlight(request.query.accountKey, anchorDate));
  });

  return router;
};
