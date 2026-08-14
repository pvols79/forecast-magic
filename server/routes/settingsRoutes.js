import { Router } from 'express';
import { requireAdmin } from '../auth.js';
import { isValidTimezone } from '../domain/periods.js';
import { SettingsRepository } from '../repositories/settingsRepository.js';
import { LunchMoneyService } from '../services/lunchMoneyService.js';

export const createSettingsRouter = (
  settings = new SettingsRepository(),
  lunchMoney = new LunchMoneyService(settings)
) => {
  const router = Router();

  router.get('/', (request, response) => response.json({
    timezone: settings.get('timezone'),
    apiKeyConfigured: Boolean(lunchMoney.getApiKey()),
    apiKeyFromEnvironment: lunchMoney.hasEnvironmentApiKey(),
  }));

  router.put('/timezone', (request, response) => {
    const timezone = request.body?.timezone;
    if (!isValidTimezone(timezone)) return response.status(400).json({ error: 'Invalid IANA timezone.' });
    if (settings.get('timezone') && !request.isAdmin) return response.status(401).json({ error: 'Admin access is required.' });
    settings.set('timezone', timezone);
    return response.json({ timezone });
  });

  router.put('/api-key', requireAdmin, (request, response) => {
    const apiKey = String(request.body?.apiKey || '').trim();
    if (!apiKey) return response.status(400).json({ error: 'API key is required.' });
    lunchMoney.setApiKey(apiKey);
    return response.status(204).end();
  });

  router.delete('/api-key', requireAdmin, (request, response) => {
    lunchMoney.clearApiKey();
    response.status(204).end();
  });

  return router;
};
