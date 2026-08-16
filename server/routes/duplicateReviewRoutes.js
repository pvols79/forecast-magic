import { Router } from 'express';
import { requireAdmin } from '../auth.js';
import { DuplicateReviewService } from '../services/duplicateReviewService.js';

export const createDuplicateReviewRouter = (service = new DuplicateReviewService()) => {
  const router = Router();
  router.use(requireAdmin);

  router.get('/scan', async (request, response) => {
    const result = await service.scan(request.query.accountKey, {
      includeLow: request.query.includeLow === 'true',
    });
    response.json(result);
  });

  router.post('/ignore', (request, response) => {
    response.json({ ignored: service.ignore(request.body || {}) });
  });

  router.post('/resolve', async (request, response) => {
    response.json(await service.resolve(request.body || {}));
  });

  return router;
};
