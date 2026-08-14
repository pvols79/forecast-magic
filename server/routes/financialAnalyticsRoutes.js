import { Router } from 'express';
import { getDateInTimezone } from '../domain/periods.js';
import { SettingsRepository } from '../repositories/settingsRepository.js';
import { FinancialAnalyticsService } from '../services/financialAnalyticsService.js';

export const createFinancialAnalyticsRouter = (
  service = new FinancialAnalyticsService(),
  settings = new SettingsRepository()
) => {
  const router = Router();

  router.get('/overview', async (request, response) => {
    const timezone = settings.get('timezone') || 'UTC';
    const anchorDate = request.query.anchorDate || getDateInTimezone(new Date(), timezone);
    response.json(await service.getOverview(request.query.accountKey, anchorDate));
  });

  return router;
};
