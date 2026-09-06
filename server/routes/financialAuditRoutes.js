import express, { Router } from 'express';
import { requireAuditIngest, requireAuditRead } from '../auth.js';
import { getDateInTimezone } from '../domain/periods.js';
import { SettingsRepository } from '../repositories/settingsRepository.js';
import { FinancialAuditService } from '../services/financialAuditService.js';

const csvBody = express.text({
  type: ['text/csv', 'application/csv', 'text/plain'],
  limit: '10mb',
});

const integerValue = (value, name) => {
  if (value == null || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    const error = new Error(`${name} must be an integer number of cents.`);
    error.status = 400;
    throw error;
  }
  return parsed;
};

const statementInput = request => {
  const body = typeof request.body === 'object' && request.body ? request.body : {};
  const text = typeof request.body === 'string' ? request.body : body.csv;
  if (!text) {
    const error = new Error('A Capital One CSV is required as text/csv or in the csv JSON field.');
    error.status = 400;
    throw error;
  }
  return {
    text,
    options: {
      filename: request.headers['x-filename'] || body.filename,
      ledgerBalanceCents: integerValue(
        request.query.ledgerBalanceCents ?? body.ledgerBalanceCents,
        'ledgerBalanceCents'
      ),
      availableBalanceCents: integerValue(
        request.query.availableBalanceCents ?? body.availableBalanceCents,
        'availableBalanceCents'
      ),
      observedAt: request.query.observedAt || body.observedAt,
    },
  };
};

export const createFinancialAuditRouter = (
  service = new FinancialAuditService(),
  settings = new SettingsRepository(),
  readGuard = requireAuditRead,
  ingestGuard = requireAuditIngest
) => {
  const router = Router();
  const anchorDateFor = request => request.query.anchorDate
    || request.body?.anchorDate
    || getDateInTimezone(new Date(), settings.get('timezone') || 'UTC');

  router.post('/runs', readGuard, async (request, response) => {
    response.status(201).json(await service.run(
      request.body?.accountKey || request.query.accountKey,
      anchorDateFor(request)
    ));
  });

  router.get('/runs/latest', readGuard, (request, response) => {
    response.json(service.getLatest(request.query.accountKey));
  });

  router.get('/runs/:runId', readGuard, (request, response) => {
    response.json(service.getRun(Number(request.params.runId)));
  });

  router.get('/balance-comparison', readGuard, (request, response) => {
    response.json(service.getBalanceBridge(request.query.accountKey));
  });

  router.get('/transactions', readGuard, (request, response) => {
    response.json(service.getTransactions(request.query.accountKey, {
      source: request.query.source,
      pending: request.query.pending == null ? undefined : request.query.pending === 'true',
    }));
  });

  router.get('/findings', readGuard, (request, response) => {
    response.json(service.getFindings(request.query.accountKey, {
      severity: request.query.severity,
      category: request.query.category,
    }));
  });

  router.get('/findings/:findingKey', readGuard, (request, response) => {
    response.json(service.getFinding(request.query.accountKey, request.params.findingKey));
  });

  router.get('/tag-compliance', readGuard, (request, response) => {
    response.json(service.getTagCompliance(request.query.accountKey));
  });

  router.get('/sync-health', readGuard, (request, response) => {
    response.json(service.getSyncHealth(request.query.accountKey));
  });

  router.post('/evidence/n8n', ingestGuard, (request, response) => {
    response.status(201).json(service.ingestN8nEvidence(request.body || {}));
  });

  router.post('/evidence/capital-one/preview', ingestGuard, csvBody, (request, response) => {
    const input = statementInput(request);
    response.json(service.previewCapitalOneImport(
      request.query.accountKey || request.body?.accountKey,
      input.text,
      input.options
    ));
  });

  router.post('/evidence/capital-one', ingestGuard, csvBody, (request, response) => {
    const input = statementInput(request);
    response.status(201).json(service.commitCapitalOneImport(
      request.query.accountKey || request.body?.accountKey,
      input.text,
      input.options
    ));
  });

  return router;
};
