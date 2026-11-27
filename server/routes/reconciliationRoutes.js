import express, { Router } from 'express';
import { requireAdmin } from '../auth.js';
import { ReconciliationService } from '../services/reconciliationService.js';
import { SettingsRepository } from '../repositories/settingsRepository.js';
import { getDateInTimezone } from '../domain/periods.js';

export const createReconciliationRouter = (service = new ReconciliationService(), settings = new SettingsRepository()) => {
  const router = Router();
  router.use(requireAdmin);
  router.use(express.json({ limit: '5mb' }));
  router.get('/sessions/latest', (request, response) => response.json({ session: service.latest(request.query.accountKey) }));
  router.post('/sessions', (request, response) => response.status(201).json(service.create(request.body?.accountKey)));
  router.get('/sessions/:id', (request, response) => response.json(service.repository.getSession(Number(request.params.id))));
  router.post('/sessions/:id/evidence', express.raw({ type: ['application/octet-stream', 'text/csv', 'image/png', 'image/jpeg'], limit: '10mb' }), async (request, response) => {
    response.status(201).json(await service.upload(Number(request.params.id), request.query.kind, request.query.filename, request.body));
  });
  router.get('/sessions/:id/evidence/:evidenceId/content', (request, response) => {
    const file = service.repository.getEvidence(Number(request.params.id), Number(request.params.evidenceId), true);
    response.set('Content-Type', file.mimeType);
    response.set('X-Content-Type-Options', 'nosniff');
    response.set('Cache-Control', 'no-store');
    response.set('Content-Disposition', `${file.kind === 'pending' ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.filename)}`);
    response.send(file.content);
  });
  router.put('/sessions/:id/evidence/:evidenceId/review', (request, response) => response.json(service.review(Number(request.params.id), Number(request.params.evidenceId), request.body)));
  router.post('/sessions/:id/run', async (request, response) => response.json(await service.run(Number(request.params.id),
    getDateInTimezone(new Date(), settings.get('timezone') || 'UTC'), request.body?.decisions)));
  return router;
};
