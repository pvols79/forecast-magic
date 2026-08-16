import { describe, expect, it, vi } from 'vitest';
import { createDuplicateReviewRouter } from './duplicateReviewRoutes';

const findHandler = (router, path, method) => router.stack
  .find(layer => layer.route?.path === path && layer.route.methods[method])
  .route.stack.at(-1).handle;

const response = () => ({
  status: vi.fn().mockReturnThis(),
  json: vi.fn().mockReturnThis(),
});

describe('duplicate review routes', () => {
  it('passes account and low-confidence selection to the scan service', async () => {
    const service = { scan: vi.fn(async () => ({ candidates: [] })), ignore: vi.fn(), resolve: vi.fn() };
    const router = createDuplicateReviewRouter(service);
    const reply = response();
    await findHandler(router, '/scan', 'get')({ query: { accountKey: 'plaid:1', includeLow: 'true' } }, reply);
    expect(service.scan).toHaveBeenCalledWith('plaid:1', { includeLow: true });
    expect(reply.json).toHaveBeenCalledWith({ candidates: [] });
  });
});
