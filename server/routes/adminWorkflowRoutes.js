import { Router } from 'express';
import { requireAdmin } from '../auth.js';
import { AdminWorkflowService } from '../services/adminWorkflowService.js';

export const createAdminWorkflowRouter = (service = new AdminWorkflowService()) => {
  const router = Router();
  router.use(requireAdmin);

  router.post('/review-deleted-pending', async (request, response) => {
    response.json(await service.reviewDeletedPending(request.body?.accountKey));
  });

  router.get('/recurring-suggestions', async (request, response) => {
    response.json(await service.getRecurringSuggestions(request.query.accountKey));
  });

  router.post('/clear-recurring-suggestions', async (request, response) => {
    response.json(await service.clearRecurringSuggestions(
      request.body?.accountKey,
      request.body?.transactionIds || []
    ));
  });

  return router;
};
