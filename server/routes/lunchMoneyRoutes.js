import { Router } from 'express';
import { requireAdmin } from '../auth.js';
import { LunchMoneyService } from '../services/lunchMoneyService.js';

export const createLunchMoneyRouter = (service = new LunchMoneyService()) => {
  const router = Router();
  router.get('/manual-accounts', async (request, response) => response.json({ accounts: await service.getManualAccounts() }));
  router.get('/plaid-accounts', async (request, response) => response.json({ accounts: await service.getPlaidAccounts() }));
  router.get('/categories', requireAdmin, async (request, response) => response.json({ categories: await service.getCategories() }));
  router.get('/transactions', async (request, response) => response.json({
    transactions: await service.getTransactions(request.query.startDate, request.query.endDate, request.query.anchorDate),
  }));
  router.get('/recurring', async (request, response) => response.json(
    request.query.includeOccurrences === 'true'
      ? await service.getRecurringData(request.query.startDate, request.query.endDate)
      : { events: await service.getRecurring(request.query.startDate, request.query.endDate) }
  ));
  return router;
};
